using Maki.Api.Services;
using Maki.Core.Entities;

namespace Maki.Api.Tests;

public class ChapterSequenceRuleTests
{
    private static ChapterSequence.Row R(int id, decimal? number, string? title, int? file, int pages) =>
        new(id, number, "en", title, file, pages);

    private static readonly Dictionary<int, int?> Files = new() { [2581] = 45 };

    private static List<ChapterSequence.Row> Series() =>
    [
        // Inside a 45-page volume archive: chapters 0..9 of 4 pages (7 for the prologue).
        R(1, 0, "Rhythm A", 2581, 7),
        .. Enumerable.Range(1, 9).Select(n => R(10 + n, n, $"Chapter {n}", 2581, 4)),
    ];

    [Fact]
    public void A_loose_copy_of_a_volumes_titled_bonus_is_ignored()
    {
        var rows = Series();
        rows.Add(R(500, 0.5m, "Rhythm A", 1487, 6)); // the same chapter, numbered 0.5 by another source

        var ignored = ChapterSequence.Ignored(rows, Files);

        Assert.Contains(500, ignored);
        Assert.DoesNotContain(1, ignored);
    }

    [Fact]
    public void A_volume_backed_row_beats_a_loose_row_of_the_same_number()
    {
        var rows = Series();
        rows.Add(R(501, 3, "Chapter 3", 1488, 4));

        var ignored = ChapterSequence.Ignored(rows, Files);

        Assert.Contains(501, ignored);
        Assert.DoesNotContain(13, ignored);
    }

    [Fact]
    public void A_volume_that_does_not_add_up_loses_to_the_loose_copy()
    {
        var rows = Series();
        rows.Add(R(501, 3, "Chapter 3", 1488, 4));

        // The shared archive has 12 pages for 10 chapters of 4: truncated.
        var ignored = ChapterSequence.Ignored(rows, new Dictionary<int, int?> { [2581] = 12 });

        Assert.Contains(13, ignored);
        Assert.DoesNotContain(501, ignored);
    }

    [Fact]
    public void A_whole_volume_filed_under_a_fractional_number_is_ignored()
    {
        var rows = Series();
        rows.Add(R(502, 1.1m, "Chapter 1.1", 1489, 185));
        rows.Add(R(503, 37.5m, "Rhythm B", 1490, 23)); // a real bonus: longer than a chapter, but not a volume

        var ignored = ChapterSequence.Ignored(rows, Files);

        Assert.Contains(502, ignored);
        Assert.DoesNotContain(503, ignored);
    }

    private static List<Chapter> Wanted()
    {
        Chapter C(int id, decimal? number, int? volume, string? title) =>
            new() { Id = id, SeriesId = 1, Number = number, Volume = volume, Title = title, Wanted = true };
        return [C(1, 1, 1, "Chapter 1"), C(2, 2, 1, "Chapter 2"), C(3, 40, 2, "Chapter 40"), C(900, null, 1, "Volume 1")];
    }

    [Fact]
    public void A_volume_a_source_offers_replaces_its_chapters_in_the_download()
    {
        var swapped = ChapterSequence.PreferVolumes([1, 2, 3], Wanted(), new HashSet<int>());

        Assert.Equal([900, 3], swapped);
    }

    [Fact]
    public void A_volume_already_failing_falls_back_to_its_chapters()
    {
        var swapped = ChapterSequence.PreferVolumes([1, 2, 3], Wanted(), new HashSet<int> { 900 });

        Assert.Equal([1, 2, 3], swapped);
    }
}
