using Maki.Data;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Services;

/// <summary>
/// Which chapter-file rows point at each file on disk, keyed by absolute path across every root
/// folder. Root folders can overlap (<c>/library</c> and <c>/library/Series</c> are both legal, and
/// existing installs may already have them), so the same file can be two rows under two roots with
/// relative paths that share nothing. Comparing within one root misses that and deletes a file an
/// unread chapter elsewhere still needs.
/// <para>
/// Keys compare case-insensitively on every host. On a case-sensitive filesystem that can only
/// over-report a claim, which keeps a file; the reverse would delete one.
/// </para>
/// </summary>
public sealed class FileClaims
{
    private readonly Dictionary<string, List<int>> _byPath;

    private FileClaims(Dictionary<string, List<int>> byPath) => _byPath = byPath;

    public static async Task<FileClaims> LoadAsync(MakiDbContext db, CancellationToken ct)
    {
        var rows = await (from f in db.ChapterFiles.IgnoreQueryFilters()
                          join s in db.Series.IgnoreQueryFilters() on f.SeriesId equals s.Id
                          join r in db.RootFolders.IgnoreQueryFilters() on s.RootFolderId equals r.Id
                          select new { f.Id, Root = r.Path, f.RelativePath })
            .ToListAsync(ct);

        var byPath = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            if (Key(row.Root, row.RelativePath) is not { } key)
            {
                continue;
            }

            if (!byPath.TryGetValue(key, out var ids))
            {
                byPath[key] = ids = [];
            }

            ids.Add(row.Id);
        }

        return new FileClaims(byPath);
    }

    /// <summary>
    /// Whether any row outside <paramref name="releasing"/> still points at the same file. A path
    /// that cannot be normalised counts as claimed, so nothing is deleted on a guess.
    /// </summary>
    public bool ClaimedByOthers(string rootPath, string relativePath, IReadOnlySet<int> releasing)
    {
        if (Key(rootPath, relativePath) is not { } key)
        {
            return true;
        }

        return _byPath.TryGetValue(key, out var ids) && ids.Any(id => !releasing.Contains(id));
    }

    internal static string? Key(string rootPath, string relativePath)
    {
        try
        {
            var full = Path.GetFullPath(Path.Join(rootPath, relativePath.Replace('\\', '/')));
            return full.Replace('\\', '/').TrimEnd('/');
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return null;
        }
    }
}
