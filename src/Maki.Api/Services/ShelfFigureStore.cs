using System.Text.Json;
using System.Text.RegularExpressions;
using Maki.Api.Configuration;
using Maki.Core.Security;

namespace Maki.Api.Services;

/// <summary>A figure the user has added for their Home shelf.</summary>
/// <param name="Textured">False when the model carries no images or vertex colours, so it will look plain white.</param>
public record ShelfFigure(string Id, string Name, long Size, DateTime AddedAt, bool Textured = true);

public class ShelfFigureException(string key, object? args = null) : Exception(key)
{
    public string Key { get; } = key;

    public object? Args { get; } = args;
}

/// <summary>
/// GLB models each user has uploaded for the collectable figures on their Home shelf, kept under
/// <c>{ConfigDir}/figures/{userId}/</c> as <c>{id}.glb</c> with a small <c>{id}.json</c> beside it for
/// the name. Per user, like the rest of what Home shows, and never part of a backup: these are big and
/// the user can add them again.
/// </summary>
public partial class ShelfFigureStore(AppPaths paths, ICurrentUser user)
{
    public const long MaxBytes = 50L * 1024 * 1024;
    public const int MaxCount = 12;

    [GeneratedRegex("^[0-9a-f]{32}$")]
    private static partial Regex IdPattern();

    private string Dir => Path.Combine(paths.ConfigDir, "figures", user.UserId.ToString());

    private sealed record Meta(string Name, DateTime AddedAt, bool Textured = true);

    public IReadOnlyList<ShelfFigure> List()
    {
        if (!Directory.Exists(Dir))
        {
            return [];
        }

        var figures = new List<ShelfFigure>();
        foreach (var file in Directory.EnumerateFiles(Dir, "*.glb"))
        {
            var id = Path.GetFileNameWithoutExtension(file);
            if (!IdPattern().IsMatch(id))
            {
                continue;
            }

            var meta = ReadMeta(id);
            figures.Add(new ShelfFigure(id, meta?.Name ?? id, new FileInfo(file).Length, meta?.AddedAt ?? File.GetCreationTimeUtc(file), meta?.Textured ?? true));
        }

        return figures.OrderBy(f => f.AddedAt).ToList();
    }

    public async Task<ShelfFigure> SaveAsync(Stream content, string name, CancellationToken ct)
    {
        if (List().Count >= MaxCount)
        {
            throw new ShelfFigureException("error.figures.tooMany", new { max = MaxCount });
        }

        // Read at most one byte past the limit, so an oversized upload is refused without being buffered whole.
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await content.ReadAsync(chunk, ct)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > MaxBytes)
            {
                throw new ShelfFigureException("error.figures.tooLarge", new { max = MaxBytes / (1024 * 1024) });
            }
        }

        var bytes = buffer.ToArray();
        var report = GlbInspector.Inspect(bytes);
        if (report.Error is { } key)
        {
            throw new ShelfFigureException(key);
        }

        Directory.CreateDirectory(Dir);
        var id = Guid.NewGuid().ToString("N");
        var label = CleanName(name);
        await File.WriteAllBytesAsync(Path.Combine(Dir, id + ".glb"), bytes, ct);
        var added = DateTime.UtcNow;
        await File.WriteAllTextAsync(Path.Combine(Dir, id + ".json"), JsonSerializer.Serialize(new Meta(label, added, report.Textured)), ct);
        return new ShelfFigure(id, label, bytes.Length, added, report.Textured);
    }

    /// <summary>The path of one of the user's figures, or null when there is no such figure (or the id is not one).</summary>
    public string? PathOf(string id)
    {
        if (!IdPattern().IsMatch(id))
        {
            return null;
        }

        var path = Path.Combine(Dir, id + ".glb");
        return File.Exists(path) ? path : null;
    }

    public bool Delete(string id)
    {
        var path = PathOf(id);
        if (path is null)
        {
            return false;
        }

        File.Delete(path);
        var sidecar = Path.Combine(Dir, id + ".json");
        if (File.Exists(sidecar))
        {
            File.Delete(sidecar);
        }

        return true;
    }

    private Meta? ReadMeta(string id)
    {
        try
        {
            var path = Path.Combine(Dir, id + ".json");
            return File.Exists(path) ? JsonSerializer.Deserialize<Meta>(File.ReadAllText(path)) : null;
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            return null;
        }
    }

    /// <summary>The name shown in the list: the file's own name without its folder or extension, kept short.</summary>
    private static string CleanName(string name)
    {
        var stem = Path.GetFileNameWithoutExtension(Path.GetFileName(name ?? string.Empty)).Trim();
        if (stem.Length == 0)
        {
            return "Figure";
        }

        return stem.Length > 60 ? stem[..60] : stem;
    }
}
