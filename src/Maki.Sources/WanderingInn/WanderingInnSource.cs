using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using AngleSharp.Html.Parser;
using Maki.Core.Sources;

namespace Maki.Sources.WanderingInn;

/// <summary>
/// The Wandering Inn webcomic (webcomic.wanderinginn.com). A single WordPress site where every comic
/// page is one post ("Chapter 1: Page 1", slug chapter-1-page-1) holding one image, so we read the
/// REST API instead of scraping HTML. The site is one series; a Maki chapter is a numbered comic
/// chapter, and its id is the chapter number. Side comics (Rough Landing, BOC x TWI) are skipped.
/// </summary>
public partial class WanderingInnSource(IHttpClientFactory httpClientFactory) : ISource
{
    public const string HttpClientName = "source-wanderinginn";
    public const string SeriesId = "twi";

    private const string SeriesTitle = "The Wandering Inn";

    private static readonly HtmlParser Parser = new();
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);

    [GeneratedRegex(@"^chapter-(\d+)-page-(\d+)")]
    private static partial Regex PageSlug();

    private readonly SemaphoreSlim _gate = new(1, 1);
    private (DateTime FetchedAt, List<ComicPage> Pages)? _cache;

    public string Name => "wanderinginn";
    public string DisplayName => "The Wandering Inn Webcomic";
    public string BaseUrl => "https://webcomic.wanderinginn.com";
    public SourceCapabilities Capabilities => SourceCapabilities.None;
    public SourceKind Kind => SourceKind.Official;

    private HttpClient Client => httpClientFactory.CreateClient(HttpClientName);

    public string? ResolveSeriesIdFromUrl(Uri url) =>
        url.Host.Equals(new Uri(BaseUrl).Host, StringComparison.OrdinalIgnoreCase) ? SeriesId : null;

    public async Task<IReadOnlyList<SourceSeriesResult>> SearchAsync(string title, CancellationToken ct = default)
    {
        if (!title.Contains("wandering inn", StringComparison.OrdinalIgnoreCase))
        {
            return [];
        }

        var pages = await GetPagesCachedAsync(ct);
        return [new SourceSeriesResult(SeriesId, SeriesTitle, BaseUrl, pages.FirstOrDefault()?.ImageUrls.FirstOrDefault())];
    }

    public async Task<SourceSeriesDetail> GetSeriesAsync(string sourceSeriesId, CancellationToken ct = default)
    {
        var pages = await GetPagesCachedAsync(ct);
        return new SourceSeriesDetail(
            SeriesId,
            SeriesTitle,
            BaseUrl,
            pages.FirstOrDefault()?.ImageUrls.FirstOrDefault(),
            "The official webcomic adaptation of Pirateaba's web serial.");
    }

    public async Task<IReadOnlyList<SourceChapter>> ListChaptersAsync(
        string sourceSeriesId, string? languageFilter = null, CancellationToken ct = default)
    {
        var pages = await GetPagesCachedAsync(ct);
        var chapters = pages
            .GroupBy(p => p.Chapter)
            .Select(g => new SourceChapter(
                Name,
                SeriesId,
                g.Key.ToString(CultureInfo.InvariantCulture),
                $"Chapter {g.Key}",
                g.Key,
                null,
                null,
                Language: "en",
                ReleaseDate: g.Max(p => p.Date),
                Url: $"{BaseUrl}/chapter/chapter-{g.Key}/"))
            .ToList();

        return SourceChapterList.Normalize(chapters);
    }

    public async Task<ChapterPages> GetPagesAsync(SourceChapter chapter, CancellationToken ct = default)
    {
        var number = int.Parse(chapter.SourceChapterId, CultureInfo.InvariantCulture);
        var headers = new Dictionary<string, string> { ["Referer"] = $"{BaseUrl}/" };

        var requests = (await GetPagesCachedAsync(ct))
            .Where(p => p.Chapter == number)
            .SelectMany(p => p.ImageUrls)
            .Select(url => new PageRequest(url, headers))
            .ToList();

        return new ChapterPages(requests);
    }

    private async Task<List<ComicPage>> GetPagesCachedAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_cache is { } hit && DateTime.UtcNow - hit.FetchedAt < CacheTtl)
            {
                return hit.Pages;
            }

            var pages = await FetchAllPagesAsync(ct);
            _cache = (DateTime.UtcNow, pages);
            return pages;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<List<ComicPage>> FetchAllPagesAsync(CancellationToken ct)
    {
        var pages = new List<ComicPage>();
        var totalPages = 1;

        for (var page = 1; page <= totalPages; page++)
        {
            using var response = await Client.GetAsync(
                $"wp-json/wp/v2/posts?per_page=100&page={page}&_fields=slug,date,content", ct);
            response.EnsureSuccessStatusCode();

            if (response.Headers.TryGetValues("X-WP-TotalPages", out var values) &&
                int.TryParse(values.FirstOrDefault(), out var total))
            {
                totalPages = total;
            }

            var posts = await response.Content.ReadFromJsonAsync<List<Post>>(ct) ?? [];
            foreach (var post in posts)
            {
                var match = PageSlug().Match(post.Slug);
                if (!match.Success)
                {
                    continue;
                }

                var doc = Parser.ParseDocument(post.Content.Html);
                var images = doc.QuerySelectorAll("img")
                    .Select(img => img.GetAttribute("src"))
                    .Where(src => !string.IsNullOrEmpty(src))
                    .Select(src => src!)
                    .ToList();

                if (images.Count == 0)
                {
                    continue;
                }

                pages.Add(new ComicPage(
                    int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture),
                    int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture),
                    post.Date,
                    images));
            }
        }

        return pages.OrderBy(p => p.Chapter).ThenBy(p => p.Page).ToList();
    }

    private sealed record ComicPage(int Chapter, int Page, DateTime Date, List<string> ImageUrls);

    private sealed record Post(
        [property: JsonPropertyName("slug")] string Slug,
        [property: JsonPropertyName("date")] DateTime Date,
        [property: JsonPropertyName("content")] Rendered Content);

    private sealed record Rendered([property: JsonPropertyName("rendered")] string Html);
}
