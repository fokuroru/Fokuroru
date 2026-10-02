using System.Net.Http.Json;
using System.Text.Json;
using Maki.Api.Configuration;

namespace Maki.Api.Services;

/// <summary>
/// A wide banner picture for a series, from AniList when it has one and from Kitsu otherwise. The image is
/// fetched once and kept in the series' cover folder, and a miss is remembered too so a series with no
/// banner is not asked about again for a month. Nothing here is required for anything else to work.
/// </summary>
public sealed class SeriesBannerService(IHttpClientFactory http, AppPaths paths, ILogger<SeriesBannerService> logger)
{
    public const string HttpClientName = "banners";

    private static readonly TimeSpan MissFor = TimeSpan.FromDays(30);
    private static readonly SemaphoreSlim Gate = new(2, 2);

    // One argument at a time: AniList answers "Not Found" when the other is present as an explicit null.
    private const string ById = "query($id:Int){Media(id:$id,type:MANGA){bannerImage}}";
    private const string ByMalId = "query($id:Int){Media(idMal:$id,type:MANGA){bannerImage}}";

    private string Dir(int seriesId) => Path.Combine(paths.MediaCoverDir, seriesId.ToString());
    private string BannerFile(int seriesId) => Path.Combine(Dir(seriesId), "banner.img");
    private string MissFile(int seriesId) => Path.Combine(Dir(seriesId), "banner.none");

    /// <summary>The cached banner for a series, fetching it if this is the first ask. Null when it has none.</summary>
    public async Task<string?> GetAsync(int seriesId, int? aniListId, int? malId, int? kitsuId, CancellationToken ct)
    {
        var file = BannerFile(seriesId);
        if (File.Exists(file))
        {
            return file;
        }

        var miss = MissFile(seriesId);
        if (File.Exists(miss) && DateTime.UtcNow - File.GetLastWriteTimeUtc(miss) < MissFor)
        {
            return null;
        }

        await Gate.WaitAsync(ct);
        try
        {
            if (File.Exists(file))
            {
                return file;
            }

            var url = await FindUrlAsync(aniListId, malId, kitsuId, ct);
            if (url is not null && await DownloadAsync(url, file, ct))
            {
                File.Delete(miss);
                return file;
            }

            Directory.CreateDirectory(Dir(seriesId));
            await File.WriteAllTextAsync(miss, string.Empty, ct);
            return null;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException or JsonException)
        {
            // A network failure says nothing about the series, so it is not remembered as a miss.
            logger.LogDebug(ex, "Could not fetch a banner for series {SeriesId}", seriesId);
            return null;
        }
        finally
        {
            Gate.Release();
        }
    }

    private async Task<string?> FindUrlAsync(int? aniListId, int? malId, int? kitsuId, CancellationToken ct)
    {
        var client = http.CreateClient(HttpClientName);
        if (aniListId is not null || malId is not null)
        {
            using var response = await client.PostAsJsonAsync("https://graphql.anilist.co",
                new { query = aniListId is not null ? ById : ByMalId, variables = new { id = aniListId ?? malId } }, ct);
            if (response.IsSuccessStatusCode &&
                ParseAniList(await response.Content.ReadAsStringAsync(ct)) is { } banner)
            {
                return banner;
            }
        }

        if (kitsuId is not null)
        {
            using var response = await client.GetAsync($"https://kitsu.io/api/edge/manga/{kitsuId}", ct);
            if (response.IsSuccessStatusCode)
            {
                return ParseKitsu(await response.Content.ReadAsStringAsync(ct));
            }
        }

        return null;
    }

    internal static string? ParseAniList(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("data", out var data) && data.TryGetProperty("Media", out var media) &&
                   media.ValueKind == JsonValueKind.Object && media.TryGetProperty("bannerImage", out var banner) &&
                   banner.ValueKind == JsonValueKind.String ? AllowedUrl(banner.GetString()) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    internal static string? ParseKitsu(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("data", out var data) || !data.TryGetProperty("attributes", out var attributes) ||
                !attributes.TryGetProperty("coverImage", out var cover) || cover.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            foreach (var size in new[] { "large", "original" })
            {
                if (cover.TryGetProperty(size, out var url) && url.ValueKind == JsonValueKind.String && AllowedUrl(url.GetString()) is { } ok)
                {
                    return ok;
                }
            }

            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Only https pictures are fetched, so an answer cannot point the server at an address of its own choosing over plain http.</summary>
    internal static string? AllowedUrl(string? url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps ? uri.ToString() : null;

    private async Task<bool> DownloadAsync(string url, string file, CancellationToken ct)
    {
        var client = http.CreateClient(HttpClientName);
        using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode || response.Content.Headers.ContentType?.MediaType?.StartsWith("image/") != true)
        {
            return false;
        }

        // A banner is a few hundred kilobytes; anything much larger is not what was asked for.
        if (response.Content.Headers.ContentLength is > 8 * 1024 * 1024)
        {
            return false;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var temp = file + ".tmp";
        await using (var stream = File.Create(temp))
        {
            await response.Content.CopyToAsync(stream, ct);
        }

        File.Move(temp, file, overwrite: true);
        return true;
    }

    /// <summary>The image type from its first bytes: the file is stored without an extension.</summary>
    public static string ContentTypeOf(string file)
    {
        var head = new byte[12];
        using var stream = File.OpenRead(file);
        var n = stream.Read(head, 0, head.Length);
        bool Starts(params byte[] b) => n >= b.Length && b.Select((x, i) => head[i] == x).All(ok => ok);
        return Starts(0x89, 0x50, 0x4E, 0x47) ? "image/png"
            : Starts(0x47, 0x49, 0x46) ? "image/gif"
            : n >= 12 && Starts(0x52, 0x49, 0x46, 0x46) && head[8] == (byte)'W' ? "image/webp"
            : "image/jpeg";
    }
}
