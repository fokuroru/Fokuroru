using Maki.Api.Services;

namespace Maki.Api.Tests;

public class SeriesProgressTests
{
    private static int _id;

    private static ProgChapter C(
        decimal? number, int? volume = null, int? file = null, bool wanted = true, string? title = null,
        int? placedVolume = null, decimal? placedAfter = null, bool completed = false, bool started = false,
        int page = 0, int pages = 4) =>
        new(++_id, number, "en", volume, placedVolume, placedAfter, title, false, wanted, file, file is null ? null : pages,
            false, completed, started, page, started ? pages : 0, started ? DateTime.UtcNow : null);

    // Volume 1 is chapters 0-3, volume 2 starts at 38: continuous numbering, as in the real series.
    private static List<ProgChapter> Series(params ProgChapter[] extra) =>
    [
        C(0, 1, file: 1, title: "Rhythm A"), C(1, 1, file: 1), C(2, 1, file: 1), C(3, 1, file: 1),
        C(38, 2, file: 2), C(39, 2, file: 2), C(40, 2), C(41, 2),
        .. extra,
    ];

    private static readonly ProgFile[] Files =
    [
        new(1, "Vol.1.cbz", 80, 184, "torrent"), new(2, "Vol.2.cbz", 77, 167, "torrent"),
        new(10, "Ch.2025.cbz", 1, 7, "suwayomi"), new(11, "Ch.3.5.cbz", 1, 2, "atsumaru"),
        new(12, "Spare.cbz", 1, 5, "relink"), new(13, "Magazine.cbz", 4, 10, "dynasty"),
        new(14, "Ch.3.7.cbz", 1, 6, "mangadex"),
    ];

    [Fact]
    public void Chapters_group_by_volume_with_counts_that_add_up()
    {
        var progress = SeriesProgressBuilder.Build(Series(), Files);

        Assert.Equal([1, 2], progress.Volumes.Select(v => v.Volume).ToList());
        var one = progress.Volumes[0];
        Assert.Equal((4, 4, 0, 0, 0), (one.Chapters, one.Ready, one.Read, one.Started, one.Missing));
        var two = progress.Volumes[1];
        Assert.Equal((4, 2, 2), (two.Chapters, two.Ready, two.Missing));
        Assert.Equal(new ProgressTotals(8, 6, 0, 2), progress.Totals);
        Assert.Equal((38m, 41m), (two.From, two.To));
    }

    [Fact]
    public void A_chapter_listed_under_two_volumes_is_one_chapter_and_is_called_out()
    {
        var progress = SeriesProgressBuilder.Build(Series(C(0, 2, file: 1, title: "Chapter 0")), Files);

        Assert.Equal(["0"], progress.NeedsLook.Single(n => n.Kind == "duplicateNumber").Numbers);
        // The row under the volume its number belongs to is the one shown.
        Assert.Single(progress.Volumes[0].Rows, r => r.Kind == "chapter" && r.Number == "0");
        Assert.Equal(4, progress.Volumes[0].Chapters);
    }

    [Fact]
    public void A_bonus_the_source_lists_under_a_volume_sits_after_the_chapter_it_follows()
    {
        var bonus = C(3.5m, 1, file: 11, wanted: false, title: "Rhythm B", pages: 23);
        var progress = SeriesProgressBuilder.Build(Series(bonus), Files);

        var rows = progress.Volumes[0].Rows.Select(r => r.Number).ToList();
        Assert.Equal(["0", "1", "2", "3", "3.5"], rows);
        Assert.Equal("source", progress.Volumes[0].Rows.Last().Why);
        Assert.Equal("bonus", progress.Volumes[0].Rows.Last().Kind);
        Assert.Equal(1, progress.Volumes[0].Bonus);
    }

    [Fact]
    public void A_bonus_with_a_file_but_no_volume_follows_its_number_into_the_volume_of_the_chapter_before_it()
    {
        var progress = SeriesProgressBuilder.Build(Series(C(2.5m, file: 14)), Files);

        Assert.Equal("number", progress.Volumes[0].Rows.Single(r => r.Number == "2.5").Why);
        Assert.Equal(["0", "1", "2", "2.5", "3"], progress.Volumes[0].Rows.Select(r => r.Number).ToList());
    }

    [Fact]
    public void A_bonus_without_a_number_goes_to_the_end_of_its_volume()
    {
        var progress = SeriesProgressBuilder.Build(Series(C(null, 2, file: 13, wanted: false, title: "Moonlight Magazine")), Files);

        Assert.Equal("Moonlight Magazine", progress.Volumes[1].Rows.Last().Title);
    }

    [Fact]
    public void What_has_no_evidence_is_left_to_place_and_a_phantom_listing_is_only_counted()
    {
        var progress = SeriesProgressBuilder.Build(
            Series(C(2025, file: 10), C(1.1m, wanted: false), C(1.2m, wanted: false)), Files);

        var year = progress.Unplaced.Single(u => u.FileName == "Ch.2025.cbz");
        Assert.Equal("year", year.Hint);
        Assert.Equal(2, progress.NeedsLook.Single(n => n.Kind == "hiddenListings").Count);
        Assert.DoesNotContain(progress.Volumes.SelectMany(v => v.Rows), r => r.Number is "1.1" or "1.2" or "2025");
        // A file nothing points at is offered too.
        Assert.Contains(progress.Unplaced, u => u is { FileId: 12, Hint: "unlinked", ChapterId: null });
    }

    [Fact]
    public void A_users_placement_wins_and_moves_it_into_the_volume_after_the_chapter_they_chose()
    {
        var progress = SeriesProgressBuilder.Build(
            Series(C(2025, file: 10, placedVolume: 1, placedAfter: 2)), Files);

        Assert.Empty(progress.Unplaced.Where(u => u.FileName == "Ch.2025.cbz"));
        var rows = progress.Volumes[0].Rows;
        Assert.Equal(["0", "1", "2", "2025", "3"], rows.Select(r => r.Number).ToList());
        Assert.Equal("user", rows.Single(r => r.Number == "2025").Why);
    }

    [Fact]
    public void The_start_of_a_volume_is_a_place_too()
    {
        var progress = SeriesProgressBuilder.Build(Series(C(null, file: 10, title: "Cover story", placedVolume: 2, placedAfter: -1)), Files);

        Assert.Equal("Cover story", progress.Volumes[1].Rows.First().Title);
    }

    [Fact]
    public void Where_you_are_is_the_chapter_you_are_part_way_through_and_what_follows_is_ready_to_read()
    {
        var progress = SeriesProgressBuilder.Build(Series(), Files);
        Assert.Equal(("Vol.1 Ch.0", false), (progress.Position!.Label, progress.Position.InProgress));

        var reading = new List<ProgChapter>
        {
            C(0, 1, file: 1, completed: true), C(1, 1, file: 1, started: true, page: 3, pages: 6), C(2, 1, file: 1), C(3, 1, file: 1),
        };
        var position = SeriesProgressBuilder.Build(reading, Files).Position!;
        Assert.Equal(("Vol.1 Ch.1", 4, 6, true), (position.Label, position.Page, position.PageCount, position.InProgress));
        Assert.Equal(["Vol.1 Ch.2", "Vol.1 Ch.3"], position.Next);
    }

    [Fact]
    public void A_bonus_that_only_has_the_whole_volume_file_is_not_shown_as_something_to_read()
    {
        // 9.1-style listing: linked to the 184-page volume with the volume's own page count, so it is not really in it.
        var extra = C(2.5m, 1, file: 1, wanted: false, title: "Character bios", pages: 184);
        var progress = SeriesProgressBuilder.Build(Series(extra), Files);

        var row = progress.Volumes[0].Rows.Single(r => r.Number == "2.5");
        Assert.Equal("skipped", row.State);
        Assert.Null(row.Pages);
        Assert.Equal(4, progress.Volumes[0].Ready);
    }

    [Fact]
    public void A_volume_entry_is_neither_a_chapter_nor_a_bonus_nor_where_you_are()
    {
        var volumeEntry = C(null, 1, file: 1, title: "Volume 1", started: true, page: 3, pages: 184);
        var progress = SeriesProgressBuilder.Build(Series(volumeEntry), Files);

        Assert.DoesNotContain(progress.Volumes.SelectMany(v => v.Rows), r => r.ChapterId == volumeEntry.Id);
        Assert.Equal("Vol.1 Ch.0", progress.Position!.Label);
        Assert.Empty(progress.Unplaced.Where(u => u.ChapterId == volumeEntry.Id));
    }

    [Fact]
    public void A_chapter_read_under_any_row_of_its_number_counts_as_read()
    {
        var progress = SeriesProgressBuilder.Build(Series(C(1, 1, file: 1, completed: true)), Files);

        Assert.Equal(1, progress.Volumes[0].Read);
        Assert.Equal(1, progress.Totals.Read);
    }
}
