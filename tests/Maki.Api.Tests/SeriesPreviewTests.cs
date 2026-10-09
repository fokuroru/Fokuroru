using Maki.Api.Configuration;
using Maki.Api.Services;
using Maki.Core.Configuration;
using Maki.Core.Download;
using Maki.Core.Entities;
using Maki.Core.Sources;
using Maki.Data;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maki.Api.Tests;

/// <summary>Which chapter the Discover preview opens on a source's listing, and how a run ends.</summary>
[Collection(ConfigDirCollection.Name)]
public class SeriesPreviewTests : IDisposable
{
    private readonly TestDb _db = new();
    private readonly string _configDir = Path.Combine(Path.GetTempPath(), "maki-preview-tests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        _db.Dispose();
        try
        {
            Directory.Delete(_configDir, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    [Theory]
    [InlineData(29, true)]
    [InlineData(30, false)]
    [InlineData(31, false)]
    public void Finished_preview_survives_restart_for_thirty_days(int ageDays, bool reusable)
    {
        var root = Path.Combine(Path.GetTempPath(), $"preview-test-{Guid.NewGuid():N}");
        var pages = Path.Combine(root, "abc123", "fake");
        Directory.CreateDirectory(pages);
        try
        {
            File.WriteAllText(Path.Combine(pages, "000.jpg"), "page");
            File.WriteAllText(Path.Combine(root, "preview.json"), System.Text.Json.JsonSerializer.Serialize(
                new SeriesPreviewService.CachedPreview(DateTime.UtcNow.AddDays(-ageDays), "abc123", "fake", "Fake", "1", 1)));
            Assert.Equal(reusable, SeriesPreviewService.LoadCached(root) is not null);
            if (reusable)
            {
                File.Delete(Path.Combine(pages, "000.jpg"));
                Assert.Null(SeriesPreviewService.LoadCached(root));
            }
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    private static void SeedPreview(string dir, long providerId, int ageDays)
    {
        var root = Path.Combine(dir, providerId.ToString());
        var pages = Path.Combine(root, "tok", "fake");
        Directory.CreateDirectory(pages);
        File.WriteAllText(Path.Combine(pages, "000.jpg"), "page");
        File.WriteAllText(Path.Combine(root, "preview.json"), System.Text.Json.JsonSerializer.Serialize(
            new SeriesPreviewService.CachedPreview(DateTime.UtcNow.AddDays(-ageDays), "tok", "fake", "Fake", "1", 1)));
    }

    [Fact]
    public void Lists_downloaded_previews_newest_first_and_skips_expired_and_stray_folders()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"preview-list-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(dir, "not-a-provider"));
        try
        {
            SeedPreview(dir, 11, ageDays: 5);
            SeedPreview(dir, 22, ageDays: 1);
            SeedPreview(dir, 33, ageDays: 40);

            Assert.Equal([22L, 11L], SeriesPreviewService.CachedProviders(dir));
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    [Fact]
    public void Deleting_a_preview_removes_only_that_one()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"preview-del-{Guid.NewGuid():N}");
        try
        {
            SeedPreview(dir, 11, ageDays: 1);
            SeedPreview(dir, 22, ageDays: 2);

            SeriesPreviewService.DeleteProvider(dir, 11);
            SeriesPreviewService.DeleteProvider(dir, 999);

            Assert.Equal([22L], SeriesPreviewService.CachedProviders(dir));
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    [Fact]
    public void Lists_nothing_when_no_preview_was_ever_made()
    {
        Assert.Empty(SeriesPreviewService.CachedProviders(Path.Combine(Path.GetTempPath(), $"missing-{Guid.NewGuid():N}")));
    }

    private static SourceChapter Chapter(decimal? number, string id = "") =>
        new("fake", "s", id == "" ? number?.ToString() ?? "x" : id, number?.ToString(), number, null, null, "en", null);

    [Fact]
    public void Picks_chapter_one_even_when_a_prologue_is_listed()
    {
        var picked = SeriesPreviewService.PickFirstChapter([Chapter(3), Chapter(0), Chapter(1), Chapter(2)]);

        Assert.Equal(1m, picked?.Number);
    }

    [Fact]
    public void Falls_back_to_the_lowest_numbered_chapter()
    {
        // MangaDex drops old scans, so a listing can start well past chapter 1.
        var picked = SeriesPreviewService.PickFirstChapter([Chapter(52), Chapter(48), Chapter(50)]);

        Assert.Equal(48m, picked?.Number);
    }

    [Fact]
    public void Unnumbered_extras_are_never_picked()
    {
        Assert.Equal(7m, SeriesPreviewService.PickFirstChapter([Chapter(null, "oneshot"), Chapter(7)])?.Number);
        Assert.Null(SeriesPreviewService.PickFirstChapter([Chapter(null, "oneshot")]));
    }

    [Fact]
    public void An_empty_listing_has_no_first_chapter() =>
        Assert.Null(SeriesPreviewService.PickFirstChapter([]));

    private static SeriesPreviewService.ListedCandidate Listed(string name, decimal? first) =>
        new(new SourceCandidate(new FakeSource { Name = name }, "s", null), first is null ? null : Chapter(first), null);

    [Fact]
    public void A_source_with_chapter_one_beats_a_higher_ranked_one_that_starts_later()
    {
        // Official sites tend to list only the newest free chapters, and a preview of chapter 3 is
        // not what anyone opened it for.
        var order = SeriesPreviewService.FetchOrder(
            [Listed("webtoons", 3), Listed("empty", null), Listed("mangadex", 1), Listed("weebcentral", 1)]);

        Assert.Equal(["mangadex", "weebcentral", "webtoons"], order.Select(l => l.Candidate.Source.Name));
    }

    private SeriesPreviewService Service(params FakeSource[] sources)
    {
        var services = new ServiceCollection();
        services.AddScoped(_ => _db.NewContext());
        services.AddScoped(sp => new SourceMatchService(
            sp.GetRequiredService<MakiDbContext>(), new SourceRegistry(sources),
            new FakeAppSettings().Set(SettingKeys.SourcePriorityOrder, string.Join(",", sources.Select(s => s.Name))),
            Sources.AllEnabled, new SourceExternalIdCache(TimeProvider.System),
            new SourceMatchSearchCache(TimeProvider.System), NullLogger<SourceMatchService>.Instance));

        var queue = new DownloadQueueService(null!, TimeProvider.System, null!, NullLogger<DownloadQueueService>.Instance);
        var prior = Environment.GetEnvironmentVariable("MAKI_CONFIG_DIR");
        AppPaths paths;
        try
        {
            Environment.SetEnvironmentVariable("MAKI_CONFIG_DIR", _configDir);
            paths = new AppPaths();
        }
        finally
        {
            Environment.SetEnvironmentVariable("MAKI_CONFIG_DIR", prior);
        }

        return new SeriesPreviewService(
            services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            new SourceChapterListCache(TimeProvider.System, NullLogger<SourceChapterListCache>.Instance),
            new PageDownloader(new StubHttpClientFactory(""), queue, TimeProvider.System, NullLogger<PageDownloader>.Instance),
            queue, paths, NullLogger<SeriesPreviewService>.Instance);
    }

    private static readonly Series Ippo = new() { Title = "Hajime no Ippo" };

    private static SourceSeriesResult Hit() => new(SourceSeriesId: "series", Title: "Hajime no Ippo", Url: "https://x.test/s");

    private static async Task<SeriesPreviewSnapshot> Settled(SeriesPreviewService service, long providerId, int userId)
    {
        for (var i = 0; i < 500; i++)
        {
            var snapshot = service.Snapshot(providerId, userId, new TestLocalizer());
            if (snapshot is { Status: "failed" or "ready" })
            {
                return snapshot;
            }

            await Task.Delay(10);
        }

        throw new TimeoutException("Preview never settled");
    }

    [Fact]
    public async Task A_source_whose_pages_time_out_hands_over_to_the_next_one()
    {
        // An HttpClient timeout is a TaskCanceledException while the job's own token is live. It
        // used to end the whole preview as "timed out" without asking the next source.
        var asked = 0;
        var slow = new FakeSource
        {
            Name = "slow",
            OnSearch = _ => [Hit()],
            OnListChapters = _ => [Chapter(1)],
            OnGetPages = _ => throw new TaskCanceledException("HttpClient.Timeout", new TimeoutException()),
        };
        var next = new FakeSource
        {
            Name = "next",
            OnSearch = _ => [Hit()],
            OnListChapters = _ => [Chapter(1)],
            OnGetPages = _ =>
            {
                Interlocked.Increment(ref asked);
                return new ChapterPages([]);
            },
        };
        var service = Service(slow, next);

        service.Start(1, Ippo, 1, new TestLocalizer());
        var snapshot = await Settled(service, 1, 1);

        Assert.Equal(1, asked);
        Assert.Equal("error.preview.noChapter", snapshot.Error);
    }

    [Fact]
    public async Task A_source_whose_listing_times_out_does_not_end_the_preview()
    {
        var asked = 0;
        var slow = new FakeSource
        {
            Name = "slow",
            OnSearch = _ => [Hit()],
            ListThrows = new TaskCanceledException("HttpClient.Timeout", new TimeoutException()),
        };
        var next = new FakeSource
        {
            Name = "next",
            OnSearch = _ => [Hit()],
            OnListChapters = _ => [Chapter(1)],
            OnGetPages = _ =>
            {
                Interlocked.Increment(ref asked);
                return new ChapterPages([]);
            },
        };
        var service = Service(slow, next);

        service.Start(1, Ippo, 1, new TestLocalizer());
        var snapshot = await Settled(service, 1, 1);

        Assert.Equal(1, asked);
        Assert.Equal("error.preview.noChapter", snapshot.Error);
    }

    [Fact]
    public async Task Finished_previews_past_the_cap_are_dropped_oldest_first()
    {
        var service = Service();
        var count = SeriesPreviewService.MaxFinishedJobs + 1;

        for (var id = 1; id <= count; id++)
        {
            service.Start(id, Ippo, id, new TestLocalizer());
            await Settled(service, id, id);
        }

        for (var i = 0; i < 500 && service.Snapshot(1, 1, new TestLocalizer()) is not null; i++)
        {
            await Task.Delay(10);
        }

        Assert.Null(service.Snapshot(1, 1, new TestLocalizer()));
        for (var id = 2; id <= count; id++)
        {
            Assert.NotNull(service.Snapshot(id, id, new TestLocalizer()));
        }
    }

    /// <summary>A source whose search stays open until <paramref name="gate"/> completes, to hold preview slots.</summary>
    private static FakeSource Blocked(TaskCompletionSource gate) => new()
    {
        Name = "held",
        OnSearchAsync = async (_, ct) =>
        {
            await gate.Task.WaitAsync(ct);
            return [];
        },
    };

    private static async Task<SeriesPreviewSnapshot> InState(
        SeriesPreviewService service, long providerId, int userId, string status)
    {
        for (var i = 0; i < 500; i++)
        {
            if (service.Snapshot(providerId, userId, new TestLocalizer()) is { } snapshot && snapshot.Status == status)
            {
                return snapshot;
            }

            await Task.Delay(10);
        }

        throw new TimeoutException($"Preview never reached {status}");
    }

    [Fact]
    public async Task A_preview_asked_for_while_the_slots_are_full_waits_and_runs_when_one_frees()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var service = Service(Blocked(gate));

        service.Start(1, Ippo, 1, new TestLocalizer());
        service.Start(2, Ippo, 1, new TestLocalizer());
        var waiting = service.Start(3, Ippo, 1, new TestLocalizer());

        // Not refused: it is queued, with nothing fetched yet.
        Assert.Equal("queued", waiting.Status);
        Assert.Null(waiting.SourceName);

        gate.SetResult();
        var settled = await Settled(service, 3, 1);

        // It ran in turn (the held source found nothing, which is its own failure, not the queue's).
        Assert.Equal("error.preview.noSource", settled.Error);
    }

    [Fact]
    public async Task A_queued_preview_discarded_while_waiting_never_starts()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var held = Blocked(gate);
        var service = Service(held);

        service.Start(1, Ippo, 1, new TestLocalizer());
        service.Start(2, Ippo, 1, new TestLocalizer());
        service.Start(3, Ippo, 1, new TestLocalizer());
        Assert.Equal("queued", (await InState(service, 3, 1, "queued")).Status);

        service.Discard(3);
        gate.SetResult();
        await Settled(service, 1, 1);
        await Settled(service, 2, 1);
        await Task.Delay(100);

        // Only the two that held slots ever searched.
        Assert.Equal(2, held.SearchCalls);
        Assert.Null(service.Snapshot(3, 1, new TestLocalizer()));
    }

    [Fact]
    public async Task A_failed_request_stays_wanted_until_it_is_discarded()
    {
        var service = Service();

        service.Start(1, Ippo, 1, new TestLocalizer());
        await Settled(service, 1, 1);
        Assert.Equal([1L], service.Pending().Select(p => p.ProviderId));

        service.Discard(1);

        Assert.Empty(service.Pending());
        Assert.Empty(service.DueForRetry());
    }

    [Fact]
    public async Task A_request_discarded_while_it_runs_does_not_come_back_when_it_fails()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var service = Service(Blocked(gate));

        service.Start(1, Ippo, 1, new TestLocalizer());
        Assert.Equal([1L], service.Pending().Select(p => p.ProviderId));

        service.Discard(1);
        gate.SetResult();
        await Task.Delay(300);

        Assert.Empty(service.Pending());
        Assert.Empty(service.DueForRetry());
    }
}
