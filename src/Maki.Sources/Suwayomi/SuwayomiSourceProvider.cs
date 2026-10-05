using System.Collections.Concurrent;
using System.Globalization;
using Maki.Core.Sources;
using Microsoft.Extensions.Logging;

namespace Maki.Sources.Suwayomi;

/// <summary>
/// Every extension installed in a Suwayomi server, each exposed as its own Maki source so it gets its
/// own on/off switch, priority and health row like any scraper. Refreshed while the app runs, since
/// extensions are installed and removed in Suwayomi's own UI.
/// </summary>
public class SuwayomiSourceProvider(SuwayomiClient client, ILogger<SuwayomiSourceProvider> logger) : IDynamicSourceProvider
{
    private IReadOnlyDictionary<string, SuwayomiExtensionSource> _sources =
        new Dictionary<string, SuwayomiExtensionSource>(StringComparer.OrdinalIgnoreCase);

    // Names no refresh has seen (not discovered yet, or Suwayomi is down at startup) but that an
    // existing mapping still points at. Kept so that mapping keeps working instead of vanishing.
    private readonly ConcurrentDictionary<string, SuwayomiExtensionSource> _unlisted = new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyCollection<ISource> Sources => [.. _sources.Values];

    public ISource? Find(string name)
    {
        if (_sources.TryGetValue(name, out var known))
        {
            return known;
        }

        if (!name.StartsWith(SuwayomiExtensionSource.NamePrefix, StringComparison.OrdinalIgnoreCase) ||
            !long.TryParse(name[SuwayomiExtensionSource.NamePrefix.Length..], NumberStyles.AllowLeadingSign,
                CultureInfo.InvariantCulture, out var id))
        {
            return null;
        }

        return _unlisted.GetOrAdd(name, _ => new SuwayomiExtensionSource(
            client, id.ToString(CultureInfo.InvariantCulture), displayName: string.Empty, SourceLanguages.Default, nsfw: false));
    }

    /// <summary>Re-reads the installed extensions. A failure keeps the last list rather than emptying it.</summary>
    public async Task RefreshAsync(CancellationToken ct)
    {
        if (!SuwayomiClient.Configured)
        {
            _sources = new Dictionary<string, SuwayomiExtensionSource>(StringComparer.OrdinalIgnoreCase);
            return;
        }

        try
        {
            var root = await client.PostAsync("{ sources { nodes { id name displayName lang isNsfw } } }", null, ct);
            var languages = SuwayomiClient.Languages;
            var next = new Dictionary<string, SuwayomiExtensionSource>(StringComparer.OrdinalIgnoreCase);

            foreach (var node in root.GetProperty("sources").GetProperty("nodes").EnumerateArray())
            {
                var id = node.GetProperty("id").GetString()!;
                var lang = node.GetProperty("lang").GetString() ?? string.Empty;
                // "0" is the built-in local source, which reads a folder on the server, not a site.
                if (id == "0" || !languages.Contains(lang.ToLowerInvariant()))
                {
                    continue;
                }

                var display = node.TryGetProperty("displayName", out var d) && d.GetString() is { Length: > 0 } text
                    ? text
                    : node.GetProperty("name").GetString() ?? id;
                var nsfw = node.TryGetProperty("isNsfw", out var n) && n.ValueKind == System.Text.Json.JsonValueKind.True;

                var source = new SuwayomiExtensionSource(client, id, display, lang.ToLowerInvariant(), nsfw);
                next[source.Name] = source;
            }

            _sources = next;
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or System.Text.Json.JsonException
                                       or TaskCanceledException)
        {
            logger.LogWarning("Could not list the Suwayomi sources, keeping the last list: {Message}", ex.Message);
        }
    }
}
