using Maki.Api.Services;
using Xunit;

namespace Maki.Api.Tests;

public class SeriesBannerServiceTests
{
    [Fact]
    public void ReadsTheBannerFromAnAniListAnswer()
    {
        Assert.Equal("https://s4.anilist.co/file/anilistcdn/media/manga/banner/1-x.jpg",
            SeriesBannerService.ParseAniList("{\"data\":{\"Media\":{\"bannerImage\":\"https://s4.anilist.co/file/anilistcdn/media/manga/banner/1-x.jpg\"}}}"));
    }

    [Theory]
    [InlineData("{\"data\":{\"Media\":{\"bannerImage\":null}}}")]
    [InlineData("{\"data\":{\"Media\":null}}")]
    [InlineData("{\"errors\":[{\"message\":\"Not Found\"}]}")]
    [InlineData("{\"data\":{\"Media\":{\"bannerImage\":\"http://insecure.example/banner.jpg\"}}}")]
    [InlineData("not json")]
    public void NoUsableBannerFromAniList(string json) => Assert.Null(SeriesBannerService.ParseAniList(json));

    [Fact]
    public void PrefersKitsuLargeCoverAndFallsBackToOriginal()
    {
        Assert.Equal("https://media.kitsu.app/large.jpg",
            SeriesBannerService.ParseKitsu("{\"data\":{\"attributes\":{\"coverImage\":{\"large\":\"https://media.kitsu.app/large.jpg\",\"original\":\"https://media.kitsu.app/o.jpg\"}}}}"));
        Assert.Equal("https://media.kitsu.app/o.jpg",
            SeriesBannerService.ParseKitsu("{\"data\":{\"attributes\":{\"coverImage\":{\"original\":\"https://media.kitsu.app/o.jpg\"}}}}"));
    }

    [Theory]
    [InlineData("{\"data\":{\"attributes\":{\"coverImage\":null}}}")]
    [InlineData("{\"data\":{\"attributes\":{}}}")]
    [InlineData("")]
    public void NoUsableBannerFromKitsu(string json) => Assert.Null(SeriesBannerService.ParseKitsu(json));

    [Fact]
    public void OnlyHttpsPicturesAreFetched()
    {
        Assert.Null(SeriesBannerService.AllowedUrl("http://example.com/a.jpg"));
        Assert.Null(SeriesBannerService.AllowedUrl("file:///etc/passwd"));
        Assert.Null(SeriesBannerService.AllowedUrl("/relative.jpg"));
        Assert.NotNull(SeriesBannerService.AllowedUrl("https://example.com/a.jpg"));
    }
}
