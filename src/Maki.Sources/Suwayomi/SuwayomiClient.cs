using System.Net.Http.Json;
using System.Text.Json;
using Maki.Core.Sources;

namespace Maki.Sources.Suwayomi;

/// <summary>
/// The GraphQL and page-image calls to one self-hosted Suwayomi server, shared by every
/// <see cref="SuwayomiExtensionSource"/>. Off unless <see cref="BaseUrlVariable"/> is set: with no
/// server to ask there are no sources, instead of every search failing with a connection error.
/// </summary>
public class SuwayomiClient(IHttpClientFactory httpClientFactory)
{
    public const string HttpClientName = "source-suwayomi";

    /// <summary>The address Maki itself uses, usually a container name such as <c>http://suwayomi:4567</c>.</summary>
    public const string BaseUrlVariable = "MAKI_SOURCE_SUWAYOMI_BASEURL";

    /// <summary>
    /// Where a browser reaches Suwayomi's web UI. <see cref="BaseUrlVariable"/> often names a host no
    /// browser can resolve, so links shown to people use this instead.
    /// </summary>
    public const string PublicUrlVariable = "MAKI_SOURCE_SUWAYOMI_PUBLICURL";

    /// <summary>
    /// Comma-separated Suwayomi source languages to expose, English when unset. One extension can
    /// register a source per language (one installed here shows up ninety times); each is its own
    /// Maki source, so exposing them all would bury the settings list. "all" is opt-in because those
    /// sources mix languages and do not say which one a chapter is in.
    /// </summary>
    public const string LanguagesVariable = "MAKI_SOURCE_SUWAYOMI_LANGUAGES";

    public static bool Configured => !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(BaseUrlVariable));

    /// <summary>The address to show people: the public one when set, else the one Maki uses.</summary>
    public static string PublicUrl =>
        Environment.GetEnvironmentVariable(PublicUrlVariable)?.TrimEnd('/') is { Length: > 0 } publicUrl
            ? publicUrl
            : Environment.GetEnvironmentVariable(BaseUrlVariable)?.TrimEnd('/') ?? "http://suwayomi:4567";

    public static IReadOnlyList<string> Languages =>
        SourceLanguages.Parse(Environment.GetEnvironmentVariable(LanguagesVariable));

    private HttpClient Client => httpClientFactory.CreateClient(HttpClientName);

    /// <returns>The <c>data</c> object, after treating any GraphQL <c>errors</c> as a failure.</returns>
    public async Task<JsonElement> PostAsync(string query, object? variables, CancellationToken ct)
    {
        using var response = await Client.PostAsJsonAsync("api/graphql", new { query, variables }, ct);
        response.EnsureSuccessStatusCode();
        var root = await response.Content.ReadFromJsonAsync<JsonElement>(ct);

        if (root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0)
        {
            var message = errors[0].TryGetProperty("message", out var m) ? m.GetString() : "unknown error";
            throw new InvalidOperationException($"Suwayomi: {message?.Split('\n')[0]}");
        }

        return root.GetProperty("data");
    }

    /// <summary>A page image, by the server-relative path Suwayomi listed for it.</summary>
    public Task<byte[]> GetPageAsync(string path, CancellationToken ct) =>
        Client.GetByteArrayAsync(path.TrimStart('/'), ct);
}
