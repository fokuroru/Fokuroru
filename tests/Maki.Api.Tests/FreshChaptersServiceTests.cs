using Maki.Api.Services;
using Maki.Core.Entities;

namespace Maki.Api.Tests;

/// <summary>New chapters for series the reader was caught up on: when one is on the rail and when it leaves.</summary>
public class FreshChaptersServiceTests : IDisposable
{
    private static readonly DateTime Now = new(2026, 10, 4, 12, 0, 0, DateTimeKind.Utc);

    private readonly TestDb _db = new();

    public void Dispose() => _db.Dispose();

    private int Series(SeriesStatus status = SeriesStatus.Ongoing) =>
        _db.SeedSeries(configure: s => s.Status = status);

    /// <summary>A downloaded chapter; <paramref name="discovered"/> null means backfilled.</summary>
    private int Chapter(int seriesId, decimal number, DateTime? discovered = null, bool onDisk = true)
    {
        using var db = _db.NewContext();
        int? fileId = null;
        if (onDisk)
        {
            var file = new ChapterFile { SeriesId = seriesId, RelativePath = $"{seriesId}-{number}.cbz", DateAdded = Now };
            db.ChapterFiles.Add(file);
            db.SaveChanges();
            fileId = file.Id;
        }

        var chapter = new Chapter { SeriesId = seriesId, Number = number, ChapterFileId = fileId, DiscoveredAt = discovered };
        db.Chapters.Add(chapter);
        db.SaveChanges();
        return chapter.Id;
    }

    private void Read(int seriesId, int chapterId)
    {
        using var db = _db.NewContext();
        db.ChapterProgress.Add(new ChapterProgress
        {
            UserId = 1, SeriesId = seriesId, ChapterId = chapterId, PageCount = 20, Completed = true,
            StartedAt = Now, UpdatedAt = Now
        });
        db.SaveChanges();
    }

    private async Task<IReadOnlyList<HomeFreshItem>> Rail(DateTime? at = null)
    {
        using var db = _db.NewContext();
        return await new FreshChaptersService(db).RailAsync(at ?? Now, 12, CancellationToken.None);
    }

    [Fact]
    public async Task A_new_chapter_on_a_series_the_reader_was_up_to_date_on_is_offered()
    {
        var series = Series();
        Read(series, Chapter(series, 1));
        Read(series, Chapter(series, 2));
        var fresh = Chapter(series, 3, Now.AddDays(-1));

        var item = Assert.Single(await Rail());

        Assert.Equal(fresh, item.ChapterId);
        Assert.Equal(1, item.NewChapterCount);
    }

    [Fact]
    public async Task A_backfilled_chapter_is_not_new()
    {
        var series = Series();
        Read(series, Chapter(series, 1));
        Chapter(series, 2);

        Assert.Empty(await Rail());
    }

    [Fact]
    public async Task A_series_with_something_older_still_unread_is_not_up_to_date()
    {
        var series = Series();
        Read(series, Chapter(series, 1));
        Chapter(series, 2);
        Chapter(series, 3, Now.AddDays(-1));

        Assert.Empty(await Rail());
    }

    [Fact]
    public async Task Reading_the_new_chapter_takes_it_off()
    {
        var series = Series();
        Read(series, Chapter(series, 1));
        Read(series, Chapter(series, 2, Now.AddDays(-1)));

        Assert.Empty(await Rail());
    }

    [Fact]
    public async Task A_deleted_file_takes_it_off()
    {
        var series = Series();
        Read(series, Chapter(series, 1));
        Chapter(series, 2, Now.AddDays(-1), onDisk: false);

        Assert.Empty(await Rail());
    }

    [Fact]
    public async Task It_stays_a_week_and_no_longer()
    {
        var series = Series();
        Read(series, Chapter(series, 1));
        Chapter(series, 2, Now.AddDays(-6));

        Assert.Single(await Rail());
        Assert.Empty(await Rail(Now.AddDays(2)));
    }

    [Fact]
    public async Task Two_new_chapters_count_together_and_lead_with_the_older()
    {
        var series = Series();
        Read(series, Chapter(series, 1));
        var first = Chapter(series, 2, Now.AddDays(-2));
        Chapter(series, 3, Now.AddDays(-1));

        var item = Assert.Single(await Rail());

        Assert.Equal(first, item.ChapterId);
        Assert.Equal(2, item.NewChapterCount);
    }

    [Fact]
    public async Task A_series_that_has_ended_is_not_up_to_date()
    {
        var series = Series(SeriesStatus.Completed);
        Read(series, Chapter(series, 1));
        Chapter(series, 2, Now.AddDays(-1));

        Assert.Empty(await Rail());
    }
}
