using Maki.Api.Services;
using Maki.Core.Entities;

namespace Maki.Api.Tests;

public class SeriesReadingServiceTests : IDisposable
{
    private readonly TestDb _db = new();

    public void Dispose() => _db.Dispose();

    /// <summary>Chapters 1..last in English, plus any extra rows, with the given numbers completed.</summary>
    private (int SeriesId, Dictionary<(decimal, string), int> Ids) Seed(
        SeriesStatus status, int last, decimal[] read, params (decimal Number, string Language, bool HasFile)[] extra)
    {
        var seriesId = _db.SeedSeries(configure: s => s.Status = status);
        using var db = _db.NewContext();
        var file = new ChapterFile { SeriesId = seriesId, RelativePath = "x.cbz", DateAdded = DateTime.UtcNow };
        db.ChapterFiles.Add(file);
        db.SaveChanges();

        var rows = Enumerable.Range(1, last).Select(n => ((decimal)n, "en", true)).Concat(extra).ToList();
        var ids = new Dictionary<(decimal, string), int>();
        foreach (var (number, language, hasFile) in rows)
        {
            var chapter = new Chapter
            {
                SeriesId = seriesId, Number = number, Language = language, ChapterFileId = hasFile ? file.Id : null,
            };
            db.Chapters.Add(chapter);
            db.SaveChanges();
            ids[(number, language)] = chapter.Id;
        }

        foreach (var number in read)
        {
            var id = ids.First(kv => kv.Key.Item1 == number).Value;
            db.ChapterProgress.Add(new ChapterProgress
            {
                UserId = 1, SeriesId = seriesId, ChapterId = id, Completed = true,
                StartedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
        }

        db.SaveChanges();
        return (seriesId, ids);
    }

    private async Task<SeriesReading?> For(int seriesId, SeriesStatus status)
    {
        using var db = _db.NewContext();
        return (await SeriesReadingService.ForAsync(db, new() { [seriesId] = status }, default))
            .GetValueOrDefault(seriesId);
    }

    private static decimal[] Upto(int last) => Enumerable.Range(1, last).Select(n => (decimal)n).ToArray();

    [Fact]
    public async Task Reading_only_the_last_chapter_is_reading()
    {
        var (id, _) = Seed(SeriesStatus.Completed, 10, [10m]);

        var reading = await For(id, SeriesStatus.Completed);

        Assert.Equal(ReadingStatus.Reading, reading!.Status);
        Assert.Equal(1, reading.ReadMain);
        Assert.Equal(10, reading.TotalMain);
    }

    [Fact]
    public async Task Every_main_chapter_read_is_completed_when_ended_and_up_to_date_when_running()
    {
        var (ended, _) = Seed(SeriesStatus.Completed, 10, Upto(10));
        var (running, _) = Seed(SeriesStatus.Ongoing, 10, Upto(10));

        Assert.Equal(ReadingStatus.Completed, (await For(ended, SeriesStatus.Completed))!.Status);
        Assert.Equal(ReadingStatus.UpToDate, (await For(running, SeriesStatus.Ongoing))!.Status);
    }

    [Fact]
    public async Task Marking_a_middle_chapter_unread_is_reading_again()
    {
        var (id, ids) = Seed(SeriesStatus.Completed, 10, Upto(10));
        using (var db = _db.NewContext())
        {
            var chapterId = ids[(5m, "en")];
            var row = db.ChapterProgress.Single(p => p.ChapterId == chapterId);
            row.Completed = false;
            row.UnreadAt = DateTime.UtcNow;
            db.SaveChanges();
        }

        Assert.Equal(ReadingStatus.Reading, (await For(id, SeriesStatus.Completed))!.Status);
    }

    [Fact]
    public async Task Specials_and_a_second_language_do_not_hold_a_finished_series_back()
    {
        var (id, _) = Seed(SeriesStatus.Completed, 3, Upto(3), (2.5m, "en", true), (2m, "es", true));

        var reading = await For(id, SeriesStatus.Completed);

        Assert.Equal(ReadingStatus.Completed, reading!.Status);
        Assert.Equal(3, reading.TotalMain);
    }

    /// <summary>
    /// Auto-delete keeps progress and drops the file. The history counts must not move, or the
    /// Reading now shelf forgets a series someone is halfway through.
    /// </summary>
    [Fact]
    public async Task Read_chapters_whose_files_were_removed_still_count()
    {
        var (id, ids) = Seed(SeriesStatus.Ongoing, 20, Upto(10));
        using (var db = _db.NewContext())
        {
            foreach (var chapter in db.Chapters.Where(c => c.SeriesId == id && c.Number <= 10))
            {
                chapter.ChapterFileId = null;
                chapter.Wanted = false;
            }

            db.SaveChanges();
        }

        var reading = await For(id, SeriesStatus.Ongoing);

        Assert.Equal(ReadingStatus.Reading, reading!.Status);
        Assert.Equal(10, reading.ReadMain);
        Assert.Equal(20, reading.TotalMain);
    }

    [Fact]
    public async Task Nothing_read_has_no_entry() =>
        Assert.Null(await For(Seed(SeriesStatus.Ongoing, 5, []).SeriesId, SeriesStatus.Ongoing));
}
