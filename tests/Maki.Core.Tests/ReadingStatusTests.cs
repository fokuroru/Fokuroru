using Maki.Core.Entities;

namespace Maki.Core.Tests;

public class ReadingStatusTests
{
    [Theory]
    [InlineData(SeriesStatus.Completed)]
    [InlineData(SeriesStatus.Cancelled)]
    [InlineData(SeriesStatus.Hiatus)]
    public void Every_main_release_read_on_an_ended_or_paused_series_is_completed(SeriesStatus status) =>
        Assert.Equal(ReadingStatus.Completed, ReadingStatuses.For(status, 126m, 126m));

    [Theory]
    [InlineData(SeriesStatus.Ongoing)]
    [InlineData(SeriesStatus.Unknown)]
    public void Every_main_release_read_on_a_running_series_is_up_to_date_not_completed(SeriesStatus status) =>
        Assert.Equal(ReadingStatus.UpToDate, ReadingStatuses.For(status, 284m, 284m));

    [Fact]
    public void Main_releases_left_is_reading_whatever_the_series_status()
    {
        Assert.Equal(ReadingStatus.Reading, ReadingStatuses.For(SeriesStatus.Completed, 126m, 125m));
        Assert.Equal(ReadingStatus.Reading, ReadingStatuses.For(SeriesStatus.Ongoing, 284m, null));
    }

    [Fact]
    public void A_series_with_no_numbered_chapters_is_reading() =>
        Assert.Equal(ReadingStatus.Reading, ReadingStatuses.For(SeriesStatus.Completed, null, 3m));

    [Fact]
    public void Specials_are_not_main_releases()
    {
        Assert.True(ReadingStatuses.IsMain(12m));
        Assert.False(ReadingStatuses.IsMain(12.5m));
        Assert.False(ReadingStatuses.IsMain(null));
        Assert.False(ReadingStatuses.IsMain(0m));
    }
}
