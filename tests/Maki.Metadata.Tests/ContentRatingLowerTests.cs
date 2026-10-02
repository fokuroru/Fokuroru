using Maki.Metadata.MangaBaka;
using Xunit;

namespace Maki.Metadata.Tests;

public class ContentRatingLowerTests
{
    [Theory]
    [InlineData("pornographic", "safe", "safe")]
    [InlineData("safe", "pornographic", "safe")]
    [InlineData("erotica", "suggestive", "suggestive")]
    [InlineData("suggestive", "erotica", "suggestive")]
    [InlineData("erotica", "erotica", "erotica")]
    public void TheStricterCeilingWins(string first, string second, string expected)
    {
        Assert.Equal(expected, ContentRating.Lower(first, second));
    }

    [Fact]
    public void AnUnrecognisedCeilingNeverWidensTheOther()
    {
        Assert.Equal("suggestive", ContentRating.Lower("suggestive", "nonsense"));
        Assert.Equal("suggestive", ContentRating.Lower(null, "suggestive"));
        Assert.Equal(ContentRating.Default, ContentRating.Lower(null, null));
    }
}
