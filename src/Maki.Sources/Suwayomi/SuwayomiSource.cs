using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using Maki.Core.Parsing;
using Maki.Core.Sources;

namespace Maki.Sources.Suwayomi;

/// <summary>
/// A middleman to every site Maki has no scraper for: a self-hosted Suwayomi server runs Mihon
/// extensions, and this source reads series, chapters and pages through its GraphQL API. A series
/// id is Suwayomi's own manga id (stable while its database is kept), a chapter id is its chapter
/// id. Search fans out over every installed extension, each capped and timed out on its own, so one
/// dead site cannot stall or fail the rest.
/// <para>
/// Off unless <c>MAKI_SOURCE_SUWAYOMI_BASEURL</c> is set: with no server to ask, search returns
/// nothing instead of failing every auto-match with a connection error.
/// </para>
/// <para>
/// Pages are fetched inside <see cref="GetPagesAsync"/> and handed over as bytes. Suwayomi lives on
/// the private network, which the downloader's address guard refuses to fetch from, and the bytes
/// are what its page endpoint produces after pulling the image from the real site anyway.
/// </para>
/// </summary>
public class SuwayomiSource(IHttpClientFactory httpClientFactory) : ISource
{
    public const string HttpClientName = "source-suwayomi";
    public const string BaseUrlVariable = "MAKI_SOURCE_SUWAYOMI_BASEURL";

    /// <summary>Hits kept per extension, so a catalogue-wide search stays a handful of candidates.</summary>
    private const int ResultsPerExtension = 5;

    private const int SearchConcurrency = 4;
    private static readonly TimeSpan ExtensionSearchTimeout = TimeSpan.FromSeconds(25);
    private const int PageConcurrency = 3;

    public string Name => "suwayomi";
    public string DisplayName => "Suwayomi";

    public string BaseUrl => Environment.GetEnvironmentVariable(BaseUrlVariable)?.TrimEnd('/') ?? "http://suwayomi:4567";

    private static bool Configured => !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(BaseUrlVariable));

    public SourceCapabilities Capabilities => SourceCapabilities.None;
    public SourceContent Content => SourceContent.Manga | SourceContent.Manhwa | SourceContent.Manhua | SourceContent.Webtoon;

    private HttpClient Client => httpClientFactory.CreateClient(HttpClientName);

    public string? ResolveSeriesIdFromUrl(Uri url)
    {
        var id = SourceUrl.PathTail(url, BaseUrl, "/manga/", firstSegmentOnly: true);
        return id is not null && int.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out _) ? id : null;
    }

    public async Task<IReadOnlyList<SourceSeriesResult>> SearchAsync(string title, CancellationToken ct = default)
    {
        if (!Configured || string.IsNullOrWhiteSpace(title))
        {
            return [];
        }

        var root = await PostAsync("{ sources { nodes { id name lang } } }", null, ct);
        var extensions = root.GetProperty("sources").GetProperty("nodes").EnumerateArray()
            .Select(n => (Id: n.GetProperty("id").GetString()!, Name: n.GetProperty("name").GetString() ?? string.Empty))
            .Where(s => s.Id != "0") // Suwayomi's built-in "Local source" reads its own folder, not a site
            .ToList();

        var results = new List<SourceSeriesResult>[extensions.Count];
        using var gate = new SemaphoreSlim(SearchConcurrency);
        await Task.WhenAll(extensions.Select(async (extension, index) =>
        {
            await gate.WaitAsync(ct);
            try
            {
                results[index] = await SearchExtensionAsync(extension.Id, title, ct);
            }
            finally
            {
                gate.Release();
            }
        }));

        return results.SelectMany(r => r).ToList();
    }

    private async Task<List<SourceSeriesResult>> SearchExtensionAsync(string sourceId, string title, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(ExtensionSearchTimeout);
        try
        {
            var data = await PostAsync(
                """
                mutation($source: LongString!, $query: String!) {
                  fetchSourceManga(input: { source: $source, type: SEARCH, query: $query, page: 1 }) {
                    mangas { id title description }
                  }
                }
                """,
                new { source = sourceId, query = title }, timeout.Token);

            var hits = new List<SourceSeriesResult>();
            foreach (var manga in data.GetProperty("fetchSourceManga").GetProperty("mangas").EnumerateArray().Take(ResultsPerExtension))
            {
                var id = manga.GetProperty("id").GetInt32().ToString(CultureInfo.InvariantCulture);
                hits.Add(new SourceSeriesResult(
                    id,
                    manga.GetProperty("title").GetString() ?? id,
                    $"{BaseUrl}/manga/{id}",
                    Description: Text(manga, "description")));
            }

            return hits;
        }
        catch (Exception ex) when (ex is HttpRequestException or TimeoutException or InvalidOperationException or JsonException
                                       || (ex is OperationCanceledException && !ct.IsCancellationRequested))
        {
            // One site being down (or an extension that cannot search) is the normal case for an
            // aggregator; it must not take the other extensions' hits down with it.
            return [];
        }
    }

    public async Task<SourceSeriesDetail> GetSeriesAsync(string sourceSeriesId, CancellationToken ct = default)
    {
        var data = await PostAsync(
            "query($id: Int!) { manga(id: $id) { id title description status thumbnailUrl } }",
            new { id = Id(sourceSeriesId) }, ct);
        var manga = data.GetProperty("manga");

        return new SourceSeriesDetail(
            sourceSeriesId,
            manga.GetProperty("title").GetString() ?? sourceSeriesId,
            $"{BaseUrl}/manga/{sourceSeriesId}",
            Description: Text(manga, "description"),
            Status: StatusName(Text(manga, "status")));
    }

    public async Task<IReadOnlyList<SourceChapter>> ListChaptersAsync(
        string sourceSeriesId, string? languageFilter = null, CancellationToken ct = default)
    {
        var id = Id(sourceSeriesId);
        var lang = await LanguageAsync(id, ct);

        // fetchChapters asks the site again, which is what a sync wants: the cached list would hide
        // every chapter published since the series was first opened.
        var data = await PostAsync(
            """
            mutation($id: Int!) {
              fetchChapters(input: { mangaId: $id }) {
                chapters { id name chapterNumber uploadDate scanlator url }
              }
            }
            """,
            new { id }, ct);

        var chapters = new List<SourceChapter>();
        foreach (var row in data.GetProperty("fetchChapters").GetProperty("chapters").EnumerateArray())
        {
            var chapterId = row.GetProperty("id").GetInt32().ToString(CultureInfo.InvariantCulture);
            var name = Text(row, "name");
            var number = ChapterNumber(row, name);
            chapters.Add(new SourceChapter(
                Name,
                sourceSeriesId,
                chapterId,
                number?.ToString(CultureInfo.InvariantCulture),
                number,
                Volume: null,
                name,
                lang,
                ReleaseDate(row),
                $"{BaseUrl}/manga/{sourceSeriesId}/chapter/{chapterId}",
                Text(row, "scanlator")));
        }

        return SourceChapterList.Normalize(chapters);
    }

    public async Task<ChapterPages> GetPagesAsync(SourceChapter chapter, CancellationToken ct = default)
    {
        var data = await PostAsync(
            "mutation($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages } }",
            new { id = Id(chapter.SourceChapterId) }, ct);

        var paths = data.GetProperty("fetchChapterPages").GetProperty("pages").EnumerateArray()
            .Select(p => p.GetString()!)
            .ToList();
        if (paths.Count == 0)
        {
            throw new ChapterLockedException($"Suwayomi returned no pages for chapter {chapter.SourceChapterId}");
        }

        var bytes = new byte[paths.Count][];
        using var gate = new SemaphoreSlim(PageConcurrency);
        await Task.WhenAll(paths.Select(async (path, index) =>
        {
            await gate.WaitAsync(ct);
            try
            {
                bytes[index] = await Client.GetByteArrayAsync(path.TrimStart('/'), ct);
            }
            finally
            {
                gate.Release();
            }
        }));

        return new ChapterPages(paths.Select((path, index) => new PageRequest($"{BaseUrl}{path}", Data: bytes[index])).ToList());
    }

    private async Task<string> LanguageAsync(int mangaId, CancellationToken ct)
    {
        var data = await PostAsync("query($id: Int!) { manga(id: $id) { source { lang } } }", new { id = mangaId }, ct);
        var lang = data.GetProperty("manga").GetProperty("source").ValueKind == JsonValueKind.Object
            ? Text(data.GetProperty("manga").GetProperty("source"), "lang")
            : null;

        // "all"/"multi" extensions cover many languages and do not say which one a chapter is in.
        return string.IsNullOrWhiteSpace(lang) || lang is "all" or "multi" or "other" ? SourceLanguages.Default : lang.ToLowerInvariant();
    }

    /// <summary>Suwayomi stores -1 for a chapter whose number the extension could not read, so fall back to the name.</summary>
    private static decimal? ChapterNumber(JsonElement row, string? name)
    {
        if (row.TryGetProperty("chapterNumber", out var el) && el.ValueKind == JsonValueKind.Number &&
            el.GetDouble() >= 0)
        {
            return Math.Round((decimal)el.GetDouble(), 3);
        }

        return ChapterNumberParser.Parse(name).Number;
    }

    private static DateTime? ReleaseDate(JsonElement row)
    {
        // A LongString: milliseconds since the epoch, as text. Zero means the site never said.
        var raw = Text(row, "uploadDate");
        return long.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var ms) && ms > 0
            ? DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime
            : null;
    }

    private static string? StatusName(string? status) => status switch
    {
        "ONGOING" => "Ongoing",
        "COMPLETED" or "PUBLISHING_FINISHED" => "Completed",
        "ON_HIATUS" => "Hiatus",
        "CANCELLED" => "Cancelled",
        _ => null
    };

    private static string? Text(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int Id(string id) =>
        int.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : throw new ArgumentException($"'{id}' is not a Suwayomi id", nameof(id));

    /// <returns>The <c>data</c> object, after treating any GraphQL <c>errors</c> as a failure.</returns>
    private async Task<JsonElement> PostAsync(string query, object? variables, CancellationToken ct)
    {
        using var response = await Client.PostAsJsonAsync("api/graphql", new { query, variables }, ct);
        response.EnsureSuccessStatusCode();
        var root = (await response.Content.ReadFromJsonAsync<JsonElement>(ct));

        if (root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0)
        {
            var message = errors[0].TryGetProperty("message", out var m) ? m.GetString() : "unknown error";
            throw new InvalidOperationException($"Suwayomi: {message?.Split('\n')[0]}");
        }

        return root.GetProperty("data");
    }
}
