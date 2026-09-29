using Maki.Api.Services;

namespace Maki.Api.Tests;

public class SourcePreviewUrlTests
{
    [Theory]
    [InlineData("https://weebcentral.com/series/01ABC/x", "/chapters/01XYZ", "https://weebcentral.com/chapters/01XYZ")]
    [InlineData("https://mangapill.com/manga/1/x", "https://mangapill.com/chapters/1-1/x", "https://mangapill.com/chapters/1-1/x")]
    [InlineData("https://site.test/manga/x/", "chapter-1", "https://site.test/manga/x/chapter-1")]
    public void Chapter_links_come_back_absolute(string series, string chapter, string expected) =>
        Assert.Equal(expected, SourceMatchService.AbsoluteUrl(series, chapter));

    [Fact]
    public void No_chapter_link_stays_null() => Assert.Null(SourceMatchService.AbsoluteUrl("https://a.test/", null));
}
