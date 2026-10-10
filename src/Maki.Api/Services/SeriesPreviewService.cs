using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Threading.Channels;
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
/// Fetches the first chapter of a series that is not in the library, from the first source found to
/// carry chapter 1, so a user can read a few pages before deciding to add it.
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

    /// <summary>Finished previews kept for a quick reopen. Each one holds a whole chapter on disk.</summary>
    internal const int MaxFinishedJobs = 6;

    private readonly PreviewWantedStore _wanted = new(
        Path.Combine(paths.SeriesPreviewDir, "wanted.json"), TimeProvider.System, logger);

    private readonly ConcurrentDictionary<long, Job> _jobs = new();
    private readonly object _sync = new();

    /// <summary>
    /// Previews asked for while <see cref="MaxConcurrentJobs"/> were already fetching, oldest first. A job
    /// leaves when it starts, or is skipped if it was discarded while waiting. Guarded by <see cref="_sync"/>.
    /// </summary>
    private readonly Queue<(Job Job, Series Series)> _waiting = new();

    /// <summary>
    /// Starts a preview for <paramref name="providerId"/>, or joins the one already running or
    /// finished for it. Completed previews are retained on disk for 30 days. When too many previews are
    /// already fetching, this one waits its turn (status <c>queued</c>) and starts by itself when a slot frees.
    /// </summary>
    public SeriesPreviewSnapshot Start(long providerId, Series series, int userId, ILocalizer localizer) =>
        Snapshot(StartCore(providerId, series, userId), localizer);

    /// <summary>
    /// Starts a preview nobody is watching, for the daily retry. Same rules as <see cref="Start"/>: it joins one
    /// that is running or finished, and waits its turn when the slots are full.
    /// </summary>
    internal void Resume(long providerId, Series series) => StartCore(providerId, series, null);

    private Job StartCore(long providerId, Series series, int? userId)
    {
        Job job;
        lock (_sync)
        {
            SweepFinished();

            // Closing a preview does not discard a download the user asked to keep.
            if (!_jobs.ContainsKey(providerId) && Restore(providerId) is { } restored)
                _jobs[providerId] = restored;

            if (_jobs.TryGetValue(providerId, out var existing) && existing.Status != PreviewStatus.Failed)
            {
                if (userId is { } viewer) existing.Viewers.Add(viewer);
                return existing;
            }

            if (existing is not null)
            {
                Remove(providerId, existing);
            }

            job = new Job(providerId);
            if (userId is { } first) job.Viewers.Add(first);
            _jobs[providerId] = job;
            _wanted.Want(providerId);

            if (Running() >= MaxConcurrentJobs)
            {
                job.MarkQueued();
                _waiting.Enqueue((job, series));
                return job;
            }

            job.MarkStarted();
        }

        _ = Task.Run(() => RunAsync(job, series));
        return job;
    }

    /// <summary>Previews to start again: failed ones a day on, and ones a restart cut off.</summary>
    internal IReadOnlyList<long> DueForRetry()
    {
        lock (_sync)
        {
            return _wanted.Due(id => _jobs.TryGetValue(id, out var job) && !job.Expired);
        }
    }

    /// <summary>Brings every failed preview's retry time forward to now. Running ones are left alone.</summary>
    internal int MakeAllDue()
    {
        lock (_sync)
        {
            return _wanted.MakeDue();
        }
    }

    /// <summary>A preview somebody asked for that is not ready: what it is doing now and when it will next be tried.</summary>
    public record PendingPreview(long ProviderId, string Status, int Attempts, DateTime? RetryAt);

    /// <summary>
    /// Every preview still being waited on: queued or fetching, failed and due again, or cut off by a restart
    /// and about to start. <c>Status</c> is the job's, or <c>waiting</c> when nothing is running for it.
    /// </summary>
    public IReadOnlyList<PendingPreview> Pending()
    {
        lock (_sync)
        {
            return _wanted.All()
                .Select(e => new PendingPreview(
                    e.ProviderId,
                    _jobs.TryGetValue(e.ProviderId, out var job) && !job.Expired ? job.Status : "waiting",
                    e.Attempts,
                    e.RetryAt))
                .ToList();
        }
    }

    /// <summary>The caller found nothing to preview for this provider any more, so it stops being retried.</summary>
    internal void GiveUp(long providerId) => _wanted.Remove(providerId);

    /// <summary>Previews fetching right now. Queued ones are not: they hold no slot. Caller holds <see cref="_sync"/>.</summary>
    private int Running() => _jobs.Values.Count(j => j.Started && !j.Finished);

    /// <summary>Starts waiting previews while there are slots, skipping any discarded while they waited.</summary>
    private void StartWaiting()
    {
        List<(Job Job, Series Series)> ready = [];
        lock (_sync)
        {
            var slots = MaxConcurrentJobs - Running();
            while (slots > 0 && _waiting.Count > 0)
            {
                var (job, series) = _waiting.Dequeue();
                if (!_jobs.TryGetValue(job.ProviderId, out var current) || current != job)
                {
                    continue;
                }

                job.MarkStarted();
                ready.Add((job, series));
                slots--;
            }
        }

        foreach (var (job, series) in ready)
        {
            _ = Task.Run(() => RunAsync(job, series));
        }
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

    /// <summary>
    /// Throws away a preview's downloaded pages, whether or not anyone has it open. Previews belong to the
    /// instance rather than to one reader, so it goes for everyone; the next preview fetches it again.
    /// </summary>
    public void Discard(long providerId)
    {
        _wanted.Remove(providerId);
        lock (_sync)
        {
            if (_jobs.TryRemove(providerId, out var job))
            {
                job.Cancel();
            }
        }

        DeleteProvider(paths.SeriesPreviewDir, providerId, logger);
    }

    internal static void DeleteProvider(string previewDir, long providerId, ILogger? logger = null)
    {
        var dir = Path.Combine(previewDir, providerId.ToString(CultureInfo.InvariantCulture));
        try
        {
            if (Directory.Exists(dir))
            {
                Directory.Delete(dir, recursive: true);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger?.LogWarning(ex, "Could not delete the preview for {ProviderId}", providerId);
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
    /// Searches, lists and fetches as one pipeline: each source's listing starts as soon as its search
    /// matches, and the first listing that carries chapter 1 is fetched straight away, so the preview
    /// waits on the fastest source rather than the slowest. A source that starts later is only used
    /// once every source has answered and none had chapter 1: official sites tend to list only the
    /// latest free chapters, and a preview of chapter 3 is not what anyone opened it for.
    /// </summary>
    private async Task RunAsync(Job job, Series series)
    {
        var ct = job.Cts.Token;
        var found = Channel.CreateUnbounded<SourceCandidate>();
        var listed = Channel.CreateUnbounded<ListedCandidate>();

        // The searches run to the end under the job's own token even once the chapter is in: the
        // add that usually follows a preview reuses every one of them. Listings stop with the run.
        _ = SearchAsync(series, found.Writer, ct);
        using var listingCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var listing = ListAllAsync(job, found.Reader, listed.Writer, listingCts.Token);

        try
        {
            var anyCandidate = false;
            string? lastError = null;
            var startsLater = new List<ListedCandidate>();

            // Anything that fails to hand over its pages passes to the next: "MangaDex hides the
            // licensed English chapters" is a normal answer, not an error.
            await foreach (var entry in listed.Reader.ReadAllAsync(ct))
            {
                anyCandidate = true;
                if (entry.First is null)
                {
                    lastError = entry.ErrorKey ?? lastError;
                    continue;
                }

                if (entry.First.Number != 1m)
                {
                    startsLater.Add(entry);
                    continue;
                }

                lastError = await FetchAsync(job, entry.Candidate.Source, entry.First, ct);
                if (lastError is null)
                {
                    return;
                }
            }

            foreach (var entry in startsLater.OrderBy(e => e.Candidate.Priority))
            {
                ct.ThrowIfCancellationRequested();
                lastError = await FetchAsync(job, entry.Candidate.Source, entry.First!, ct);
                if (lastError is null)
                {
                    return;
                }
            }

            job.Fail(anyCandidate ? lastError ?? "error.preview.noChapter" : "error.preview.noSource");
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
            listingCts.Cancel();
            await listing;
            job.MarkFinished();
            if (job.Status == PreviewStatus.Ready) _wanted.Remove(job.ProviderId);
            else if (job.Status == PreviewStatus.Failed) _wanted.Failed(job.ProviderId);
            StartWaiting();

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

            lock (_sync)
            {
                SweepFinished();
            }
        }
    }

    /// <summary>
    /// Drops expired previews, then the oldest finished ones past <see cref="MaxFinishedJobs"/>,
    /// unwatched ones first. Caller holds <see cref="_sync"/>.
    /// </summary>
    private void SweepFinished()
    {
        foreach (var (id, stale) in _jobs.Where(pair => pair.Value.Expired).ToList())
        {
            Remove(id, stale);
        }

        var finished = _jobs.Where(pair => pair.Value.Finished).ToList();
        foreach (var (id, old) in finished
                     .OrderBy(pair => pair.Value.Viewers.Count > 0)
                     .ThenBy(pair => pair.Value.FinishedAtTicks)
                     .Take(finished.Count - MaxFinishedJobs))
        {
            Remove(id, old);
        }
    }

    private async Task SearchAsync(Series series, ChannelWriter<SourceCandidate> found, CancellationToken ct)
    {
        try
        {
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<SourceMatchService>().FindCandidatesAsync(series, found, ct);
        }
        catch (Exception ex)
        {
            found.TryComplete(ex);
        }
    }

    /// <summary>
    /// Lists each candidate's chapters as it arrives, a few sources at a time, and completes
    /// <paramref name="listed"/> once the search is over and every listing has answered. Listings go
    /// through the shared cache, so adding the series straight after the preview costs no second request.
    /// </summary>
    private async Task ListAllAsync(
        Job job, ChannelReader<SourceCandidate> found, ChannelWriter<ListedCandidate> listed, CancellationToken ct)
    {
        using var gate = new SemaphoreSlim(MaxParallelSources, MaxParallelSources);
        var listings = new List<Task>();
        Exception? error = null;
        try
        {
            await foreach (var candidate in found.ReadAllAsync(ct))
            {
                listings.Add(ListIntoAsync(candidate));
            }
        }
        catch (Exception ex)
        {
            error = ex;
        }

        try
        {
            await Task.WhenAll(listings);
        }
        catch (Exception ex)
        {
            error ??= ex;
        }

        listed.TryComplete(error);

        async Task ListIntoAsync(SourceCandidate candidate)
        {
            await gate.WaitAsync(ct);
            try
            {
                listed.TryWrite(await ListAsync(job, candidate, ct));
            }
            finally
            {
                gate.Release();
            }
        }
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
        catch (Exception ex) when (!ct.IsCancellationRequested)
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
        catch (Exception ex) when (!ct.IsCancellationRequested)
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

    /// <summary>
    /// Providers whose preview is on disk and still readable, newest first. A preview is released from
    /// memory when its viewer closes it, but the pages stay for 30 days, so the folder is the record.
    /// </summary>
    public IReadOnlyList<long> CachedProviders() => CachedProviders(paths.SeriesPreviewDir);

    internal static IReadOnlyList<long> CachedProviders(string previewDir)
    {
        if (!Directory.Exists(previewDir))
        {
            return [];
        }

        return Directory.EnumerateDirectories(previewDir)
            .Select(dir => (Id: long.TryParse(Path.GetFileName(dir), NumberStyles.None, CultureInfo.InvariantCulture, out var id) ? id : (long?)null,
                Cached: LoadCached(dir)))
            .Where(x => x.Id is not null && x.Cached is not null)
            .OrderByDescending(x => x.Cached!.SavedAt)
            .Select(x => x.Id!.Value)
            .ToList();
    }

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
        public const string Queued = "queued";
        public const string Searching = "searching";
        public const string Fetching = "fetching";
        public const string Ready = "ready";
        public const string Failed = "failed";
    }

    private sealed class Job(long providerId, string? token = null)
    {
        /// <summary>Guards the fields below: the run writes them while pollers read them.</summary>
        public readonly object Sync = new();

        /// <summary>The deadline runs from <see cref="MarkStarted"/>, not from creation: waiting is not fetching.</summary>
        public readonly CancellationTokenSource Cts = new();

        public readonly string Token = token ?? Guid.NewGuid().ToString("N")[..8];

        public long ProviderId { get; } = providerId;

        /// <summary>Users with this preview open. Guarded by the service's lock, not <see cref="Sync"/>.</summary>
        public HashSet<int> Viewers { get; } = [];

        public string Status { get; private set; } = PreviewStatus.Searching;

        /// <summary>False while waiting for a free slot, and for a preview restored from disk.</summary>
        public bool Started { get; private set; }
        public string? ErrorKey { get; private set; }
        public string? SourceName { get; private set; }
        public string? SourceDisplayName { get; private set; }
        public string? ChapterLabel { get; private set; }
        public int? PageCount { get; private set; }
        public string? Dir { get; private set; }

        private long _finishedAtTicks;

        public bool Finished => Interlocked.Read(ref _finishedAtTicks) != 0;

        public long FinishedAtTicks => Interlocked.Read(ref _finishedAtTicks);

        public bool Expired
        {
            get
            {
                var ticks = Interlocked.Read(ref _finishedAtTicks);
                return ticks != 0 && DateTime.UtcNow.Ticks - ticks > KeepFinished.Ticks;
            }
        }

        public void MarkQueued()
        {
            lock (Sync)
            {
                Status = PreviewStatus.Queued;
            }
        }

        public void MarkStarted()
        {
            lock (Sync)
            {
                Started = true;
                Status = PreviewStatus.Searching;
            }

            Cts.CancelAfter(JobDeadline);
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
