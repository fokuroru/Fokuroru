using System.Globalization;
using System.Text.Json;
using Maki.Core.Parsing;
using Maki.Core.Sources;

namespace Maki.Sources.Suwayomi;

/// <summary>
/// One Suwayomi source (one installed extension, in one language) as a Maki source. Suwayomi runs
/// Mihon extensions, and this reads series, chapters and pages through its GraphQL API, so sites
/// Maki has no scraper for can supply series. A series id is Suwayomi's own manga id (stable while
/// its database is kept), a chapter id its chapter id.
/// <para>
/// Pages are fetched inside <see cref="GetPagesAsync"/> and handed over as bytes. Suwayomi lives on
/// the private network, which the downloader's address guard refuses to fetch from, and the bytes
/// are what its page endpoint produces after pulling the image from the real site anyway.
/// </para>
/// </summary>
public class SuwayomiExtensionSource(
    SuwayomiClient client, string sourceId, string displayName, string language, bool nsfw) : ISource
{
    /// <summary>Persisted in <c>SourceMapping.SourceName</c> ahead of Suwayomi's own source id.</summary>
    public const string NamePrefix = "suwayomi-";

    /// <summary>Hits kept per search, so a catalogue-wide search stays a handful of candidates.</summary>
    private const int ResultsPerSearch = 5;

    /// <summary>Hits checked for chapters before they are offered, nearest first.</summary>
    private const int ProbedHits = 3;

    private const int PageConcurrency = 3;
    private static readonly TimeSpan SearchTimeout = TimeSpan.FromSeconds(25);

    public string Name => NamePrefix + sourceId;
    public string DisplayName => displayName.Length == 0 ? "Suwayomi source" : $"{displayName} via Suwayomi";
    public string BaseUrl => SuwayomiClient.PublicUrl;
    public SourceCapabilities Capabilities => SourceCapabilities.None;
    public SourceContent Content => SourceContent.Manga | SourceContent.Manhwa | SourceContent.Manhua | SourceContent.Webtoon;
    public SourceRating Rating => nsfw ? SourceRating.Adult : SourceRating.General;
    public IReadOnlyList<string> SupportedLanguages => [language];

    /// <summary>
    /// A pasted Suwayomi manga link, when the manga is this source's. Several Suwayomi sources share
    /// one web UI, so the id alone does not say whose it is.
    /// </summary>
    public async ValueTask<string?> ResolveSeriesIdFromUrlAsync(Uri url, CancellationToken ct = default)
    {
        var id = SourceUrl.PathTail(url, BaseUrl, "/manga/", firstSegmentOnly: true);
        if (id is null || !int.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out var mangaId))
        {
            return null;
        }

        var data = await client.PostAsync("query($id: Int!) { manga(id: $id) { sourceId } }", new { id = mangaId }, ct);
        return data.GetProperty("manga").TryGetProperty("sourceId", out var owner) && owner.GetString() == sourceId ? id : null;
    }

    public async Task<IReadOnlyList<SourceSeriesResult>> SearchAsync(string title, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            return [];
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(SearchTimeout);
        try
        {
            var data = await client.PostAsync(
                """
                mutation($source: LongString!, $query: String!) {
                  fetchSourceManga(input: { source: $source, type: SEARCH, query: $query, page: 1 }) {
                    mangas { id title description realUrl }
                  }
                }
                """,
                new { source = sourceId, query = title }, timeout.Token);

            var hits = new List<SourceSeriesResult>();
            foreach (var manga in data.GetProperty("fetchSourceManga").GetProperty("mangas").EnumerateArray().Take(ResultsPerSearch))
            {
                var id = manga.GetProperty("id").GetInt32().ToString(CultureInfo.InvariantCulture);
                hits.Add(new SourceSeriesResult(
                    id,
                    manga.GetProperty("title").GetString() ?? id,
                    Text(manga, "realUrl") ?? $"{BaseUrl}/manga/{id}",
                    Description: Text(manga, "description")));
            }

            // A site can list a title it has no chapters for (a stub, a taken-down series), and the
            // auto-match would link it on title alone. Asking for the chapters of the nearest few
            // drops those, and leaves Suwayomi holding the list the sync is about to ask for.
            var probed = await Task.WhenAll(hits.Take(ProbedHits).Select(hit => HasChaptersAsync(hit, timeout.Token)));
            return hits.Take(ProbedHits).Zip(probed).Where(p => p.Second).Select(p => p.First)
                .Concat(hits.Skip(ProbedHits)).ToList();
        }
        catch (Exception ex) when (ex is HttpRequestException or TimeoutException or InvalidOperationException or JsonException
                                       || (ex is OperationCanceledException && !ct.IsCancellationRequested))
        {
            // One site being down is the normal case for an aggregator; the match service treats an
            // empty result as "nothing here" and moves on to the next source.
            return [];
        }
    }

    /// <summary>False only when Suwayomi says the site has no chapters; any other failure keeps the hit.</summary>
    private async Task<bool> HasChaptersAsync(SourceSeriesResult hit, CancellationToken ct)
    {
        try
        {
            await client.PostAsync(
                "mutation($id: Int!) { fetchChapters(input: { mangaId: $id }) { chapters { id } } }",
                new { id = Id(hit.SourceSeriesId) }, ct);
            return true;
        }
        catch (InvalidOperationException ex) when (IsNoChapters(ex))
        {
            return false;
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or JsonException or OperationCanceledException)
        {
            return true;
        }
    }

    private static bool IsNoChapters(InvalidOperationException ex) =>
        ex.Message.Contains("No chapters found", StringComparison.OrdinalIgnoreCase);

    public async Task<SourceSeriesDetail> GetSeriesAsync(string sourceSeriesId, CancellationToken ct = default)
    {
        var data = await client.PostAsync(
            "query($id: Int!) { manga(id: $id) { id title description status realUrl } }",
            new { id = Id(sourceSeriesId) }, ct);
        var manga = data.GetProperty("manga");

        return new SourceSeriesDetail(
            sourceSeriesId,
            manga.GetProperty("title").GetString() ?? sourceSeriesId,
            Text(manga, "realUrl") ?? $"{BaseUrl}/manga/{sourceSeriesId}",
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
        JsonElement data;
        try
        {
            data = await client.PostAsync(
                """
                mutation($id: Int!) {
                  fetchChapters(input: { mangaId: $id }) {
                    chapters { id name chapterNumber uploadDate scanlator realUrl }
                  }
                }
                """,
                new { id }, ct);
        }
        catch (InvalidOperationException ex) when (IsNoChapters(ex))
        {
            // Suwayomi reports an empty list as an error; for a series that just has none yet, an
            // empty list is the honest answer, not a failed sync.
            return [];
        }

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
                Text(row, "realUrl") ?? $"{BaseUrl}/manga/{sourceSeriesId}/chapter/{chapterId}",
                Text(row, "scanlator")));
        }

        return SourceChapterList.Normalize(chapters);
    }

    public async Task<ChapterPages> GetPagesAsync(SourceChapter chapter, CancellationToken ct = default)
    {
        var data = await client.PostAsync(
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
                bytes[index] = await client.GetPageAsync(path, ct);
            }
            finally
            {
                gate.Release();
            }
        }));

        return new ChapterPages(paths.Select((path, index) => new PageRequest($"{BaseUrl}{path}", Data: bytes[index])).ToList());
    }

    /// <summary>
    /// The language the series' own Suwayomi source publishes in, asked per series rather than taken
    /// from this instance: a source rebuilt from a stored name alone does not know it.
    /// </summary>
    private async Task<string> LanguageAsync(int mangaId, CancellationToken ct)
    {
        var data = await client.PostAsync("query($id: Int!) { manga(id: $id) { source { lang } } }", new { id = mangaId }, ct);
        var source = data.GetProperty("manga").GetProperty("source");
        var lang = source.ValueKind == JsonValueKind.Object ? Text(source, "lang") : null;

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
}
