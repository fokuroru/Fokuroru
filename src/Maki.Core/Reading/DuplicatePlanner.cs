namespace Maki.Core.Reading;

/// <summary>What a file is, which decides what may stand in for it. Higher outranks lower.</summary>
public enum FileClass
{
    /// <summary>A whole volume filed as a single chapter (Ch.1.1 holding all 185 pages of Volume 1).</summary>
    Dump = 0,

    /// <summary>One chapter, or a volume that does not add up.</summary>
    Loose = 1,

    /// <summary>A valid volume whose page names carry no chapter markers.</summary>
    Volume = 2,

    /// <summary>A valid volume whose page names say which chapter each page is.</summary>
    MarkedVolume = 3,
}

/// <param name="Tier">The file's quality tier as a number; the lower of two equal files goes first.</param>
public sealed record PlanFile(int Id, FileClass Class, int Tier, int Pages, ulong[] Hashes);

/// <param name="CoveredBy">The kept files that between them hold the removed file's pages.</param>
public sealed record PlanRemoval(int FileId, double Coverage, IReadOnlyList<int> CoveredBy);

/// <summary>
/// Decides which files of one series only repeat what other files already hold. A file is redundant when
/// nearly all of its pages are found among the kept files that may stand in for it:
/// a dump can be covered by anything, a loose chapter only by a loose chapter or a volume, a volume only
/// by a volume. So a valid volume replaces the loose chapters inside it, the better of two copies of a
/// volume survives, and a dump never stands in for the chapters it contains.
/// </summary>
public static class DuplicatePlanner
{
    public const double CoveredAt = 0.85;

    /// <summary>Files with fewer informative pages than this are matched as an unbroken run inside one other file.</summary>
    public const int ShortBelow = 6;

    private static IEnumerable<PlanFile> StandInsFor(PlanFile file, IEnumerable<PlanFile> candidates) =>
        candidates.Where(k => k.Id != file.Id && (file.Class == FileClass.Dump || k.Class >= file.Class));

    private static double CoverageOf(PlanFile file, IReadOnlyList<PlanFile> standIns) =>
        file.Hashes.Count(PageHashes.Informative) >= ShortBelow
            ? PageHashes.Coverage(file.Hashes, standIns.Select(k => (IReadOnlyList<ulong>)k.Hashes))
            : standIns.Select(k => PageHashes.AlignedCoverage(file.Hashes, k.Hashes)).DefaultIfEmpty(0).Max();

    /// <param name="pinned">Files that must stay, whatever their pages say.</param>
    public static List<PlanRemoval> Plan(IReadOnlyList<PlanFile> files, IReadOnlySet<int>? pinned = null)
    {
        var stay = pinned is null ? new HashSet<int>() : new HashSet<int>(pinned);
        while (true)
        {
            var removed = Pass(files, stay);

            // A file may have been judged against a stand-in that was itself removed afterwards (a loose
            // chapter covered by a site volume, the site volume covered by a better one). Everything
            // removed must still be covered by what is finally kept; anything that is not stays.
            var gone = removed.Select(r => r.FileId).ToHashSet();
            var finalKept = files.Where(f => !gone.Contains(f.Id)).ToList();
            var unsafeRemovals = removed
                .Where(r => files.First(f => f.Id == r.FileId) is var file
                    && CoverageOf(file, StandInsFor(file, finalKept).ToList()) < CoveredAt)
                .Select(r => r.FileId)
                .ToList();
            if (unsafeRemovals.Count == 0)
            {
                return removed;
            }

            stay.UnionWith(unsafeRemovals);
        }
    }

    private static List<PlanRemoval> Pass(IReadOnlyList<PlanFile> files, IReadOnlySet<int> pinned)
    {
        var kept = files.ToDictionary(f => f.Id);
        var removed = new List<PlanRemoval>();

        // Least valuable first, so a volume is judged only after the loose files it could replace are gone.
        var order = files
            .OrderBy(f => f.Class)
            .ThenBy(f => f.Tier)
            .ThenBy(f => f.Pages)
            .ThenByDescending(f => f.Id);
        foreach (var file in order)
        {
            if (pinned.Contains(file.Id))
            {
                continue;
            }

            var standIns = StandInsFor(file, kept.Values).ToList();
            if (standIns.Count == 0)
            {
                continue;
            }

            var coverage = CoverageOf(file, standIns);
            if (coverage < CoveredAt)
            {
                continue;
            }

            var coveredBy = standIns.Where(k => CoverageOf(file, [k]) > 0).Select(k => k.Id).ToList();
            removed.Add(new PlanRemoval(file.Id, coverage, coveredBy));
            kept.Remove(file.Id);
        }

        return removed;
    }
}
