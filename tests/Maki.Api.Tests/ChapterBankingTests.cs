using Maki.Api.Services;
using Xunit;

namespace Maki.Api.Tests;

public class ChapterBankingTests
{
    private static ChapterBanking.Row C(
        int number, bool read = false, bool file = true, bool wanted = true, bool released = false, bool isNew = true) =>
        new(number, number, null, wanted, file, released, read, isNew);

    private static List<int> Banked(params ChapterBanking.Row[] rows) => ChapterBanking.BankedIn(rows).Order().ToList();

    [Fact]
    public void New_chapters_after_the_last_read_are_banked()
    {
        Assert.Equal([4, 5], Banked(C(1, true), C(2, true), C(3, true), C(4), C(5, file: false)));
    }

    [Fact]
    public void A_backlog_of_older_unread_chapters_means_nothing_is_banked()
    {
        // Mid-series: the unread chapters ahead were never "new releases", so none is held back.
        Assert.Empty(Banked(C(1, true), C(2, true), C(3, isNew: false), C(4, isNew: false)));
        Assert.Empty(Banked(C(1, true), C(2, isNew: false), C(3)));
    }

    [Fact]
    public void Nothing_is_banked_for_a_series_that_has_not_been_read()
    {
        Assert.Empty(Banked(C(1), C(2)));
    }

    [Fact]
    public void An_unread_chapter_behind_the_furthest_read_means_the_reader_is_catching_up()
    {
        Assert.Empty(Banked(C(1, true), C(2), C(3, true), C(4)));
    }

    [Fact]
    public void A_released_chapter_in_the_batch_stops_banking_so_the_rest_flows()
    {
        Assert.Empty(Banked(C(1, true), C(2, released: true), C(3)));
    }

    [Fact]
    public void Chapters_the_reader_does_not_want_and_has_no_file_for_are_ignored()
    {
        Assert.Equal([3], Banked(C(1, true), C(2, file: false, wanted: false), C(3)));
    }

    [Fact]
    public void A_chapter_read_in_another_language_counts_as_read()
    {
        var rows = new[]
        {
            new ChapterBanking.Row(1, 1, null, true, true, false, true),
            new ChapterBanking.Row(2, 1, null, true, true, false, false),
            new ChapterBanking.Row(3, 2, null, true, true, false, false),
        };
        Assert.Equal([3], ChapterBanking.BankedIn(rows).ToList());
    }
}
