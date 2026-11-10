using Maki.Sources.WanderingInn;

namespace Maki.Sources.Tests;

public class WanderingInnSourceTests
{
    private const string Posts =
        """
        [
          {"slug":"chapter-1-page-2","modified":"2024-07-02T10:00:00","content":{"rendered":"<figure><img src=\"https://x.test/p2.jpg\"></figure>"}},
          {"slug":"chapter-1-page-1","modified":"2024-07-01T10:00:00","content":{"rendered":"<figure><img src=\"https://x.test/p1.jpg\"></figure>"}},
          {"slug":"chapter-1-page-3-and-4","modified":"2024-07-03T10:00:00","content":{"rendered":"<figure><img src=\"https://x.test/p34.jpg\"></figure>"}},
          {"slug":"chapter-2-page-1","modified":"2024-08-01T10:00:00","content":{"rendered":"<figure><img src=\"https://x.test/c2.jpg\"></figure>"}},
          {"slug":"rough-landing-page-1","modified":"2024-09-01T10:00:00","content":{"rendered":"<img src=\"https://x.test/rl.jpg\">"}}
        ]
        """;

    private static WanderingInnSource Source() =>
        new(new FakeHttpClientFactory(new() { ["wp-json/wp/v2/posts"] = Posts }));

    [Fact]
    public async Task ListChapters_groups_pages_into_numbered_chapters_and_skips_side_comics()
    {
        var chapters = await Source().ListChaptersAsync(WanderingInnSource.SeriesId);

        Assert.Equal([1m, 2m], chapters.Select(c => c.Number));
        Assert.Equal(new DateTime(2024, 7, 3, 10, 0, 0), chapters[0].ReleaseDate);
        Assert.Equal([3, 1], chapters.Select(c => c.PageCount));
    }

    [Fact]
    public async Task GetPages_returns_a_chapters_images_in_page_order()
    {
        var source = Source();
        var chapter = (await source.ListChaptersAsync(WanderingInnSource.SeriesId))[0];

        var pages = await source.GetPagesAsync(chapter);

        Assert.Equal(["https://x.test/p1.jpg", "https://x.test/p2.jpg", "https://x.test/p34.jpg"], pages.Pages.Select(p => p.Url));
    }
}
