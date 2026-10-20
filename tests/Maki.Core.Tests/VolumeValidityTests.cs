using Maki.Core.Reading;

namespace Maki.Core.Tests;

public class VolumeValidityTests
{
    // "The Guy She Was Interested In Wasn't a Guy at All": chapters are 4 pages.
    [Theory]
    [InlineData(184, 38)] // Vol.1: c000-c037 plus a 23-page bonus
    [InlineData(167, 35)] // Vol.2: c038-c072
    [InlineData(185, 40)] // Vol.3: c073-c112
    public void The_real_volumes_are_valid(int pages, int chapters) =>
        Assert.Equal(VolumeVerdict.Valid, VolumeValidity.Check(pages, chapters, 4));

    [Fact]
    public void A_volume_with_far_too_few_pages_is_too_short() =>
        Assert.Equal(VolumeVerdict.TooShort, VolumeValidity.Check(60, 38, 4));

    [Fact]
    public void A_volume_with_far_too_many_pages_is_too_long() =>
        Assert.Equal(VolumeVerdict.TooLong, VolumeValidity.Check(400, 38, 4));

    [Fact]
    public void Nothing_is_judged_without_a_typical_length_or_with_fewer_than_two_chapters()
    {
        Assert.Equal(VolumeVerdict.Unknown, VolumeValidity.Check(184, 38, 0));
        Assert.Equal(VolumeVerdict.Unknown, VolumeValidity.Check(184, 1, 4));
        Assert.True(VolumeValidity.IsGood(VolumeVerdict.Unknown));
    }

    [Fact]
    public void Typical_is_the_median_and_needs_three_measurements()
    {
        Assert.Equal(0, VolumeValidity.TypicalPages([4, 4]));
        Assert.Equal(4, VolumeValidity.TypicalPages([4, 185, 4, 15, 4, null, 6, 4]));
    }
}
