using System.Net;
using System.Text;
using Maki.Core.Sources;
using Maki.Sources.Suwayomi;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maki.Sources.Tests;

[Collection(BaseUrlOverrideCollection.Name)]
public class SuwayomiSourceTests : IDisposable
{
    private readonly BaseUrlOverride _baseUrl = new(SuwayomiClient.BaseUrlVariable, "http://suwayomi.test:4567");
    private readonly BaseUrlOverride _publicUrl = new(SuwayomiClient.PublicUrlVariable, "http://suwayomi.example:4568");

    public void Dispose()
    {
        _publicUrl.Dispose();
        _baseUrl.Dispose();
    }

    /// <summary>Answers GraphQL posts by what the query asks for, and page GETs by path.</summary>
    private sealed class FakeSuwayomi : IHttpClientFactory
    {
        public List<string> Queries { get; } = [];
        public bool Down { get; set; }

        public HttpClient CreateClient(string name) =>
            new(new Handler(Queries, this)) { BaseAddress = new Uri("http://suwayomi.test:4567/") };

        private sealed class Handler(List<string> queries, FakeSuwayomi owner) : HttpMessageHandler
        {
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                if (owner.Down)
                {
                    throw new HttpRequestException("connection refused");
                }

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
                        """{"data":{"sources":{"nodes":[{"id":"0","name":"Local source","displayName":"Local source","lang":"localsourcelang","isNsfw":false},{"id":"11","name":"Alpha","displayName":"Alpha (EN)","lang":"en","isNsfw":false},{"id":"22","name":"Beta","displayName":"Beta (EN)","lang":"en","isNsfw":true},{"id":"33","name":"Alpha","displayName":"Alpha (CS)","lang":"cs","isNsfw":false}]}}}""",
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
                    _ when body.Contains("manga(id: $id) { sourceId }") =>
                        """{"data":{"manga":{"sourceId":"11"}}}""",
                    _ when body.Contains("manga(id") =>
                        """{"data":{"manga":{"id":7,"title":"Solo Leveling","description":"Hunters","status":"COMPLETED","realUrl":null}}}""",
                    _ => """{"data":null,"errors":[{"message":"unexpected"}]}"""
                };
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
            }
        }
    }

    private static (SuwayomiExtensionSource Source, FakeSuwayomi Factory) Alpha(string id = "11")
    {
        var factory = new FakeSuwayomi();
        return (new SuwayomiExtensionSource(new SuwayomiClient(factory), id, "Alpha (EN)", "en", nsfw: false), factory);
    }

    [Fact]
    public void Each_extension_is_a_source_of_its_own()
    {
        ISource source = Alpha("11").Source;

        Assert.Equal("suwayomi-11", source.Name);
        Assert.Equal("Alpha (EN) via Suwayomi", source.DisplayName);
        Assert.Equal(["en"], source.SupportedLanguages);
        Assert.Equal(SourceRating.General, source.Rating);
    }

    [Fact]
    public async Task Search_asks_only_its_own_extension_and_drops_a_hit_with_no_chapters()
    {
        var (source, factory) = Alpha();
        var results = await source.SearchAsync("solo leveling");

        // 8 is a title the site lists but has no chapters for, so it is not offered.
        Assert.Equal(["7"], results.Select(r => r.SourceSeriesId));
        Assert.Equal("Solo Leveling", results[0].Title);
        // The site's own page when the extension knows it.
        Assert.Equal("https://site.test/solo-leveling", results[0].Url);
        Assert.Equal(1, factory.Queries.Count(q => q.Contains("fetchSourceManga")));
        Assert.Contains(factory.Queries, q => q.Contains("\"source\":\"11\""));
    }

    [Fact]
    public async Task Search_returns_nothing_when_the_extension_fails()
    {
        Assert.Empty(await Alpha("22").Source.SearchAsync("solo leveling"));
    }

    [Fact]
    public async Task GetSeries_maps_status_and_description_and_links_the_public_address()
    {
        var detail = await Alpha().Source.GetSeriesAsync("7");

        Assert.Equal("Solo Leveling", detail.Title);
        Assert.Equal("Completed", detail.Status);
        Assert.Equal("Hunters", detail.Description);
        // No real URL known: the Suwayomi page under the address a browser can reach, not the internal one.
        Assert.Equal("http://suwayomi.example:4568/manga/7", detail.Url);
    }

    [Fact]
    public async Task ListChapters_reads_numbers_dates_groups_and_falls_back_to_the_name()
    {
        var chapters = await Alpha().Source.ListChaptersAsync("7");

        Assert.Equal([1m, 2.5m, 3m], chapters.Select(c => c.Number));
        Assert.Equal(["101", "102", "103"], chapters.Select(c => c.SourceChapterId));
        Assert.Equal("Grp", chapters[0].Group);
        Assert.Equal(new DateTime(2024, 10, 5), chapters[0].ReleaseDate?.Date);
        Assert.Null(chapters[1].ReleaseDate);
        // An "all" language extension does not name one, so chapters default to English.
        Assert.All(chapters, c => Assert.Equal("en", c.Language));
        Assert.All(chapters, c => Assert.Equal("suwayomi-11", c.SourceName));
    }

    [Fact]
    public async Task ListChapters_is_empty_not_an_error_when_the_site_has_none()
    {
        Assert.Empty(await Alpha().Source.ListChaptersAsync("8"));
    }

    [Fact]
    public async Task GetPages_hands_over_the_page_bytes()
    {
        var chapter = new SourceChapter("suwayomi-11", "7", "101", "1", 1m, null, null, "en", null);
        var pages = (await Alpha().Source.GetPagesAsync(chapter)).Pages;

        Assert.Equal(2, pages.Count);
        Assert.Equal("/api/v1/manga/7/chapter/101/page/0", Encoding.ASCII.GetString(pages[0].Data!));
        Assert.Equal("/api/v1/manga/7/chapter/101/page/1", Encoding.ASCII.GetString(pages[1].Data!));
    }

    [Theory]
    [InlineData("11", "http://suwayomi.example:4568/manga/7", "7")]
    [InlineData("11", "http://suwayomi.example:4568/manga/7/chapter/101", "7")]
    [InlineData("11", "http://suwayomi.example:4568/manga/abc", null)]
    [InlineData("11", "http://elsewhere.test/manga/7", null)]
    // Manga 7 belongs to source 11; another extension must not claim the same pasted link.
    [InlineData("99", "http://suwayomi.example:4568/manga/7", null)]
    public async Task ResolveSeriesIdFromUrl_only_claims_this_extensions_manga(string sourceId, string url, string? expected) =>
        Assert.Equal(expected, await ((ISource)Alpha(sourceId).Source).ResolveSeriesIdFromUrlAsync(new Uri(url)));

    [Fact]
    public async Task Provider_exposes_each_installed_english_extension_and_skips_the_rest()
    {
        var provider = new SuwayomiSourceProvider(new SuwayomiClient(new FakeSuwayomi()), NullLogger<SuwayomiSourceProvider>.Instance);

        await provider.RefreshAsync(CancellationToken.None);

        // Not the built-in local source, and not the Czech edition.
        Assert.Equal(["suwayomi-11", "suwayomi-22"], provider.Sources.Select(s => s.Name).Order());
        Assert.Equal(SourceRating.Adult, provider.Find("suwayomi-22")!.Rating);
        Assert.Equal("Alpha (EN) via Suwayomi", provider.Find("suwayomi-11")!.DisplayName);
    }

    [Fact]
    public async Task Provider_covers_the_languages_asked_for()
    {
        using var czech = new BaseUrlOverride(SuwayomiClient.LanguagesVariable, "cs");
        var provider = new SuwayomiSourceProvider(new SuwayomiClient(new FakeSuwayomi()), NullLogger<SuwayomiSourceProvider>.Instance);

        await provider.RefreshAsync(CancellationToken.None);

        Assert.Equal(["suwayomi-33"], provider.Sources.Select(s => s.Name));
    }

    [Fact]
    public async Task Provider_keeps_the_last_list_when_suwayomi_is_unreachable()
    {
        var factory = new FakeSuwayomi();
        var provider = new SuwayomiSourceProvider(new SuwayomiClient(factory), NullLogger<SuwayomiSourceProvider>.Instance);
        await provider.RefreshAsync(CancellationToken.None);

        factory.Down = true;
        await provider.RefreshAsync(CancellationToken.None);

        Assert.Equal(2, provider.Sources.Count);
    }

    [Fact]
    public void Provider_still_answers_for_a_stored_name_it_has_not_listed()
    {
        var provider = new SuwayomiSourceProvider(new SuwayomiClient(new FakeSuwayomi()), NullLogger<SuwayomiSourceProvider>.Instance);

        // A mapping made earlier must keep working while Suwayomi is down or not read yet.
        Assert.Equal("suwayomi-123", provider.Find("suwayomi-123")?.Name);
        // The id is a number nobody can read, so an unlisted source is never named by it.
        Assert.Equal("Suwayomi source", provider.Find("suwayomi-123")?.DisplayName);
        Assert.Equal("suwayomi--45", provider.Find("suwayomi--45")?.Name);
        Assert.Null(provider.Find("mangadex"));
        Assert.Null(provider.Find("suwayomi-abc"));
        Assert.Empty(provider.Sources);
    }

    [Fact]
    public async Task Provider_lists_nothing_without_a_configured_server()
    {
        using var unset = new BaseUrlOverride(SuwayomiClient.BaseUrlVariable, "");
        var factory = new FakeSuwayomi();
        var provider = new SuwayomiSourceProvider(new SuwayomiClient(factory), NullLogger<SuwayomiSourceProvider>.Instance);

        await provider.RefreshAsync(CancellationToken.None);

        Assert.Empty(provider.Sources);
        Assert.Empty(factory.Queries);
    }

    [Fact]
    public async Task Registry_serves_dynamic_sources_next_to_the_fixed_ones()
    {
        var provider = new SuwayomiSourceProvider(new SuwayomiClient(new FakeSuwayomi()), NullLogger<SuwayomiSourceProvider>.Instance);
        await provider.RefreshAsync(CancellationToken.None);

        var registry = new SourceRegistry([new Fixed("mangadex")], [provider]);

        Assert.Equal(["mangadex", "suwayomi-11", "suwayomi-22"], registry.All.Select(s => s.Name));
        Assert.Equal("suwayomi-22", registry.Find("suwayomi-22")?.Name);
        Assert.Equal("mangadex", registry.Find("MangaDex")?.Name);
        Assert.Null(registry.Find("nope"));
    }

    private sealed class Fixed(string name) : ISource
    {
        public string Name => name;
        public string DisplayName => name;
        public string BaseUrl => "https://fixed.test";
        public SourceCapabilities Capabilities => SourceCapabilities.None;
        public Task<IReadOnlyList<SourceSeriesResult>> SearchAsync(string title, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<SourceSeriesDetail> GetSeriesAsync(string sourceSeriesId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<SourceChapter>> ListChaptersAsync(string sourceSeriesId, string? languageFilter = null, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ChapterPages> GetPagesAsync(SourceChapter chapter, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
