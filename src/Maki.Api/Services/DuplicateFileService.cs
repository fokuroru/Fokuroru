using Maki.Core.Entities;
using Maki.Core.Parsing;
using Maki.Core.Paths;
using Maki.Core.Reading;
using Maki.Data;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Services;

public sealed record DuplicateRemoval(string RelativePath, long Size, double Coverage, IReadOnlyList<string> CoveredBy);

/// <param name="Removals">Files that only repeat what other files hold.</param>
/// <param name="Applied">False for a dry run, or when something (a download in flight) made it hold off.</param>
public sealed record DuplicateReport(IReadOnlyList<DuplicateRemoval> Removals, bool Applied, long FreedBytes);

/// <summary>
/// Keeps a series from holding the same pages twice. Files are compared by their pages
/// (<see cref="PageHashes"/>) because numbers and names do not tell: one source's "Chapter 1.1" is another's
/// whole first volume, and the same volume arrives from a torrent and from a site. A volume that adds up
/// replaces the loose chapters inside it; of two copies of a volume the better survives. The chapter rows
/// that read from a removed file move to the volume that holds them, and a file whose wanted chapters would
/// be left without one stays. Removed files go to the library's trash (<see cref="UpgradeTrash"/>), not away.
/// </summary>
public class DuplicateFileService(
    MakiDbContext db, ReaderArchiveCache archives, KavitaScanService kavitaScans, ILogger<DuplicateFileService> logger)
{
    private sealed class Facts
    {
        public required ChapterFile File { get; init; }
        public required string AbsolutePath { get; init; }
        public required ulong[] Hashes { get; init; }
        public required ParsedReleaseFile Parsed { get; init; }
        public required IReadOnlyList<decimal> Markers { get; init; }
        public required PlanFile Plan { get; init; }
    }

    public async Task<DuplicateReport> RunAsync(int seriesId, bool apply, CancellationToken ct)
    {
        var none = new DuplicateReport([], false, 0);
        var series = await db.Series.Include(s => s.RootFolder).FirstOrDefaultAsync(s => s.Id == seriesId, ct);
        if (series?.RootFolder is null || !Directory.Exists(series.RootFolder.Path))
        {
            return none;
        }

        using var seriesLock = await SeriesLocks.SeriesAsync(seriesId, ct);

        // A download lands a file mid-plan, so a series with one in flight waits for its turn. Queued items
        // do not count: they have claimed nothing, and the check runs again after each import.
        if (await SeriesLocks.InFlight(db.DownloadQueue.IgnoreQueryFilters()).AnyAsync(q => q.SeriesId == seriesId, ct))
        {
            return none;
        }

        var files = await db.ChapterFiles.Where(f => f.SeriesId == seriesId).ToListAsync(ct);
        var chapters = await db.Chapters.Where(c => c.SeriesId == seriesId).ToListAsync(ct);
        var rootPath = series.RootFolder.Path;
        var resolved = files
            .Select(f => (File: f, Path: LibraryPaths.Resolve(rootPath, f.RelativePath)))
            .Where(x => x.Path is not null && System.IO.File.Exists(x.Path) && ComicFile.IsComic(x.Path!)
                        && !ComicFile.IsPdf(x.Path!))
            .ToList();
        if (resolved.Count < 2 || !WorthChecking(resolved.Select(x => (x.File, x.Path!)).ToList(), chapters))
        {
            return none;
        }

        var typical = VolumeValidity.TypicalPages(chapters.Select(c => c.PageCount));
        var facts = new List<Facts>();
        foreach (var (file, path) in resolved)
        {
            var hashes = await HashesAsync(file, path!, ct);
            if (hashes.Length == 0)
            {
                continue;
            }

            var parsed = ReleaseNameParser.ParseFileName(path!);
            var markers = VolumeChapterScanner.ScanCbz(path!);
            facts.Add(new Facts
            {
                File = file, AbsolutePath = path!, Hashes = hashes, Parsed = parsed, Markers = markers,
                Plan = new PlanFile(file.Id, ClassOf(file, parsed, markers, hashes.Length, chapters, typical),
                    (int)file.Tier, hashes.Length, hashes),
            });
        }

        // A file the user protected, or one that a wanted chapter could not be moved off, stays.
        var pinned = facts.Where(f => f.File.Trusted).Select(f => f.File.Id).ToHashSet();
        List<PlanRemoval> removals;
        Dictionary<int, List<(Chapter Chapter, int? Target)>> moves;
        while (true)
        {
            removals = DuplicatePlanner.Plan(facts.Select(f => f.Plan).ToList(), pinned);
            moves = [];
            var blocked = new List<int>();
            var gone = removals.Select(r => r.FileId).ToHashSet();
            var keepers = facts.Where(f => !gone.Contains(f.File.Id) && f.Plan.Class >= FileClass.Volume).ToList();
            foreach (var removal in removals)
            {
                var removed = facts.First(f => f.File.Id == removal.FileId);
                var placed = Place(removed, chapters.Where(c => c.ChapterFileId == removed.File.Id).ToList(), keepers);
                if (placed is null)
                {
                    blocked.Add(removed.File.Id);
                }
                else
                {
                    moves[removed.File.Id] = placed;
                }
            }

            if (blocked.Count == 0)
            {
                break;
            }

            pinned.UnionWith(blocked);
        }

        // A loose file that is the same titled chapter as one inside a valid volume ("Rhythm A" listed as 0.5 by
        // one source and as 0 by another) is the volume's chapter under another number, even when a different
        // scan keeps its pages from matching. Only files nobody asked for, of about the same length.
        var removedIds = removals.Select(r => r.FileId).ToHashSet();
        var volumes = facts.Where(f => !removedIds.Contains(f.File.Id) && f.Plan.Class >= FileClass.Volume).ToList();
        foreach (var f in facts.Where(f => !removedIds.Contains(f.File.Id) && !pinned.Contains(f.File.Id) && f.Plan.Class == FileClass.Loose))
        {
            var rows = chapters.Where(c => c.ChapterFileId == f.File.Id).ToList();
            var twin = rows.Count == 0 || rows.Any(r => r.Wanted) ? null : volumes
                .Select(v => (Volume: v, Rows: chapters.Where(c => c.ChapterFileId == v.File.Id).ToList()))
                .FirstOrDefault(v => rows.All(r => ChapterSequence.TitleKey(r.Title) is { } key && r.Number is { } n
                    && v.Rows.Any(o => ChapterSequence.TitleKey(o.Title) == key && o.Number is { } on && on != n && Math.Abs(on - n) < 1
                                       && o.PageCount is { } pages && Math.Abs(pages - f.Hashes.Length) <= 2))).Volume;
            if (twin is null)
            {
                continue;
            }

            var placed = Place(f, rows, [twin]);
            if (placed is null)
            {
                continue;
            }

            removals.Add(new PlanRemoval(f.File.Id, 1.0, [twin.File.Id]));
            moves[f.File.Id] = placed;
        }

        var report = removals.Select(r =>
        {
            var f = facts.First(x => x.File.Id == r.FileId);
            return new DuplicateRemoval(f.File.RelativePath, f.File.Size, r.Coverage,
                [.. r.CoveredBy.Select(id => facts.First(x => x.File.Id == id).File.RelativePath)]);
        }).ToList();
        if (!apply || removals.Count == 0)
        {
            return new DuplicateReport(report, false, 0);
        }

        long freed = 0;
        var trashed = 0;
        UpgradeTrash.EnsureFolder(rootPath, seriesId);
        foreach (var removal in removals)
        {
            var f = facts.First(x => x.File.Id == removal.FileId);

            // Rows first, so no chapter ever points at a file that has gone.
            foreach (var (chapter, target) in moves[f.File.Id])
            {
                chapter.ChapterFileId = target;
            }

            await db.SaveChangesAsync(ct);

            var trashRelative = UpgradeTrash.NewRelativePath(rootPath, seriesId,
                $"{f.File.Id}-duplicate", Path.GetFileName(f.File.RelativePath));
            var trashPath = LibraryPaths.Resolve(rootPath, trashRelative)!;
            archives.Invalidate(f.File.Id);
            if (!await UpgradeTrash.MoveIntoTrashAsync(f.AbsolutePath, trashPath, logger, CancellationToken.None))
            {
                // The move failed: hand the chapters back so the library still reads from this file.
                foreach (var (chapter, _) in moves[f.File.Id])
                {
                    chapter.ChapterFileId = f.File.Id;
                }

                await db.SaveChangesAsync(CancellationToken.None);
                continue;
            }

            db.ChapterFiles.Remove(f.File);
            await db.SaveChangesAsync(CancellationToken.None);
            freed += f.File.Size;
            trashed++;
            logger.LogInformation(
                "Moved duplicate file {Path} of '{Title}' to the trash ({Coverage:P0} of its pages are in {Others} other file(s)): {Trash}",
                f.File.RelativePath, series.Title, removal.Coverage, removal.CoveredBy.Count, trashRelative);
        }

        if (trashed > 0)
        {
            kavitaScans.QueueScan(Path.Combine(rootPath, series.FolderName), series.Id);
        }

        return new DuplicateReport(report, trashed > 0, freed);
    }

    /// <summary>Duplicates need a volume or a volume-sized file to exist; a series of plain short chapters is skipped without hashing a page.</summary>
    private static bool WorthChecking(IReadOnlyList<(ChapterFile File, string Path)> files, IReadOnlyList<Chapter> chapters)
    {
        var shared = chapters.Where(c => c.ChapterFileId != null).GroupBy(c => c.ChapterFileId!.Value)
            .Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet();
        return files.Any(f => shared.Contains(f.File.Id) || f.File.PageCount >= ChapterSequence.DumpMinPages
            || ReleaseNameParser.ParseFileName(f.Path).IsVolume);
    }

    private static FileClass ClassOf(
        ChapterFile file, ParsedReleaseFile parsed, IReadOnlyList<decimal> markers, int pages,
        IReadOnlyList<Chapter> chapters, double typical)
    {
        var linked = chapters.Where(c => c.ChapterFileId == file.Id).ToList();
        var mains = linked.Where(c => ChapterSequence.IsMain(c.Number)).Select(c => c.Number).Distinct().Count();
        var markerMains = markers.Count(m => ChapterSequence.IsMain(m));
        if (parsed.IsVolume || mains >= 2 || markers.Count >= 2)
        {
            var good = VolumeValidity.IsGood(VolumeValidity.Check(pages, Math.Max(mains, markerMains), typical));
            return !good ? FileClass.Loose : markers.Count > 0 ? FileClass.MarkedVolume : FileClass.Volume;
        }

        var limit = typical > 0 ? Math.Max(ChapterSequence.DumpMinPages, typical * ChapterSequence.DumpFactor) : 120;
        return pages >= limit ? FileClass.Dump : FileClass.Loose;
    }

    /// <summary>
    /// Where each chapter row of a file about to go ends up: a volume that holds it, or no file when it was
    /// not wanted. Null when a wanted chapter has nowhere to go, which keeps the file.
    /// </summary>
    private static List<(Chapter Chapter, int? Target)>? Place(Facts removed, List<Chapter> rows, List<Facts> keepers)
    {
        var best = keepers
            .Select(k => (Keeper: k, Coverage: PageHashes.Coverage(removed.Hashes, [k.Hashes])))
            .Where(x => x.Coverage >= 0.5)
            .OrderByDescending(x => x.Coverage)
            .Select(x => x.Keeper)
            .FirstOrDefault();

        var result = new List<(Chapter, int?)>();
        foreach (var chapter in rows)
        {
            if (best is not null && Holds(best, chapter))
            {
                result.Add((chapter, best.File.Id));
            }
            else if (chapter.Wanted)
            {
                return null;
            }
            else
            {
                result.Add((chapter, null));
            }
        }

        return result;
    }

    private static bool Holds(Facts volume, Chapter chapter)
    {
        var first = volume.Parsed.Volume;
        var last = volume.Parsed.VolumeEnd ?? first;
        var inVolume = first is not null && chapter.Volume is { } v && v >= first && v <= last;
        if (ChapterSequence.IsVolumeRow(chapter.Number, chapter.Volume, chapter.Title))
        {
            return inVolume;
        }

        // A bonus, a magazine, a fractional extra: it lives inside the volume it is listed under.
        if (!ChapterSequence.IsMain(chapter.Number))
        {
            return inVolume;
        }

        return volume.Markers.Count > 0 ? volume.Markers.Contains(chapter.Number!.Value) : inVolume;
    }

    private async Task<ulong[]> HashesAsync(ChapterFile file, string path, CancellationToken ct)
    {
        var key = $"{new FileInfo(path).Length}:{file.DateAdded.Ticks}";
        var stored = await db.ChapterFilePageHashes.FirstOrDefaultAsync(h => h.ChapterFileId == file.Id, ct);
        if (stored is not null && stored.Key == key)
        {
            return PageHashes.Unpack(stored.Hashes);
        }

        var hashes = await Task.Run(() => PageHashes.OfArchive(path, ct), ct);
        if (hashes.Length == 0)
        {
            return hashes;
        }

        if (stored is null)
        {
            db.ChapterFilePageHashes.Add(new ChapterFilePageHashes
            {
                ChapterFileId = file.Id, Hashes = PageHashes.Pack(hashes), Key = key
            });
        }
        else
        {
            stored.Hashes = PageHashes.Pack(hashes);
            stored.Key = key;
        }

        await db.SaveChangesAsync(ct);
        return hashes;
    }
}
