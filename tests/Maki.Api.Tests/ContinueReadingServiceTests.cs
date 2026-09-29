using Maki.Api.Services;
using Maki.Core.Entities;

namespace Maki.Api.Tests;

public class ContinueReadingServiceTests : IDisposable
{
    private readonly TestDb _db = new();

    public void Dispose() => _db.Dispose();

    private int Seed(int seriesId, decimal number, int? volume, bool downloaded = true, string language = "en")
    {
        using var db = _db.NewContext();
        ChapterFile? file = null;
        if (downloaded)
        {
            file = new ChapterFile { SeriesId = seriesId, RelativePath = $"{number}-{volume}-{language}.cbz" };
            db.ChapterFiles.Add(file);
            db.SaveChanges();
        }

        var chapter = new Chapter
        {
            SeriesId = seriesId, Number = number, Volume = volume, Language = language, ChapterFileId = file?.Id
        };
        db.Chapters.Add(chapter);
        db.SaveChanges();
        return chapter.Id;
    }

    private void Read(int seriesId, int chapterId)
    {
        using var db = _db.NewContext();
        db.ChapterProgress.Add(new ChapterProgress
        {
            UserId = 1, SeriesId = seriesId, ChapterId = chapterId, PageCount = 20, Completed = true
        });
        db.SaveChanges();
    }

    private async Task<int?> Next(int seriesId) =>
        (await new ContinueReadingService(_db.NewContext()).NextForAsync(seriesId, CancellationToken.None))?.ChapterId;

    [Fact]
    public async Task A_volumes_chapter_zero_is_not_offered_before_chapter_one()
    {
        var seriesId = _db.SeedSeries();
        Seed(seriesId, 0, 9);
        var first = Seed(seriesId, 1, 1);
        Seed(seriesId, 103, 9, downloaded: false);

        Assert.Equal(first, await Next(seriesId));
    }

    [Fact]
    public async Task A_volumes_chapter_zero_comes_after_the_previous_volume()
    {
        var seriesId = _db.SeedSeries();
        var zero = Seed(seriesId, 0, 9);
        Read(seriesId, Seed(seriesId, 1, 1));
        Read(seriesId, Seed(seriesId, 102, 8));
        Seed(seriesId, 103, 9);

        Assert.Equal(zero, await Next(seriesId));
    }

    [Fact]
    public async Task Another_languages_copy_of_the_last_read_chapter_is_not_next()
    {
        var seriesId = _db.SeedSeries();
        Read(seriesId, Seed(seriesId, 5, null));
        Seed(seriesId, 5, null, language: "es");
        var six = Seed(seriesId, 6, null);

        Assert.Equal(six, await Next(seriesId));
    }

    [Fact]
    public async Task Missing_chapters_before_the_latest_download_are_next_even_when_unwanted()
    {
        var seriesId = _db.SeedSeries();
        var first = Seed(seriesId, 1, null, downloaded: false);
        using (var db = _db.NewContext())
        {
            db.Chapters.Single(c => c.Id == first).Wanted = false;
            db.SaveChanges();
        }
        Seed(seriesId, 2, null, downloaded: false);
        var latest = Seed(seriesId, 50, null);

        var withMissing = await new ContinueReadingService(_db.NewContext())
            .NextForAsync(seriesId, CancellationToken.None, includeMissing: true);

        Assert.Equal(first, withMissing!.ChapterId);
        Assert.False(withMissing.Downloaded);
        Assert.Equal(latest, await Next(seriesId));
    }

    [Fact]
    public async Task The_series_page_offers_the_earliest_unread_chapter_past_a_stray_read_one()
    {
        var seriesId = _db.SeedSeries();
        var first = Seed(seriesId, 1, null);
        Seed(seriesId, 2, null);
        var stray = Seed(seriesId, 49, null);
        Seed(seriesId, 50, null, downloaded: false);
        Read(seriesId, stray);

        var withMissing = await new ContinueReadingService(_db.NewContext())
            .NextForAsync(seriesId, CancellationToken.None, includeMissing: true);

        Assert.Equal(first, withMissing!.ChapterId);
    }

    /// <summary>
    /// Anjo the Mischievous Gal as found on the test install: 1-147 read, a skipped special (143.5)
    /// and a one-shot neither wanted nor downloaded, 148 onwards wanted but missing, and a stray read
    /// of 231 whose file auto-delete already removed. Read used to offer the unwanted one-shot.
    /// </summary>
    [Fact]
    public async Task Unwanted_specials_and_one_shots_are_not_offered_over_the_next_main_chapter()
    {
        var seriesId = _db.SeedSeries();
        for (var n = 1; n <= 147; n++)
        {
            Read(seriesId, Seed(seriesId, n, null));
        }

        var special = Seed(seriesId, 143.5m, null, downloaded: false);
        var next = Seed(seriesId, 148, null, downloaded: false);
        Seed(seriesId, 149, null, downloaded: false);
        var stray = Seed(seriesId, 231, null, downloaded: false);
        Read(seriesId, stray);
        int oneShot;
        using (var db = _db.NewContext())
        {
            var chapter = new Chapter { SeriesId = seriesId, Language = "en", IsOneShot = true, Wanted = false };
            db.Chapters.Add(chapter);
            db.Chapters.Where(c => c.Id == special || c.Id == stray).ToList().ForEach(c => c.Wanted = false);
            db.SaveChanges();
            oneShot = chapter.Id;
        }

        var withMissing = await new ContinueReadingService(_db.NewContext())
            .NextForAsync(seriesId, CancellationToken.None, includeMissing: true);

        Assert.Equal(next, withMissing!.ChapterId);
        Assert.NotEqual(oneShot, withMissing.ChapterId);
        Assert.False(withMissing.Downloaded);
    }
}
