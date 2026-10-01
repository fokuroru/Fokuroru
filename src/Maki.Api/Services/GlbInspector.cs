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
        "KHR_mesh_quantization", "KHR_texture_transform", "EXT_texture_webp",
        "KHR_materials_unlit", "KHR_materials_emissive_strength", "KHR_materials_specular",
        "KHR_materials_ior", "KHR_materials_clearcoat", "KHR_materials_sheen", "KHR_materials_transmission",
        "KHR_materials_volume", "KHR_lights_punctual",
    };

    /// <summary>What was found: an error key, or whether the model carries any colour data of its own.</summary>
    public record Report(string? Error, bool Textured);

    /// <summary>Null when the file is fine, else the localization key saying why not.</summary>
    public static string? Check(ReadOnlySpan<byte> data) => Inspect(data).Error;

    public static Report Inspect(ReadOnlySpan<byte> data)
    {
        var textured = false;
        if (data.Length < 28 || BinaryPrimitives.ReadUInt32LittleEndian(data) != Magic)
        {
            return new Report("error.figures.notGlb", false);
        }

        if (BinaryPrimitives.ReadUInt32LittleEndian(data[4..]) != 2
            || BinaryPrimitives.ReadUInt32LittleEndian(data[8..]) != (uint)data.Length)
        {
            return new Report("error.figures.notGlb", false);
        }

        var jsonLength = BinaryPrimitives.ReadUInt32LittleEndian(data[12..]);
        if (BinaryPrimitives.ReadUInt32LittleEndian(data[16..]) != JsonChunk
            || jsonLength == 0 || jsonLength > MaxJsonBytes || 20L + jsonLength > data.Length)
        {
            return new Report("error.figures.notGlb", false);
        }

        try
        {
            using var doc = JsonDocument.Parse(data.Slice(20, (int)jsonLength).ToArray());
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("asset", out var asset)
                || asset.ValueKind != JsonValueKind.Object
                || !asset.TryGetProperty("version", out var version)
                || version.ValueKind != JsonValueKind.String
                || version.GetString() != "2.0"
                || !root.TryGetProperty("meshes", out var meshes)
                || meshes.ValueKind != JsonValueKind.Array
                || meshes.GetArrayLength() == 0)
            {
                return new Report("error.figures.notGlb", false);
            }

            if (root.TryGetProperty("extensionsRequired", out var required))
            {
                if (required.ValueKind != JsonValueKind.Array)
                {
                    return new Report("error.figures.notGlb", false);
                }

                foreach (var name in required.EnumerateArray())
                {
                    if (name.ValueKind != JsonValueKind.String)
                    {
                        return new Report("error.figures.notGlb", false);
                    }

                    if (name.GetString() is not { } n || !Supported.Contains(n))
                    {
                        return new Report("error.figures.unsupported", false);
                    }
                }
            }

            textured = ColorData(root);

            foreach (var group in new[] { "buffers", "images" })
            {
                if (!root.TryGetProperty(group, out var items))
                {
                    continue;
                }

                if (items.ValueKind != JsonValueKind.Array)
                {
                    return new Report("error.figures.notGlb", false);
                }

                foreach (var item in items.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object)
                    {
                        return new Report("error.figures.notGlb", false);
                    }

                    if (!item.TryGetProperty("uri", out var uri)) continue;
                    if (uri.ValueKind != JsonValueKind.String)
                    {
                        return new Report("error.figures.notGlb", false);
                    }

                    if (!uri.GetString()!.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                    {
                        return new Report("error.figures.external", false);
                    }
                }
            }
        }
        catch (JsonException)
        {
            return new Report("error.figures.notGlb", false);
        }

        return new Report(null, textured);
    }

    /// <summary>Whether the model has images, or colours painted on its vertices. Neither means it will look plain white.</summary>
    private static bool ColorData(JsonElement root)
    {
        if (root.TryGetProperty("images", out var images) && images.ValueKind == JsonValueKind.Array && images.GetArrayLength() > 0)
        {
            return true;
        }

        if (root.TryGetProperty("meshes", out var meshes))
        {
            foreach (var mesh in meshes.EnumerateArray())
            {
                if (mesh.ValueKind == JsonValueKind.Object && mesh.TryGetProperty("primitives", out var prims) && prims.ValueKind == JsonValueKind.Array)
                {
                    foreach (var prim in prims.EnumerateArray())
                    {
                        if (prim.ValueKind == JsonValueKind.Object && prim.TryGetProperty("attributes", out var attrs)
                            && attrs.ValueKind == JsonValueKind.Object && attrs.TryGetProperty("COLOR_0", out _))
                        {
                            return true;
                        }
                    }
                }
            }
        }

        return false;
    }
}
