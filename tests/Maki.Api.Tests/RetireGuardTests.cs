using Maki.Api.Jobs;
using Maki.Api.Services;
using Maki.Core.Entities;
using Maki.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maki.Api.Tests;

public class RetireGuardTests : IDisposable
{
    private readonly TestDb _db = new();
    public void Dispose() => _db.Dispose();

    private static SourceMapping Mapping() => new()
    {
        SourceName = "fake", SourceSeriesId = "s", Url = "https://fake.test", Priority = 1, Enabled = true,
    };

    private (int SeriesId, int ChapterId) SeedRetired()
    {
        var seriesId = _db.SeedSeries(configure: s => s.Retired = true, mappings: Mapping());
        using var db = _db.NewContext();
        var chapter = new Chapter { SeriesId = seriesId, Number = 1m, Language = "en" };
        db.Chapters.Add(chapter);
        db.SaveChanges();
        return (seriesId, chapter.Id);
    }

    private DownloadQueueService Queue() => new(
        _db.ScopeFactory(), TimeProvider.System, Sources.SingleChapterResolver(null, "fake"),
        NullLogger<DownloadQueueService>.Instance);

    [Fact]
    public async Task Bulk_enqueue_refuses_a_retired_series()
    {
        var (_, chapterId) = SeedRetired();

        var result = await Queue().EnqueueChaptersAsync([chapterId], DownloadOrigin.Manual, null);

        Assert.Equal(EnqueueRefusedException.SeriesRetired, result.Error);
        Assert.Empty(result.Queued);
    }

    [Fact]
    public async Task Single_enqueue_refuses_a_retired_series()
    {
        var (_, chapterId) = SeedRetired();

        var ex = await Assert.ThrowsAsync<EnqueueRefusedException>(() => Queue().EnqueueChapterAsync(chapterId));

        Assert.Equal(EnqueueRefusedException.SeriesRetired, ex.Key);
    }

    [Fact]
    public async Task Refreshable_and_active_selectors_leave_a_retired_series_out()
    {
        var (retiredId, _) = SeedRetired();
        var liveId = _db.SeedSeries(title: "Live", mappings: Mapping());

        using var db = _db.NewContext();
        var refreshable = await RefreshMonitoredSeriesJob.Refreshable(db, []).Select(s => s.Id).ToListAsync();
        var active = await db.Series.Active().Select(s => s.Id).ToListAsync();

        Assert.Equal([liveId], refreshable);
        Assert.DoesNotContain(retiredId, active);
    }
}
