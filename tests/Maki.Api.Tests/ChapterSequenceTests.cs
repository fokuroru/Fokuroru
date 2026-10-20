using Maki.Api.Services;
using Maki.Core.Entities;
using Maki.Core.Reading;

namespace Maki.Api.Tests;

/// <summary>
/// "The Guy She Was Interested In Wasn't a Guy at All": thirteen sources, a Yen Press volume archive
/// and a handful of hand-downloaded extras. The numbers and page counts below are the real ones.
/// </summary>
public class ChapterSequenceTests : IDisposable
{
    private readonly TestDb _db = new();

    public void Dispose() => _db.Dispose();

    private int Add(int seriesId, decimal number, int? volume, bool wanted, int pages)
    {
        using var db = _db.NewContext();
        var file = new ChapterFile { SeriesId = seriesId, RelativePath = $"{number}-{volume}.cbz" };
        db.ChapterFiles.Add(file);
        db.SaveChanges();
        var chapter = new Chapter
        {
            SeriesId = seriesId, Number = number, Volume = volume, Wanted = wanted, PageCount = pages, ChapterFileId = file.Id
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
    public void Volume_ones_prologue_sorts_before_the_zero_point_extras()
    {
        var rows = new (int Id, decimal Number, int? Volume)[]
        {
            (774, 0, 2), (1099, 0, 1), (4146, 0.1m, null), (4147, 0.2m, null), (4148, 0.5m, null),
            (775, 1, 1), (4149, 1.1m, null), (819, 36, 1), (820, 37, 1), (824, 38, 2), (827, 39, 2),
        };

        var order = ChapterOrder.Sort(rows, r => r.Number, r => r.Volume, r => r.Id).Select(r => r.Id).ToList();

        // Vol.1 Ch.0 first; the Vol.2 "Ch.0" is a whole-volume entry and waits for its own volume.
        Assert.Equal([1099, 4146, 4147, 4148, 775, 4149, 819, 820, 774, 824, 827], order);
    }

    [Fact]
    public async Task Next_is_volume_ones_prologue_not_an_unwanted_duplicate_or_a_volume_dump()
    {
        var series = _db.SeedSeries();
        var zeroVol2 = Add(series, 0, 2, wanted: true, pages: 7);
        var prologue = Add(series, 0, 1, wanted: true, pages: 7);
        var extra1 = Add(series, 0.1m, null, wanted: false, pages: 15);
        var extra2 = Add(series, 0.2m, null, wanted: false, pages: 16);
        var duplicate = Add(series, 0.5m, null, wanted: false, pages: 6);
        var one = Add(series, 1, 1, wanted: true, pages: 6);
        var dump = Add(series, 1.1m, null, wanted: false, pages: 185);
        foreach (var n in new[] { 2, 3, 4, 5 })
        {
            Add(series, n, 1, wanted: true, pages: 4);
        }

        Read(series, extra1);
        Read(series, extra2);

        Assert.Equal(prologue, await Next(series));

        Read(series, prologue);

        // Not the Vol.2 row for the same chapter 0, not the unwanted 0.5 copy of "Rhythm A", not the
        // 185-page file filed as chapter 1.1.
        var next = await Next(series);
        Assert.Equal(one, next);
        Assert.NotEqual(zeroVol2, next);
        Assert.NotEqual(duplicate, next);
        Assert.NotEqual(dump, next);
    }

    [Fact]
    public async Task An_unwanted_chapter_is_still_next_when_nothing_wanted_is_left()
    {
        var series = _db.SeedSeries();
        var extra = Add(series, 5.5m, null, wanted: false, pages: 10);

        Assert.Equal(extra, await Next(series));
    }
}
