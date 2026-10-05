using System.Net;
using System.Text;
using Maki.Core.Sources;
using Maki.Sources.Suwayomi;

namespace Maki.Sources.Tests;

[Collection(BaseUrlOverrideCollection.Name)]
public class SuwayomiSourceTests : IDisposable
{
    private readonly BaseUrlOverride _baseUrl = new(SuwayomiSource.BaseUrlVariable, "http://suwayomi.test:4567");
    private readonly BaseUrlOverride _publicUrl = new(SuwayomiSource.PublicUrlVariable, "http://suwayomi.example:4568");

    public void Dispose()
    {
        _publicUrl.Dispose();
        _baseUrl.Dispose();
    }

    /// <summary>Answers GraphQL posts by what the query asks for, and page GETs by path.</summary>
    private sealed class FakeSuwayomi : IHttpClientFactory
    {
        public List<string> Queries { get; } = [];

        public HttpClient CreateClient(string name) =>
            new(new Handler(Queries)) { BaseAddress = new Uri("http://suwayomi.test:4567/") };

        private sealed class Handler(List<string> queries) : HttpMessageHandler
        {
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                if (request.Method == HttpMethod.Get)
                {
                    var path = request.RequestUri!.AbsolutePath;
                    return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Encoding.ASCII.GetBytes(path)) };
                }

                var body = await request.Content!.ReadAsStringAsync(ct);
                queries.Add(body);
                var json = body switch
                {
                    _ when body.Contains("sources { nodes") =>
                        """{"data":{"sources":{"nodes":[{"id":"0","name":"Local source","lang":"localsourcelang"},{"id":"11","name":"Alpha","lang":"en"},{"id":"22","name":"Broken","lang":"en"},{"id":"33","name":"Alpha","lang":"cs"}]}}}""",
                    _ when body.Contains("fetchSourceManga") && body.Contains("\"source\":\"22\"") =>
                        """{"data":null,"errors":[{"message":"java.io.IOException: timeout\nat x"}]}""",
                    _ when body.Contains("fetchSourceManga") =>
                        """{"data":{"fetchSourceManga":{"mangas":[{"id":7,"title":"Solo Leveling","description":"Hunters","realUrl":"https://site.test/solo-leveling"},{"id":8,"title":"Solo Leveling: Ragnarok","description":null,"realUrl":null}]}}}""",
                    _ when body.Contains("source { lang }") =>
                        """{"data":{"manga":{"source":{"lang":"all"}}}}""",
                    _ when body.Contains("fetchChapters") && body.Contains("\"id\":8}") =>
                        """{"data":null,"errors":[{"message":"Exception while fetching data (/fetchChapters) : No chapters found\r\n\r\njava.lang.Exception"}]}""",
                    _ when body.Contains("fetchChapters") =>
                        """{"data":{"fetchChapters":{"chapters":[{"id":101,"name":"Chapter 1","chapterNumber":1.0,"uploadDate":"1728103501630","scanlator":"Grp","url":"/a"},""" +
                        """{"id":102,"name":"Chapter 2.5","chapterNumber":2.5,"uploadDate":"0","scanlator":null,"url":"/b"},""" +
                        """{"id":103,"name":"Chapter 3","chapterNumber":-1.0,"uploadDate":"0","scanlator":null,"url":"/c"}]}}}""",
                    _ when body.Contains("fetchChapterPages") =>
                        """{"data":{"fetchChapterPages":{"pages":["/api/v1/manga/7/chapter/101/page/0","/api/v1/manga/7/chapter/101/page/1"]}}}""",
                    _ when body.Contains("manga(id") =>
                        """{"data":{"manga":{"id":7,"title":"Solo Leveling","description":"Hunters","status":"COMPLETED","thumbnailUrl":"/x"}}}""",
                    _ => """{"data":null,"errors":[{"message":"unexpected"}]}"""
                };
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
            }
        }
    }

    [Fact]
    public async Task Search_asks_each_english_extension_and_survives_one_that_fails()
    {
        var factory = new FakeSuwayomi();
        var results = await new SuwayomiSource(factory).SearchAsync("solo leveling");

        // 8 is a title its site lists but has no chapters for, so it is not offered.
        Assert.Equal(["7"], results.Select(r => r.SourceSeriesId));
        Assert.Equal("Solo Leveling", results[0].Title);
        // The site's own page when the extension knows it, else the Suwayomi page, under the public
        // address a browser can reach rather than the internal one Maki talks to.
        Assert.Equal("https://site.test/solo-leveling", results[0].Url);
        // The built-in local source and the Czech edition are skipped; the two English ones are searched.
        Assert.Equal(2, factory.Queries.Count(q => q.Contains("fetchSourceManga")));
    }

    [Fact]
    public async Task Search_covers_the_languages_asked_for()
    {
        using var czech = new BaseUrlOverride(SuwayomiSource.LanguagesVariable, "cs");
        var factory = new FakeSuwayomi();

        await new SuwayomiSource(factory).SearchAsync("solo leveling");

        Assert.Equal(1, factory.Queries.Count(q => q.Contains("fetchSourceManga")));
    }

    [Fact]
    public async Task ListChapters_is_empty_not_an_error_when_the_site_has_none()
    {
        Assert.Empty(await new SuwayomiSource(new FakeSuwayomi()).ListChaptersAsync("8"));
    }

    [Fact]
    public async Task Search_returns_nothing_without_a_configured_server()
    {
        using var unset = new BaseUrlOverride(SuwayomiSource.BaseUrlVariable, "");
        var factory = new FakeSuwayomi();

        Assert.Empty(await new SuwayomiSource(factory).SearchAsync("solo leveling"));
        Assert.Empty(factory.Queries);
    }

    [Fact]
    public async Task GetSeries_maps_status_and_description()
    {
        var detail = await new SuwayomiSource(new FakeSuwayomi()).GetSeriesAsync("7");

        Assert.Equal("Solo Leveling", detail.Title);
        Assert.Equal("Completed", detail.Status);
        Assert.Equal("Hunters", detail.Description);
    }

    [Fact]
    public async Task ListChapters_reads_numbers_dates_groups_and_falls_back_to_the_name()
    {
        var chapters = await new SuwayomiSource(new FakeSuwayomi()).ListChaptersAsync("7");

        Assert.Equal([1m, 2.5m, 3m], chapters.Select(c => c.Number));
        Assert.Equal(["101", "102", "103"], chapters.Select(c => c.SourceChapterId));
        Assert.Equal("Grp", chapters[0].Group);
        Assert.Equal(new DateTime(2024, 10, 5, 4, 5, 1, DateTimeKind.Utc).Date, chapters[0].ReleaseDate?.Date);
        Assert.Null(chapters[1].ReleaseDate);
        // An "all" language extension does not name one, so chapters default to English.
        Assert.All(chapters, c => Assert.Equal("en", c.Language));
        Assert.All(chapters, c => Assert.Equal("suwayomi", c.SourceName));
    }

    [Fact]
    public async Task GetPages_hands_over_the_page_bytes()
    {
        var chapter = new SourceChapter("suwayomi", "7", "101", "1", 1m, null, null, "en", null);
        var pages = (await new SuwayomiSource(new FakeSuwayomi()).GetPagesAsync(chapter)).Pages;

        Assert.Equal(2, pages.Count);
        Assert.Equal("/api/v1/manga/7/chapter/101/page/0", System.Text.Encoding.ASCII.GetString(pages[0].Data!));
        Assert.Equal("/api/v1/manga/7/chapter/101/page/1", System.Text.Encoding.ASCII.GetString(pages[1].Data!));
    }

    [Theory]
    [InlineData("http://suwayomi.example:4568/manga/7", "7")]
    [InlineData("http://suwayomi.example:4568/manga/7/chapter/101", "7")]
    [InlineData("http://suwayomi.example:4568/manga/abc", null)]
    [InlineData("http://elsewhere.test/manga/7", null)]
    public void ResolveSeriesIdFromUrl(string url, string? expected) =>
        Assert.Equal(expected, ((ISource)new SuwayomiSource(new FakeSuwayomi())).ResolveSeriesIdFromUrl(new Uri(url)));
}
