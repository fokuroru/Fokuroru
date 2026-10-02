using System.Text.Json;
using System.Text.Json.Serialization;

namespace Maki.Api.Services;

/// <summary>
/// A rectangle on the reader page that does something when tapped. Position and size are fractions of
/// the page, so a layout holds for any screen. Earlier zones win where they overlap.
/// </summary>
public record TapZone(double X, double Y, double W, double H, string Action);

/// <summary>A layout saved under a name. <c>Orientation</c> says which of the two layouts it fits.</summary>
public record TapZonePreset(string Id, string Name, string Orientation, List<TapZone>? Zones);

/// <summary>
/// What one client kind keeps for one user: the layout in use for paged and for scrolling reading (null
/// means the built-in one), and the presets saved for either.
/// </summary>
public record TapZoneDocument(
    List<TapZone>? Horizontal,
    List<TapZone>? Vertical,
    List<TapZonePreset>? Presets);

/// <summary>
/// Reads, checks and tidies the tap zone document. It is stored as JSON in a per-user setting and handed
/// to every reader, so what goes in is bounded here rather than trusted: counts, sizes and names are
/// capped, coordinates are clamped to the page, and an action has to be one the reader knows.
/// </summary>
public static class TapZoneDocuments
{
    public const int MaxZones = 16;
    public const int MaxPresets = 20;
    public const int MaxNameLength = 40;
    public const double MinSide = 0.02;

    public static readonly string[] Actions = ["next", "prev", "menu", "nextChapter", "prevChapter", "bookmark", "none"];
    public static readonly string[] Orientations = ["horizontal", "vertical"];

    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static TapZoneDocument Empty => new(null, null, []);

    /// <summary>Null when the document is unusable, which a caller turns into a validation error.</summary>
    public static TapZoneDocument? Tidy(TapZoneDocument? document)
    {
        if (document is null)
        {
            return null;
        }

        var horizontal = TidyZones(document.Horizontal, out var horizontalOk);
        var vertical = TidyZones(document.Vertical, out var verticalOk);
        if (!horizontalOk || !verticalOk)
        {
            return null;
        }

        var presets = document.Presets ?? [];
        if (presets.Count > MaxPresets)
        {
            return null;
        }

        var tidied = new List<TapZonePreset>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var preset in presets)
        {
            var name = (preset.Name ?? string.Empty).Trim();
            if (name.Length is 0 or > MaxNameLength ||
                !Orientations.Contains(preset.Orientation) ||
                !ValidId(preset.Id) || !seen.Add(preset.Id))
            {
                return null;
            }

            var zones = TidyZones(preset.Zones ?? [], out var ok);
            if (!ok || zones is null)
            {
                return null;
            }

            tidied.Add(new TapZonePreset(preset.Id, name, preset.Orientation, zones));
        }

        return new TapZoneDocument(horizontal, vertical, tidied);
    }

    public static string Serialize(TapZoneDocument document) => JsonSerializer.Serialize(document, Options);

    public static TapZoneDocument Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return Empty;
        }

        try
        {
            return Tidy(JsonSerializer.Deserialize<TapZoneDocument>(json, Options)) ?? Empty;
        }
        catch (JsonException)
        {
            return Empty;
        }
    }

    private static bool ValidId(string? id) =>
        !string.IsNullOrEmpty(id) && id.Length <= 40 &&
        id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    private static List<TapZone>? TidyZones(List<TapZone>? zones, out bool ok)
    {
        ok = true;
        if (zones is null)
        {
            return null;
        }

        if (zones.Count > MaxZones)
        {
            ok = false;
            return null;
        }

        var tidied = new List<TapZone>(zones.Count);
        foreach (var zone in zones)
        {
            if (!Actions.Contains(zone.Action) ||
                !double.IsFinite(zone.X) || !double.IsFinite(zone.Y) ||
                !double.IsFinite(zone.W) || !double.IsFinite(zone.H))
            {
                ok = false;
                return null;
            }

            var x = Math.Clamp(zone.X, 0, 1 - MinSide);
            var y = Math.Clamp(zone.Y, 0, 1 - MinSide);
            var w = Math.Clamp(zone.W, MinSide, 1 - x);
            var h = Math.Clamp(zone.H, MinSide, 1 - y);
            tidied.Add(new TapZone(Math.Round(x, 3), Math.Round(y, 3), Math.Round(w, 3), Math.Round(h, 3), zone.Action));
        }

        return tidied;
    }
}
