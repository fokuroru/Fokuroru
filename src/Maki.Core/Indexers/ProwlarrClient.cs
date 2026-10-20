using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Serialization;

namespace Maki.Core.Indexers;

/// <summary>
/// Client for Prowlarr's aggregated search API. Maki queries Prowlarr the same
/// way its UI does (GET /api/v1/search), so no Prowlarr-side app sync is needed.
/// </summary>
public class ProwlarrClient(IHttpClientFactory httpClientFactory)
{
    public const string HttpClientName = "prowlarr";

    public record ProwlarrRelease(
        [property: JsonPropertyName("guid")] string Guid,
        [property: JsonPropertyName("title")] string Title,
        [property: JsonPropertyName("size")] long Size,
        [property: JsonPropertyName("indexerId")] int IndexerId,
        [property: JsonPropertyName("indexer")] string Indexer,
        [property: JsonPropertyName("seeders")] int? Seeders,
        [property: JsonPropertyName("leechers")] int? Leechers,
        [property: JsonPropertyName("downloadUrl")] string? DownloadUrl,
        [property: JsonPropertyName("magnetUrl")] string? MagnetUrl,
        [property: JsonPropertyName("protocol")] string Protocol,
        [property: JsonPropertyName("infoUrl")] string? InfoUrl,
        [property: JsonPropertyName("ageMinutes")] double? AgeMinutes);

    public record ProwlarrCategory(
        [property: JsonPropertyName("id")] int Id,
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("subCategories")] List<ProwlarrCategory>? SubCategories);

    public record ProwlarrCapabilities(
        [property: JsonPropertyName("categories")] List<ProwlarrCategory>? Categories);

    public record ProwlarrIndexer(
        [property: JsonPropertyName("id")] int Id,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("enable")] bool Enable,
        [property: JsonPropertyName("protocol")] string? Protocol,
        [property: JsonPropertyName("capabilities")] ProwlarrCapabilities? Capabilities);

    /// <param name="indexerIds">Limit the search to these Prowlarr indexer ids; null/empty = all indexers.</param>
    /// <param name="categories">Limit to these Torznab/Newznab category ids; null/empty = all categories.</param>
    public async Task<IReadOnlyList<ProwlarrRelease>> SearchAsync(
        string baseUrl, string apiKey, string query,
        IReadOnlyCollection<int>? indexerIds = null,
        IReadOnlyCollection<int>? categories = null,
        CancellationToken ct = default)
    {
        var url = new StringBuilder($"api/v1/search?query={Uri.EscapeDataString(query)}&type=search&limit=100");
        foreach (var id in indexerIds ?? [])
        {
            url.Append("&indexerIds=").Append(id);
        }

        foreach (var category in categories ?? [])
        {
            url.Append("&categories=").Append(category);
        }

        var client = CreateClient(baseUrl, apiKey);
        var releases = await client.GetFromJsonAsync<List<ProwlarrRelease>>(url.ToString(), ct);
        return releases ?? [];
    }

    /// <summary>What a Prowlarr download link turned out to be: a magnet it redirected to, or the .torrent itself.</summary>
    public record TorrentSource(string? Magnet, byte[]? File, string FileName);

    /// <summary>
    /// Fetches a release's download link from here, where Prowlarr is reachable, rather than leaving it to qBittorrent.
    /// A link that redirects to a magnet is returned as that magnet. Anything that is not a torrent file throws, with the
    /// status, so the failure shows up on the grab instead of as a torrent that never appears.
    /// </summary>
    public async Task<TorrentSource> FetchTorrentAsync(string downloadUrl, CancellationToken ct = default)
    {
        var client = httpClientFactory.CreateClient(HttpClientName);
        var url = new Uri(downloadUrl);
        for (var hops = 0; hops < 5; hops++)
        {
            using var response = await client.GetAsync(url, ct);
            var location = response.Headers.Location;
            if ((int)response.StatusCode is >= 300 and < 400 && location is not null)
            {
                if (location.OriginalString.StartsWith("magnet:", StringComparison.OrdinalIgnoreCase))
                {
                    return new TorrentSource(location.OriginalString, null, string.Empty);
                }

                if (!Uri.TryCreate(url, location, out var next) || !next.IsAbsoluteUri || next.Scheme is not ("http" or "https"))
                {
                    throw new InvalidOperationException($"Prowlarr's download link redirected to an address that cannot be fetched ({location.OriginalString})");
                }

                url = next;
                continue;
            }

            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"Prowlarr could not provide the torrent (HTTP {(int)response.StatusCode})");
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(ct);
            if (!Download.TorrentFile.TryInfoHash(bytes, out _))
            {
                throw new InvalidOperationException("Prowlarr's download link did not return a torrent file");
            }

            var name = response.Content.Headers.ContentDisposition?.FileNameStar
                       ?? response.Content.Headers.ContentDisposition?.FileName?.Trim('"')
                       ?? Path.GetFileName(url.AbsolutePath);
            return new TorrentSource(null, bytes, string.IsNullOrWhiteSpace(name) ? "release.torrent" : name);
        }

        throw new InvalidOperationException("Prowlarr's download link redirected too many times");
    }

    /// <summary>All indexers configured in Prowlarr, including their category capabilities.</summary>
    public async Task<IReadOnlyList<ProwlarrIndexer>> GetIndexersAsync(
        string baseUrl, string apiKey, CancellationToken ct = default)
    {
        var client = CreateClient(baseUrl, apiKey);
        var indexers = await client.GetFromJsonAsync<List<ProwlarrIndexer>>("api/v1/indexer", ct);
        return indexers ?? [];
    }

    public async Task<bool> PingAsync(string baseUrl, string apiKey, CancellationToken ct = default)
    {
        try
        {
            var client = CreateClient(baseUrl, apiKey);
            var response = await client.GetAsync("api/v1/system/status", ct);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private HttpClient CreateClient(string baseUrl, string apiKey)
    {
        var client = httpClientFactory.CreateClient(HttpClientName);
        client.BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/");
        client.DefaultRequestHeaders.Remove("X-Api-Key");
        client.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
        return client;
    }
}
