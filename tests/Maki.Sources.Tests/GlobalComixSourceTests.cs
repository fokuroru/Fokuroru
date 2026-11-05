using System.Net;
using Maki.Core.Sources;
using Maki.Sources.GlobalComix;

namespace Maki.Sources.Tests;

public class GlobalComixSourceTests
{
    private const string Home = """<script>window.gc={"global":{"api_url":"https:\/\/api.globalcomix.com","api_key":"gck_abc123"}}</script>""";

    private static (GlobalComixSource Source, FakeHttpClientFactory Http) SourceFor(Dictionary<string, string> responses)
    {
        responses["https://globalcomix.com/"] = Home;
        var http = new FakeHttpClientFactory(responses);
        return (new GlobalComixSource(http), http);
    }

    [Fact]
    public async Task Releases_become_chapters_and_drafts_are_left_out()
    {
        var (source, _) = SourceFor(new()
        {
            ["v1/read/the-forbidden-lust-of-a-frigid-girl"] = FakeHttpClientFactory.Fixture("globalcomix-read.json"),
            ["v1/comics/32599/releases"] = FakeHttpClientFactory.Fixture("globalcomix-releases.json")
        });

        var chapters = await source.ListChaptersAsync("the-forbidden-lust-of-a-frigid-girl");

        Assert.Equal([1m, 2m, 3m], chapters.Select(c => c.Number).Order());
        var first = chapters.Single(c => c.Number == 1);
        Assert.Equal("First discovery", first.Title);
        Assert.Equal("en", first.Language);
        Assert.Equal("0c10acc0-f437-4de9-aab9-c102ac7da530", first.SourceChapterId);
        Assert.Equal(new DateTime(2025, 10, 26, 19, 0, 0, DateTimeKind.Utc), first.ReleaseDate);
    }

    [Fact]
    public async Task Search_results_are_user_generated_and_credit_the_creator()
    {
        var (source, _) = SourceFor(new() { ["v1/search/query?q=frigid"] = FakeHttpClientFactory.Fixture("globalcomix-search.json") });

        var results = await source.SearchAsync("frigid");

        var hit = results.First();
        Assert.Equal("frigid", hit.SourceSeriesId);
        Assert.Equal("https://globalcomix.com/c/frigid", hit.Url);
        Assert.True(hit.UserGenerated);
        Assert.Equal("AzythothianArtist", hit.Author);
    }

    [Theory]
    [InlineData("https://globalcomix.com/c/the-forbidden-lust-of-a-frigid-girl", "the-forbidden-lust-of-a-frigid-girl")]
    [InlineData("https://globalcomix.com/c/kingdom-of-tundris/r/737b30cf-98e6-4aaf-8851-5321b23d4134", "kingdom-of-tundris")]
    [InlineData("https://globalcomix.com/a/thabfu", null)]
    public void Series_urls_resolve_to_the_slug(string url, string? expected) =>
        Assert.Equal(expected, new GlobalComixSource(new FakeHttpClientFactory([])).ResolveSeriesIdFromUrl(new Uri(url)));

    [Fact]
    public void The_reader_token_is_read_from_the_cookie_the_release_sets()
    {
        using var response = new HttpResponseMessage(HttpStatusCode.OK);
        response.Headers.Add("Set-Cookie", "gc_reader_auth=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/");
        response.Headers.Add("Set-Cookie", "gc_reader_auth=eyJ.token.sig; Path=/; Domain=.globalcomix.com; Secure; HttpOnly");

        Assert.Equal("eyJ.token.sig", GlobalComixSource.ReaderToken(response));
        Assert.Equal("gck_abc123", GlobalComixSource.ClientKeyOf(Home));
    }
}
