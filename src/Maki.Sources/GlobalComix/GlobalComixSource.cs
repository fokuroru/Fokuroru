using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Maki.Core.Parsing;
using Maki.Core.Sources;

namespace Maki.Sources.GlobalComix;

/// <summary>
/// GlobalComix, through the JSON API its web reader uses (api.globalcomix.com). Every call needs the
/// <c>X-Gc-Client</c> header carrying the public key the site prints into each page, read from the home
/// page once and kept. Series id is the comic slug. Pages live on reader-cdn, which answers 401 without the
/// <c>gc_reader_auth</c> cookie that reading the release hands out; it is a guest token scoped to that one
/// release, so each chapter's page requests carry their own. Anonymous search leaves out adult titles,
/// so those are linked by URL.
/// </summary>
public partial class GlobalComixSource(IHttpClientFactory httpClientFactory) : ISource
{
    public const string HttpClientName = "source-globalcomix";
    public const string ApiUrl = "https://api.globalcomix.com";

    private const string ReaderCdn = "https://reader-cdn.globalcomix.com";

    private string? clientKey;

    public string Name => "globalcomix";
    public string DisplayName => "GlobalComix";
    public string BaseUrl => "https://globalcomix.com";
    public SourceCapabilities Capabilities => SourceCapabilities.None;
    public SourceKind Kind => SourceKind.Official;
    public SourceContent Content => SourceContent.Manga | SourceContent.Webtoon;
    public SourceRating Rating => SourceRating.Mature;
    public IReadOnlyList<string> CoverHosts => ["globalcomix.com"];

    private HttpClient Client => httpClientFactory.CreateClient(HttpClientName);

    public string? ResolveSeriesIdFromUrl(Uri url) =>
        // https://globalcomix.com/c/{slug} and the release pages under it (/c/{slug}/r/{key})
        SourceUrl.PathTail(url, BaseUrl, "/c/", firstSegmentOnly: true);

    public async Task<IReadOnlyList<SourceSeriesResult>> SearchAsync(string title, CancellationToken ct = default)
    {
        using var doc = await GetJsonAsync($"v1/search/query?q={Uri.EscapeDataString(title)}", ct);
        var results = new List<SourceSeriesResult>();
        if (!Results(doc).TryGetProperty("series", out var series) ||
            !series.TryGetProperty("items", out var items))
        {
            return results;
        }

        foreach (var item in items.EnumerateArray())
        {
            var slug = Text(item, "slug");
            var name = Text(item, "name")?.Trim();
            if (string.IsNullOrEmpty(slug) || string.IsNullOrEmpty(name))
            {
                continue;
            }

            // Anyone can publish here, so a title alone is not enough to auto-map (see series-matching rules).
            results.Add(new SourceSeriesResult(slug, name, $"{BaseUrl}/c/{slug}", Text(item, "cover_image_url"),
                UserGenerated: true, Author: Text(item, "artist_name")?.Trim()));
        }

        return results;
    }

    public async Task<SourceSeriesDetail> GetSeriesAsync(string sourceSeriesId, CancellationToken ct = default)
    {
        using var doc = await GetJsonAsync($"v1/read/{Uri.EscapeDataString(sourceSeriesId)}", ct);
        var comic = Results(doc);
        return new SourceSeriesDetail(sourceSeriesId, Text(comic, "name") ?? sourceSeriesId, $"{BaseUrl}/c/{sourceSeriesId}",
            Text(comic, "image_url"), Text(comic, "description"), Text(comic, "status_name"));
    }

    public async Task<IReadOnlyList<SourceChapter>> ListChaptersAsync(
        string sourceSeriesId, string? languageFilter = null, CancellationToken ct = default)
    {
        int comicId;
        using (var comic = await GetJsonAsync($"v1/read/{Uri.EscapeDataString(sourceSeriesId)}", ct))
        {
            comicId = Results(comic).GetProperty("id").GetInt32();
        }

        using var doc = await GetJsonAsync($"v1/comics/{comicId}/releases?lang_id=en&all=true", ct);
        return SourceChapterList.Normalize(ParseReleases(Results(doc), Name, sourceSeriesId, BaseUrl));
    }

    internal static List<SourceChapter> ParseReleases(JsonElement releases, string sourceName, string seriesId, string baseUrl)
    {
        var chapters = new List<SourceChapter>();
        foreach (var release in releases.EnumerateArray())
        {
            var key = Text(release, "key");
            if (string.IsNullOrEmpty(key) || Int(release, "is_published") == 0 || Int(release, "is_deleted") == 1)
            {
                continue;
            }

            var raw = Text(release, "chapter");
            var title = Text(release, "title")?.Trim();
            var number = decimal.TryParse(raw, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var n)
                ? n
                : ChapterNumberParser.Parse(title).Number;
            var published = Text(release, "published_time");
            chapters.Add(new SourceChapter(
                sourceName,
                seriesId,
                key,
                raw,
                number,
                Volume: null,
                Title: string.IsNullOrEmpty(title) ? null : title,
                // The API's lang_id is a plain ISO code ("en"), the same form Maki stores.
                Language: Text(release, "lang_id") ?? "en",
                DateTime.TryParse(published, CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var date) ? date : null,
                Url: $"{baseUrl}/c/{seriesId}/r/{key}"));
        }

        return chapters;
    }

    public async Task<ChapterPages> GetPagesAsync(SourceChapter chapter, CancellationToken ct = default)
    {
        var key = chapter.SourceChapterId;
        using var response = await SendAsync($"v1/readV3/{Uri.EscapeDataString(key)}?readerV=2", ct);
        response.EnsureSuccessStatusCode();
        var token = ReaderToken(response);
        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var pages = Results(doc).TryGetProperty("page_objects", out var objects)
            ? objects.EnumerateArray().ToList()
            : [];

        if (pages.Count == 0 || token is null ||
            pages.Any(p => Bool(p, "is_page_paid") || Bool(p, "display_paid_access_block")))
        {
            throw new ChapterLockedException($"GlobalComix release {key} is not free to read");
        }

        var headers = new Dictionary<string, string>
        {
            ["Cookie"] = $"gc_reader_auth={token}",
            ["Referer"] = $"{BaseUrl}/"
        };
        return new ChapterPages(pages
            .OrderBy(p => Int(p, "order"))
            .Select(p => new PageRequest($"{ReaderCdn}/r/{key}/p/{Int(p, "order")}/desktop.webp", headers))
            .ToList());
    }

    internal static string? ReaderToken(HttpResponseMessage response) =>
        response.Headers.TryGetValues("Set-Cookie", out var cookies)
            ? cookies.Select(c => ReaderAuthCookie().Match(c)).LastOrDefault(m => m.Success)?.Groups[1].Value
            : null;

    private async Task<JsonDocument> GetJsonAsync(string path, CancellationToken ct)
    {
        using var response = await SendAsync(path, ct);
        response.EnsureSuccessStatusCode();
        return await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
    }

    private async Task<HttpResponseMessage> SendAsync(string path, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            var key = clientKey ??= await ReadClientKeyAsync(ct);
            using var request = new HttpRequestMessage(HttpMethod.Get, path);
            request.Headers.Add("X-Gc-Client", key);
            var response = await Client.SendAsync(request, ct);
            // A rotated key answers 400 CLIENT_HEADER_MISSING or 401; read the page's current one once.
            if (attempt > 0 || response.StatusCode is not (HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized))
            {
                return response;
            }

            response.Dispose();
            clientKey = null;
        }
    }

    private async Task<string> ReadClientKeyAsync(CancellationToken ct)
    {
        var html = await Client.GetStringAsync($"{BaseUrl}/", ct);
        return ClientKeyOf(html) ?? throw new InvalidOperationException("GlobalComix page carries no API client key");
    }

    internal static string? ClientKeyOf(string html) => ClientKey().Match(html) is { Success: true } m ? m.Groups[1].Value : null;

    private static JsonElement Results(JsonDocument doc) => doc.RootElement.GetProperty("payload").GetProperty("results");

    private static string? Text(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int Int(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : 0;

    private static bool Bool(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    [GeneratedRegex(@"""api_key""\s*:\s*""(gck_[A-Za-z0-9]+)""")]
    private static partial Regex ClientKey();

    [GeneratedRegex(@"gc_reader_auth=([^;]+)")]
    private static partial Regex ReaderAuthCookie();
}
