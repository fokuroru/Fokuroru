using Maki.Core.Entities;

namespace Maki.Core.Tests;

public class ReadingStatusTests
{
    private static decimal[] Main(int last) => Enumerable.Range(1, last).Select(n => (decimal)n).ToArray();

    private static HashSet<decimal> Read(params decimal[] numbers) => [.. numbers];

    [Theory]
    [InlineData(SeriesStatus.Completed)]
    [InlineData(SeriesStatus.Cancelled)]
    [InlineData(SeriesStatus.Hiatus)]
    public void Every_main_release_read_on_an_ended_or_paused_series_is_completed(SeriesStatus status) =>
        Assert.Equal(ReadingStatus.Completed, ReadingStatuses.For(status, Main(10), Read(Main(10))));

    [Theory]
    [InlineData(SeriesStatus.Ongoing)]
    [InlineData(SeriesStatus.Unknown)]
    public void Every_main_release_read_on_a_running_series_is_up_to_date_not_completed(SeriesStatus status) =>
        Assert.Equal(ReadingStatus.UpToDate, ReadingStatuses.For(status, Main(10), Read(Main(10))));

    [Fact]
    public void Reading_only_the_last_chapter_is_still_reading() =>
        Assert.Equal(ReadingStatus.Reading, ReadingStatuses.For(SeriesStatus.Completed, Main(10), Read(10m)));

    [Fact]
    public void A_middle_chapter_marked_unread_again_is_reading()
    {
        var read = Read(Main(10));
        read.Remove(5m);

        Assert.Equal(ReadingStatus.Reading, ReadingStatuses.For(SeriesStatus.Completed, Main(10), read));
    }

    [Fact]
    public void Unread_specials_do_not_hold_a_series_back() =>
        // The caller only passes whole numbers as main releases; 5.5 read or not makes no difference.
        Assert.Equal(ReadingStatus.Completed, ReadingStatuses.For(SeriesStatus.Completed, Main(10), Read(Main(10))));

    [Fact]
    public void A_series_with_no_numbered_chapters_is_reading() =>
        Assert.Equal(ReadingStatus.Reading, ReadingStatuses.For(SeriesStatus.Completed, [], Read(3m)));

    [Fact]
    public void Specials_are_not_main_releases()
    {
        Assert.True(ReadingStatuses.IsMain(12m));
        Assert.False(ReadingStatuses.IsMain(12.5m));
        Assert.False(ReadingStatuses.IsMain(null));
        Assert.False(ReadingStatuses.IsMain(0m));
    }
}
