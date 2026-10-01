using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using Maki.Api.Configuration;
using Maki.Api.Localization;
using Maki.Core.Download;
using Maki.Core.Entities;
using Maki.Core.Http;
using Maki.Core.Sources;

namespace Maki.Api.Services;

public record SeriesPreviewSnapshot(
    long ProviderId,
    string Status,
    string? Error,
    string? SourceName,
    string? SourceDisplayName,
    string? ChapterLabel,
    int? PageCount,
    /// <summary>Changes whenever the pages being served change, so the client can cache-bust on it.</summary>
    string? Version,
    /// <summary>One entry per page, true once that page is on disk and can be requested.</summary>
    IReadOnlyList<bool> Ready);

/// <summary>
/// Fetches the first chapter of a series that is not in the library, from the best source that
/// carries it, so a user can read a few pages before deciding to add it.
/// <para>
/// Same shape as <see cref="SourceComparePreviewService"/>: a detached job the client polls, pages
/// fetched through <see cref="PageDownloader"/> into a throwaway folder and served by index, so
/// headers, descrambling and the shared cooldown all apply and the client never names a URL.
/// Nothing here touches the database; the series is a transient one built from provider metadata.
/// </para>
/// </summary>
public sealed class SeriesPreviewService(
    IServiceScopeFactory scopes,
    SourceChapterListCache chapterLists,
    PageDownloader pageDownloader,
    DownloadQueueService queue,
    AppPaths paths,
    ILogger<SeriesPreviewService> logger)
{
    /// <summary>Previews fetching at once instance-wide. Each one is a whole chapter off a rate-limited site.</summary>
    private const int MaxConcurrentJobs = 2;

    /// <summary>Chapter listings in flight at once within a job. Different sources, so different rate limiters.</summary>
    private const int MaxParallelSources = 3;

    /// <summary>Long enough for a slow source to hand over a whole chapter, short enough that a hung one gives its slot back.</summary>
    private static readonly TimeSpan JobDeadline = TimeSpan.FromMinutes(5);

    internal static readonly TimeSpan KeepFinished = TimeSpan.FromDays(30);

    private readonly ConcurrentDictionary<long, Job> _jobs = new();
    private readonly object _sync = new();

    /// <summary>
    /// Starts a preview for <paramref name="providerId"/>, or joins the one already running or
    /// finished for it. Completed previews are retained on disk for 30 days.
    /// </summary>
    /// <exception cref="InvalidOperationException">Too many previews already fetching.</exception>
    public SeriesPreviewSnapshot Start(long providerId, Series series, int userId, ILocalizer localizer)
    {
        Job job;
        lock (_sync)
        {
            foreach (var (id, stale) in _jobs.Where(pair => pair.Value.Expired).ToList())
            {
                Remove(id, stale);
            }

            // Closing a preview does not discard a download the user asked to keep.
            if (!_jobs.ContainsKey(providerId) && Restore(providerId) is { } restored)
                _jobs[providerId] = restored;

            if (_jobs.TryGetValue(providerId, out var existing) && existing.Status != PreviewStatus.Failed)
            {
                existing.Viewers.Add(userId);
                return Snapshot(existing, localizer);
            }

            if (existing is not null)
            {
                Remove(providerId, existing);
            }

            if (_jobs.Values.Count(j => !j.Finished) >= MaxConcurrentJobs)
            {
                throw new InvalidOperationException("Too many previews running");
            }

            job = new Job(providerId);
            job.Viewers.Add(userId);
            _jobs[providerId] = job;
        }

        _ = Task.Run(() => RunAsync(job, series));
        return Snapshot(job, localizer);
    }

    /// <summary>
    /// The preview's state, for a user who started or joined it. Everyone else gets null: joining
    /// goes through <see cref="Start"/>, which is where the controller checks the content rating.
    /// </summary>
    public SeriesPreviewSnapshot? Snapshot(long providerId, int userId, ILocalizer localizer) =>
        Viewed(providerId, userId) is { } job ? Snapshot(job, localizer) : null;

    /// <summary>
    /// The viewer closed the preview. Keep the requested fetch running and the result for 30 days.
    /// </summary>
    public void Release(long providerId, int userId)
    {
        lock (_sync)
        {
            if (_jobs.TryGetValue(providerId, out var job)) job.Viewers.Remove(userId);
        }
    }

    /// <summary>The file holding one page of the current attempt, or null when it has not landed yet.</summary>
    public string? PageFile(long providerId, int userId, int index)
    {
        string? dir;
        if (Viewed(providerId, userId) is not { } job)
        {
            return null;
        }

        lock (job.Sync)
        {
            dir = job.Dir;
        }

        if (dir is null || !Directory.Exists(dir))
        {
            return null;
        }

        return Directory.GetFiles(dir, $"{index:000}.*")
            .FirstOrDefault(f => !f.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase));
    }

    private Job? Viewed(long providerId, int userId)
    {
        lock (_sync)
        {
            return _jobs.TryGetValue(providerId, out var job) && !job.Expired && job.Viewers.Contains(userId) ? job : null;
        }
    }

    /// <summary>
    /// The chapter a preview opens: chapter 1 when the source lists it, otherwise the lowest
    /// numbered one. A prologue or a chapter 0 is a fine first taste; unnumbered extras are not.
    /// </summary>
    public static SourceChapter? PickFirstChapter(IReadOnlyList<SourceChapter> chapters) =>
        chapters.FirstOrDefault(c => c.Number == 1m)
        ?? chapters.Where(c => c.Number is not null).MinBy(c => c.Number);

    /// <summary>What one candidate's chapter listing offered, or why it offered nothing.</summary>
    internal sealed record ListedCandidate(SourceCandidate Candidate, SourceChapter? First, string? ErrorKey);

    /// <summary>
    /// The order sources are asked for pages in. A source that carries chapter 1 beats a
    /// higher-ranked one that starts later: the point of the preview is the start of the story, and
    /// the official sites in particular tend to list only the latest free chapters. Priority order
    /// holds within each group.
    /// </summary>
    internal static IEnumerable<ListedCandidate> FetchOrder(IEnumerable<ListedCandidate> listed)
    {
        var usable = listed.Where(l => l.First is not null).ToList();
        return usable.Where(l => l.First!.Number == 1m).Concat(usable.Where(l => l.First!.Number != 1m));
    }

    private async Task RunAsync(Job job, Series series)
    {
        var ct = job.Cts.Token;

        try
        {
            List<SourceCandidate> candidates;
            using (var scope = scopes.CreateScope())
            {
                candidates = await scope.ServiceProvider.GetRequiredService<SourceMatchService>()
                    .FindCandidatesAsync(series, ct);
            }

            if (candidates.Count == 0)
            {
                job.Fail("error.preview.noSource");
                return;
            }

            var listed = await ListAllAsync(job, candidates, ct);
            var lastError = listed.LastOrDefault(l => l.ErrorKey is not null)?.ErrorKey;

            // Anything that fails to hand over its pages passes to the next: "MangaDex hides the
            // licensed English chapters" is a normal answer, not an error.
            foreach (var entry in FetchOrder(listed))
            {
                ct.ThrowIfCancellationRequested();
                lastError = await FetchAsync(job, entry.Candidate.Source, entry.First!, ct);
                if (lastError is null)
                {
                    return;
                }
            }

            job.Fail(lastError ?? "error.preview.noChapter");
        }
        catch (OperationCanceledException)
        {
            job.Fail("error.preview.timedOut");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Preview for MangaBaka {ProviderId} ended early", job.ProviderId);
            job.Fail("error.preview.failed");
        }
        finally
        {
            job.MarkFinished();

            if (job.Status == PreviewStatus.Ready && _jobs.TryGetValue(job.ProviderId, out var retained) && retained == job)
            {
                try
                {
                    var root = Path.GetDirectoryName(JobRoot(job))!;
                    File.WriteAllText(Path.Combine(root, "preview.json"), JsonSerializer.Serialize(
                        new CachedPreview(DateTime.UtcNow, job.Token, job.SourceName!, job.SourceDisplayName!,
                            job.ChapterLabel, job.PageCount!.Value)));
                    Directory.SetLastWriteTimeUtc(root, DateTime.UtcNow);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Could not persist preview for {ProviderId}", job.ProviderId);
                }
            }

            if (!_jobs.TryGetValue(job.ProviderId, out var current) || current != job)
            {
                TryDelete(JobRoot(job));
            }
        }
    }

    /// <summary>
    /// Lists every candidate's chapters, a few sources at a time. Listings go through the shared
    /// cache, so adding the series straight after the preview costs no second request.
    /// </summary>
    private async Task<ListedCandidate[]> ListAllAsync(Job job, List<SourceCandidate> candidates, CancellationToken ct)
    {
        using var gate = new SemaphoreSlim(MaxParallelSources, MaxParallelSources);
        return await Task.WhenAll(candidates.Select(async candidate =>
        {
            await gate.WaitAsync(ct);
            try
            {
                return await ListAsync(job, candidate, ct);
            }
            finally
            {
                gate.Release();
            }
        }));
    }

    private async Task<ListedCandidate> ListAsync(Job job, SourceCandidate candidate, CancellationToken ct)
    {
        var source = candidate.Source;
        if (queue.CooldownRemaining(source.Name) > TimeSpan.Zero)
        {
            return new ListedCandidate(candidate, null, "error.preview.rateLimited");
        }

        try
        {
            var chapters = await chapterLists.GetAsync(source, candidate.SourceSeriesId, candidate.LanguageFilter, ct);
            return PickFirstChapter(chapters) is { } first
                ? new ListedCandidate(candidate, first, null)
                : new ListedCandidate(candidate, null, "error.preview.noChapter");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new ListedCandidate(candidate, null, Failed(job, source, ex));
        }
    }

    /// <returns>Null when this source served the chapter, otherwise the catalogue key saying why not.</returns>
    private async Task<string?> FetchAsync(Job job, ISource source, SourceChapter chapter, CancellationToken ct)
    {
        var dir = Path.Combine(JobRoot(job), source.Name);
        try
        {
            // Resolved now rather than at listing time: several sources hand back short-lived URLs.
            var pages = await source.GetPagesAsync(chapter, ct);
            if (pages.Pages.Count == 0)
            {
                return "error.preview.noChapter";
            }

            job.Serve(source.Name, source.DisplayName,
                chapter.Number?.ToString(CultureInfo.InvariantCulture) ?? chapter.NumberRaw,
                pages.Pages.Count, dir);

            await pageDownloader.DownloadAsync(pages, source.Name, dir, null, ct);
            job.MarkReady();
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            job.Unserve();
            TryDelete(dir);
            return ex is ChapterLockedException ? "error.preview.noChapter" : Failed(job, source, ex);
        }
    }

    private string Failed(Job job, ISource source, Exception ex)
    {
        // Same shared cooldown the download queue uses, raised and never cleared from here: a
        // preview hitting a 429 holds downloads off that site too.
        if (RateLimitDetector.IsRateLimit(ex, out var retryAfter))
        {
            var until = queue.EnterRateLimitCooldown(source.Name, retryAfter);
            logger.LogInformation("Preview rate-limited by {Source} until {Until:u}", source.Name, until);
            return "error.preview.rateLimited";
        }

        logger.LogWarning(ex, "Preview failed on {Source} for MangaBaka {ProviderId}", source.Name, job.ProviderId);
        return "error.preview.failed";
    }

    private string JobRoot(Job job) =>
        Path.Combine(paths.SeriesPreviewDir, job.ProviderId.ToString(CultureInfo.InvariantCulture), job.Token);

    internal sealed record CachedPreview(DateTime SavedAt, string Token, string SourceName,
        string SourceDisplayName, string? ChapterLabel, int PageCount);

    internal static CachedPreview? LoadCached(string root)
    {
        try
        {
            var cached = JsonSerializer.Deserialize<CachedPreview>(File.ReadAllText(Path.Combine(root, "preview.json")));
            if (cached is null || DateTime.UtcNow - cached.SavedAt >= KeepFinished || cached.PageCount <= 0 ||
                string.IsNullOrEmpty(cached.Token) || Path.GetFileName(cached.Token) != cached.Token ||
                string.IsNullOrEmpty(cached.SourceName) || Path.GetFileName(cached.SourceName) != cached.SourceName ||
                cached.Token is "." or ".." || cached.SourceName is "." or "..") return null;
            var dir = Path.Combine(root, cached.Token, cached.SourceName);
            return ReadyPages(dir, cached.PageCount).All(ready => ready) ? cached : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    private Job? Restore(long providerId)
    {
        var root = Path.Combine(paths.SeriesPreviewDir, providerId.ToString(CultureInfo.InvariantCulture));
        if (LoadCached(root) is not { } cached) return null;
        var job = new Job(providerId, cached.Token);
        job.Serve(cached.SourceName, cached.SourceDisplayName, cached.ChapterLabel, cached.PageCount,
            Path.Combine(root, cached.Token, cached.SourceName));
        job.MarkReady();
        job.MarkFinished(cached.SavedAt);
        return job;
    }

    private void Remove(long providerId, Job job)
    {
        _jobs.TryRemove(new KeyValuePair<long, Job>(providerId, job));
        job.Cancel();

        // A cancelled run may still hold files open; it clears its own folder once it winds down.
        TryDelete(JobRoot(job));
    }

    private SeriesPreviewSnapshot Snapshot(Job job, ILocalizer localizer)
    {
        lock (job.Sync)
        {
            return new SeriesPreviewSnapshot(
                job.ProviderId,
                job.Status,
                job.ErrorKey is { } key ? localizer.Get(key) : null,
                job.SourceName,
                job.SourceDisplayName,
                job.ChapterLabel,
                job.PageCount,
                job.SourceName is null ? null : $"{job.Token}-{job.SourceName}",
                ReadyPages(job.Dir, job.PageCount ?? 0));
        }
    }

    private static bool[] ReadyPages(string? dir, int count)
    {
        var ready = new bool[count];
        if (dir is null || !Directory.Exists(dir))
        {
            return ready;
        }

        foreach (var file in Directory.EnumerateFiles(dir))
        {
            if (file.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (int.TryParse(Path.GetFileNameWithoutExtension(file), NumberStyles.None, CultureInfo.InvariantCulture, out var index)
                && index >= 0 && index < count)
            {
                ready[index] = true;
            }
        }

        return ready;
    }

    private void TryDelete(string dir)
    {
        try
        {
            if (Directory.Exists(dir))
            {
                Directory.Delete(dir, recursive: true);
            }
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Could not clear series preview dir {Dir}", dir);
        }
    }

    private static class PreviewStatus
    {
        public const string Searching = "searching";
        public const string Fetching = "fetching";
        public const string Ready = "ready";
        public const string Failed = "failed";
    }

    private sealed class Job(long providerId, string? token = null)
    {
        /// <summary>Guards the fields below: the run writes them while pollers read them.</summary>
        public readonly object Sync = new();

        public readonly CancellationTokenSource Cts = new(JobDeadline);

        public readonly string Token = token ?? Guid.NewGuid().ToString("N")[..8];

        public long ProviderId { get; } = providerId;

        /// <summary>Users with this preview open. Guarded by the service's lock, not <see cref="Sync"/>.</summary>
        public HashSet<int> Viewers { get; } = [];

        public string Status { get; private set; } = PreviewStatus.Searching;
        public string? ErrorKey { get; private set; }
        public string? SourceName { get; private set; }
        public string? SourceDisplayName { get; private set; }
        public string? ChapterLabel { get; private set; }
        public int? PageCount { get; private set; }
        public string? Dir { get; private set; }

        private long _finishedAtTicks;

        public bool Finished => Interlocked.Read(ref _finishedAtTicks) != 0;

        public bool Expired
        {
            get
            {
                var ticks = Interlocked.Read(ref _finishedAtTicks);
                return ticks != 0 && DateTime.UtcNow.Ticks - ticks > KeepFinished.Ticks;
            }
        }

        public void Serve(string sourceName, string displayName, string? chapterLabel, int pageCount, string dir)
        {
            lock (Sync)
            {
                Status = PreviewStatus.Fetching;
                SourceName = sourceName;
                SourceDisplayName = displayName;
                ChapterLabel = chapterLabel;
                PageCount = pageCount;
                Dir = dir;
            }
        }

        /// <summary>Back to searching after a source failed partway, so the client drops its pages.</summary>
        public void Unserve()
        {
            lock (Sync)
            {
                Status = PreviewStatus.Searching;
                SourceName = null;
                SourceDisplayName = null;
                ChapterLabel = null;
                PageCount = null;
                Dir = null;
            }
        }

        public void MarkReady()
        {
            lock (Sync)
            {
                Status = PreviewStatus.Ready;
            }
        }

        public void Fail(string errorKey)
        {
            lock (Sync)
            {
                Status = PreviewStatus.Failed;
                ErrorKey = errorKey;
            }
        }

        public void MarkFinished(DateTime? at = null) => Interlocked.Exchange(ref _finishedAtTicks, (at ?? DateTime.UtcNow).Ticks);

        public void Cancel()
        {
            try
            {
                Cts.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // Already finished.
            }
        }
    }
}
