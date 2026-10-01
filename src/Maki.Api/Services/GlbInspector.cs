using System.Buffers.Binary;
using System.Text.Json;

namespace Maki.Api.Services;

/// <summary>
/// Looks over an uploaded GLB before it is stored. A GLB is opened by the browser, so the checks are
/// about what the browser would do with it: it must be a well-formed binary glTF 2.0, it must not name
/// any file or address outside itself (the loader would fetch them), and it must not need a decoder
/// the shelf does not ship, which would leave the figure silently missing.
/// </summary>
public static class GlbInspector
{
    private const uint Magic = 0x46546C67; // "glTF"
    private const uint JsonChunk = 0x4E4F534A; // "JSON"
    private const int MaxJsonBytes = 4 * 1024 * 1024;

    /// <summary>Extensions the shelf's loader handles without extra decoders.</summary>
    private static readonly HashSet<string> Supported = new(StringComparer.Ordinal)
    {
        "KHR_mesh_quantization", "KHR_texture_transform", "EXT_texture_webp", "KHR_texture_basisu",
        "KHR_materials_unlit", "KHR_materials_emissive_strength", "KHR_materials_specular",
        "KHR_materials_ior", "KHR_materials_clearcoat", "KHR_materials_sheen", "KHR_materials_transmission",
        "KHR_materials_volume", "KHR_lights_punctual",
    };

    /// <summary>Null when the file is fine, else the localization key saying why not.</summary>
    public static string? Check(ReadOnlySpan<byte> data)
    {
        if (data.Length < 28 || BinaryPrimitives.ReadUInt32LittleEndian(data) != Magic)
        {
            return "error.figures.notGlb";
        }

        if (BinaryPrimitives.ReadUInt32LittleEndian(data[4..]) != 2
            || BinaryPrimitives.ReadUInt32LittleEndian(data[8..]) != (uint)data.Length)
        {
            return "error.figures.notGlb";
        }

        var jsonLength = BinaryPrimitives.ReadUInt32LittleEndian(data[12..]);
        if (BinaryPrimitives.ReadUInt32LittleEndian(data[16..]) != JsonChunk
            || jsonLength == 0 || jsonLength > MaxJsonBytes || 20L + jsonLength > data.Length)
        {
            return "error.figures.notGlb";
        }

        try
        {
            using var doc = JsonDocument.Parse(data.Slice(20, (int)jsonLength).ToArray());
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("asset", out var asset)
                || asset.ValueKind != JsonValueKind.Object
                || !asset.TryGetProperty("version", out var version)
                || version.GetString() != "2.0"
                || !root.TryGetProperty("meshes", out var meshes)
                || meshes.ValueKind != JsonValueKind.Array
                || meshes.GetArrayLength() == 0)
            {
                return "error.figures.notGlb";
            }

            if (root.TryGetProperty("extensionsRequired", out var required) && required.ValueKind == JsonValueKind.Array)
            {
                foreach (var name in required.EnumerateArray())
                {
                    if (name.GetString() is not { } n || !Supported.Contains(n))
                    {
                        return "error.figures.unsupported";
                    }
                }
            }

            foreach (var group in new[] { "buffers", "images" })
            {
                if (!root.TryGetProperty(group, out var items) || items.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                foreach (var item in items.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Object
                        && item.TryGetProperty("uri", out var uri)
                        && uri.GetString() is { } u
                        && !u.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                    {
                        return "error.figures.external";
                    }
                }
            }
        }
        catch (JsonException)
        {
            return "error.figures.notGlb";
        }

        return null;
    }
}
