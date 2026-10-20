using System.Text.RegularExpressions;
using Maki.Core.Reading;

namespace Maki.Api.Services;

/// <summary>
/// Which of a series' chapter rows take part in its reading sequence (what is "next", where the reader
/// leads on to). Many sources list the same work under their own numbering, so a series carries
/// duplicates and entries that are not chapters at all; page counts and volume files settle which is which.
/// <list type="bullet">
/// <item>A volume is preferred over loose chapters: when a number (or a titled bonus) exists both inside a
/// valid volume file and as a loose copy, the volume's row is the one used. A volume whose page count does
/// not fit its chapters (<see cref="VolumeValidity"/>) loses to a loose copy instead.</item>
/// <item>A row many times longer than the series' typical chapter is a whole volume filed under a
/// fractional number, not a chapter.</item>
/// </list>
/// </summary>
public static partial class ChapterSequence
{
    public const int DumpMinPages = 60;
    public const int DumpFactor = 8;

    public sealed record Row(
        int Id, decimal? Number, string Language, string? Title, int? FileId, int? Pages);

    /// <summary>"Chapter 12", "Ch. 12.5", "Vol. 3": a label with nothing in it that tells two chapters apart.</summary>
    [GeneratedRegex(@"^\s*(?:chapter|ch|vol(?:ume)?)\b\.?\s*[\d.\-]*\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex GenericTitle();

    public static bool IsMain(decimal? number) => number is { } n && n >= 0 && n % 1 == 0;

    [GeneratedRegex(@"^\s*vol(?:ume|\.)?\s*\d+\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex VolumeTitle();

    /// <summary>A source's whole-volume entry: no number, a volume, and a title that is just "Volume 3".</summary>
    public static bool IsVolumeRow(decimal? number, int? volume, string? title) =>
        number is null && volume is not null && title is not null && VolumeTitle().IsMatch(title);

    /// <summary>
    /// Swaps chapters that a source also offers as a whole volume for that volume, so one download
    /// replaces many. A volume that is already being retried (<paramref name="backingOff"/>) is not offered,
    /// which is how a volume that failed (or did not add up) falls back to its chapters.
    /// </summary>
    public static List<int> PreferVolumes(
        IReadOnlyList<int> missing, IReadOnlyCollection<Maki.Core.Entities.Chapter> chapters, IReadOnlySet<int> backingOff)
    {
        var volumes = chapters
            .Where(c => c.Wanted && c.ChapterFileId == null && !backingOff.Contains(c.Id) && IsVolumeRow(c.Number, c.Volume, c.Title))
            .GroupBy(c => c.Volume!.Value)
            .ToDictionary(g => g.Key, g => g.Min(c => c.Id));
        if (volumes.Count == 0)
        {
            return missing.ToList();
        }

        var byId = chapters.ToDictionary(c => c.Id);
        var result = new List<int>();
        foreach (var id in missing)
        {
            var chapter = byId[id];
            var swap = IsMain(chapter.Number) && chapter.Volume is { } v && volumes.TryGetValue(v, out var volumeId)
                ? volumeId
                : id;
            if (!result.Contains(swap))
            {
                result.Add(swap);
            }
        }

        return result;
    }

    /// <param name="rows">Every row of one series that has a file.</param>
    /// <param name="filePages">Pages of the files several rows share (volume archives), by file id.</param>
    /// <returns>Ids to leave out of the sequence.</returns>
    public static HashSet<int> Ignored(IReadOnlyList<Row> rows, IReadOnlyDictionary<int, int?> filePages)
    {
        var typical = VolumeValidity.TypicalPages(rows.Select(r => r.Pages));
        var ignored = new HashSet<int>();

        // Rows far longer than a chapter are volumes under a chapter's number.
        if (typical > 0)
        {
            var limit = Math.Max(DumpMinPages, typical * DumpFactor);
            foreach (var row in rows.Where(r => r.Pages >= limit))
            {
                ignored.Add(row.Id);
            }
        }

        // 2 = inside a valid volume, 1 = a loose file, 0 = inside a volume that does not add up.
        var score = new Dictionary<int, int>();
        var shared = rows.Where(r => r.FileId is not null).GroupBy(r => r.FileId!.Value).Where(g => g.Count() > 1);
        var volumeScore = new Dictionary<int, int>();
        foreach (var file in shared)
        {
            var mains = file.Where(r => IsMain(r.Number)).Select(r => r.Number).Distinct().Count();
            var pages = filePages.GetValueOrDefault(file.Key) ?? 0;
            volumeScore[file.Key] = VolumeValidity.IsGood(VolumeValidity.Check(pages, mains, typical)) ? 2 : 0;
        }

        foreach (var row in rows)
        {
            score[row.Id] = row.FileId is { } f && volumeScore.TryGetValue(f, out var s) ? s : 1;
        }

        // The same number in the same language is one chapter: keep the best-backed rows.
        foreach (var group in rows.Where(r => r.Number is not null).GroupBy(r => (r.Number, r.Language)))
        {
            var best = group.Max(r => score[r.Id]);
            foreach (var row in group.Where(r => score[r.Id] < best))
            {
                ignored.Add(row.Id);
            }
        }

        // The same titled bonus under a neighbouring number ("Rhythm A" as 0 and as 0.5).
        foreach (var row in rows.Where(r => r.Number is not null && !string.IsNullOrWhiteSpace(r.Title) && !GenericTitle().IsMatch(r.Title!)))
        {
            var title = row.Title!.Trim().ToLowerInvariant();
            var better = rows.Any(o => o.Id != row.Id && o.Language == row.Language && o.Number is not null
                && o.Number != row.Number && Math.Abs(o.Number.Value - row.Number!.Value) < 1
                && o.Title is not null && o.Title.Trim().ToLowerInvariant() == title
                && score[o.Id] > score[row.Id]);
            if (better)
            {
                ignored.Add(row.Id);
            }
        }

        return ignored;
    }
}
