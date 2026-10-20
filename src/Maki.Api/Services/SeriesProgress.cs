using System.Globalization;
using Maki.Core.Reading;

namespace Maki.Api.Services;

/// <param name="Page">Zero-based page the reader is on; ignored unless <see cref="Started"/>.</param>
/// <param name="ProgressPages">Pages the reading record was taken against, or 0.</param>
public sealed record ProgChapter(
    int Id, decimal? Number, string Language, int? Volume, int? PlacedVolume, decimal? PlacedAfter,
    string? Title, bool IsOneShot, bool Wanted, int? FileId, int? Pages, bool Banked,
    bool Completed, bool Started, int Page, int ProgressPages, DateTime? Touched);

public sealed record ProgFile(int Id, string Name, long Size, int Pages, string? Source);

public sealed record ProgressPosition(
    int ChapterId, string Label, int Page, int PageCount, bool InProgress, IReadOnlyList<string> Next);

public sealed record ProgressTotals(int Chapters, int Ready, int Read, int Missing);

/// <param name="Kind">chapter | bonus</param>
/// <param name="State">read | started | ready | missing | skipped | banked</param>
/// <param name="Why">How a bonus was placed: user | source | number.</param>
public sealed record ProgressRow(
    int ChapterId, string? Number, string? Title, string Kind, string State, int? Pages, string? Why);

public sealed record ProgressVolume(
    int? Volume, decimal? From, decimal? To, int Chapters, int Read, int Started, int Ready, int Missing, int Bonus,
    IReadOnlyList<ProgressRow> Rows);

/// <param name="Kind">duplicateNumber | hiddenListings</param>
public sealed record ProgressNote(string Kind, int Count, IReadOnlyList<string> Numbers);

/// <param name="Hint">year | short | noVolume | unlinked</param>
public sealed record ProgressUnplaced(int? ChapterId, int? FileId, string FileName, int Pages, string? Source, string Hint);

public sealed record ProgressDisk(
    int Files, long Bytes, int VolumeFiles, int VolumeChapters, int LooseFiles, int TrashFiles, long TrashBytes,
    DateTime? PurgeAfter);

public sealed record SeriesProgress(
    ProgressPosition? Position, ProgressTotals Totals, IReadOnlyList<ProgressVolume> Volumes,
    IReadOnlyList<ProgressNote> NeedsLook, IReadOnlyList<ProgressUnplaced> Unplaced, ProgressDisk Disk);

/// <summary>
/// The series page's answer to "where am I, what is left, what is missing": chapters grouped by volume with their
/// bonus entries in the position the evidence gives them (the user's own slotting, the volume a source lists them
/// under, or the chapter their number follows), and whatever has no evidence set aside to be placed by hand.
/// Pure: the service feeds it rows and files, so every rule here is testable without a database.
/// </summary>
public static class SeriesProgressBuilder
{
    private const decimal End = 1_000_000_000m;

    private static bool YearLike(decimal n) => n % 1 == 0 && n is >= 1900 and <= 2100;

    private static bool IsMain(decimal? n) => n is { } v && v >= 0 && v % 1 == 0 && !YearLike(v);

    private static string? Format(decimal? n) => n?.ToString("0.###", CultureInfo.InvariantCulture);

    public static SeriesProgress Build(IReadOnlyList<ProgChapter> allChapters, IReadOnlyList<ProgFile> files)
    {
        // A "Volume 3" entry is the volume itself, not a chapter or a bonus in it. And a bonus linked to a whole volume file
        // without a slice of its own (its pages are the whole file's) is not actually in that file: sources list extras
        // that a volume does not contain, and volume-range linking hands them the file all the same.
        var sharedFiles = allChapters.Where(c => c.FileId != null).GroupBy(c => c.FileId!.Value)
            .Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet();
        bool NoSlice(ProgChapter c) =>
            c.FileId is { } f && sharedFiles.Contains(f) && !IsMain(c.Number)
            && files.FirstOrDefault(x => x.Id == f) is { Pages: >= 60 } file && (c.Pages ?? 0) >= file.Pages;
        var chapters = allChapters
            .Where(c => !ChapterSequence.IsVolumeRow(c.Number, c.Volume, c.Title))
            .Select(c => NoSlice(c) ? c with { FileId = null, Pages = null } : c)
            .ToList();

        var sourceVolumes = chapters.Select(c => (c.Volume, c.Number)).ToList();
        var readNumbers = chapters.Where(c => c.Completed && c.Number is not null).Select(c => c.Number!.Value).ToHashSet();

        var reps = new Dictionary<decimal, ProgChapter>();
        var memberIds = new HashSet<int>();
        var duplicates = new List<decimal>();
        foreach (var group in chapters.Where(c => IsMain(c.Number)).GroupBy(c => c.Number!.Value).OrderBy(g => g.Key))
        {
            var expected = VolumeRanges.ContinuousVolumeOf(sourceVolumes, group.Key);
            reps[group.Key] = group
                .OrderByDescending(c => c.FileId != null)
                .ThenByDescending(c => expected is not null && (c.PlacedVolume ?? c.Volume) == expected)
                .ThenBy(c => c.Id)
                .First();
            memberIds.UnionWith(group.Select(c => c.Id));
            if (group.GroupBy(c => c.Language).Any(l => l.Count() > 1))
            {
                duplicates.Add(group.Key);
            }
        }

        int? VolumeOf(ProgChapter c) =>
            c.PlacedVolume ?? c.Volume ?? (c.Number is { } n && IsMain(n) ? VolumeRanges.ContinuousVolumeOf(sourceVolumes, n, fillGaps: true) : null);

        string State(ProgChapter c) =>
            c.Banked ? "banked"
            : c.Completed || (c.Number is { } n && readNumbers.Contains(n)) ? "read"
            : c.Started ? "started"
            : c.FileId != null ? "ready"
            : c.Wanted ? "missing"
            : "skipped";

        string? FileName(int? id) => files.FirstOrDefault(f => f.Id == id)?.Name;

        var placed = new List<(int? Volume, decimal Key, ProgressRow Row, bool Main, ProgChapter Chapter)>();
        foreach (var rep in reps.Values)
        {
            placed.Add((VolumeOf(rep), rep.Number!.Value, new ProgressRow(rep.Id, Format(rep.Number), TitleOf(rep), "chapter", State(rep), rep.Pages, null), true, rep));
        }

        var unplaced = new List<ProgressUnplaced>();
        var hidden = 0;
        foreach (var b in chapters.Where(c => !memberIds.Contains(c.Id)))
        {
            int? volume = null;
            decimal? after = null;
            string? why = null;
            if (b.PlacedVolume is { } pv)
            {
                (volume, after, why) = (pv, b.PlacedAfter, "user");
            }
            else if (b.Volume is { } sv)
            {
                (volume, after, why) = (sv, b.Number is { } n ? decimal.Floor(n) : null, "source");
            }
            else if (b.FileId != null && b.Number is { } fn && fn % 1 != 0 && !YearLike(fn)
                     && reps.TryGetValue(decimal.Floor(fn), out var floorRep) && VolumeOf(floorRep) is { } fv)
            {
                (volume, after, why) = (fv, decimal.Floor(fn), "number");
            }

            if (why is null)
            {
                if (b.FileId != null)
                {
                    var pages = files.FirstOrDefault(f => f.Id == b.FileId)?.Pages ?? b.Pages ?? 0;
                    unplaced.Add(new ProgressUnplaced(b.Id, b.FileId, FileName(b.FileId) ?? TitleOf(b) ?? Format(b.Number) ?? "?",
                        pages, files.FirstOrDefault(f => f.Id == b.FileId)?.Source,
                        b.Number is { } yn && YearLike(yn) ? "year" : pages <= 3 ? "short" : "noVolume"));
                }
                else
                {
                    hidden++;
                }

                continue;
            }

            var key = why == "user"
                ? (after is null ? End - 1 : after.Value < 0 ? -1m : after.Value + 0.001m)
                : b.Number ?? (after is null ? End : after.Value + 0.5m);
            placed.Add((volume, key, new ProgressRow(b.Id, Format(b.Number), TitleOf(b), "bonus", State(b), b.Pages, why), false, b));
        }

        var linked = allChapters.Where(c => c.FileId != null).Select(c => c.FileId!.Value).ToHashSet();
        foreach (var f in files.Where(f => !linked.Contains(f.Id)))
        {
            unplaced.Add(new ProgressUnplaced(null, f.Id, f.Name, f.Pages, f.Source, "unlinked"));
        }

        var volumes = placed
            .GroupBy(p => p.Volume)
            .OrderBy(g => g.Key is null ? 1 : 0).ThenBy(g => g.Key)
            .Select(g =>
            {
                var ordered = g.OrderBy(p => p.Key).ThenBy(p => p.Chapter.Number).ThenBy(p => p.Chapter.Id).ToList();
                var mains = ordered.Where(p => p.Main && p.Row.State != "banked").ToList();
                return new ProgressVolume(
                    g.Key,
                    mains.Count == 0 ? null : mains.Min(p => p.Chapter.Number),
                    mains.Count == 0 ? null : mains.Max(p => p.Chapter.Number),
                    mains.Count,
                    mains.Count(p => p.Row.State == "read"),
                    mains.Count(p => p.Row.State == "started"),
                    mains.Count(p => p.Row.State == "ready"),
                    mains.Count(p => p.Row.State == "missing"),
                    ordered.Count(p => !p.Main),
                    ordered.Select(p => p.Row).ToList());
            })
            .ToList();

        var allMains = placed.Where(p => p.Main && p.Row.State != "banked").Select(p => p.Row.State).ToList();
        var totals = new ProgressTotals(
            allMains.Count,
            allMains.Count(s => s is "ready" or "started"),
            allMains.Count(s => s == "read"),
            allMains.Count(s => s == "missing"));

        var notes = new List<ProgressNote>();
        if (duplicates.Count > 0)
        {
            notes.Add(new ProgressNote("duplicateNumber", duplicates.Count, [.. duplicates.Take(5).Select(d => Format(d)!)]));
        }

        if (hidden > 0)
        {
            notes.Add(new ProgressNote("hiddenListings", hidden, []));
        }

        return new SeriesProgress(
            PositionOf(chapters, reps, VolumeOf, readNumbers), totals, volumes, notes, unplaced,
            new ProgressDisk(0, 0, 0, 0, 0, 0, 0, null));
    }

    private static string? TitleOf(ProgChapter c) =>
        string.IsNullOrWhiteSpace(c.Title) || ChapterSequence.TitleKey(c.Title) is null ? null : c.Title.Trim();

    private static ProgressPosition? PositionOf(
        IReadOnlyList<ProgChapter> chapters, Dictionary<decimal, ProgChapter> reps,
        Func<ProgChapter, int?> volumeOf, HashSet<decimal> readNumbers)
    {
        string Label(ProgChapter c) => ChapterLabel.For(c.Number, volumeOf(c), c.Title, c.IsOneShot);

        var readable = reps.Values.Where(c => !c.Banked && c.FileId != null && !c.Completed
            && !(c.Number is { } n && readNumbers.Contains(n))).OrderBy(c => c.Number).ToList();

        var started = chapters.Where(c => c.Started && !c.Completed && !c.Banked && c.FileId != null && !ChapterSequence.IsVolumeRow(c.Number, c.Volume, c.Title))
            .OrderByDescending(c => c.Touched).FirstOrDefault();
        if (started is not null)
        {
            var pages = started.ProgressPages > 0 ? started.ProgressPages : started.Pages ?? 0;
            return new ProgressPosition(started.Id, Label(started), started.Page + 1, pages, true,
                Next(readable, started.Number).Select(Label).ToList());
        }

        var furthest = reps.Values.Where(c => c.Completed || readNumbers.Contains(c.Number!.Value))
            .Select(c => c.Number!.Value).DefaultIfEmpty(-1m).Max();
        var first = readable.FirstOrDefault(c => c.Number > furthest) ?? readable.FirstOrDefault();
        return first is null
            ? null
            : new ProgressPosition(first.Id, Label(first), 1, first.Pages ?? 0, false, Next(readable, first.Number).Select(Label).ToList());

        static IEnumerable<ProgChapter> Next(List<ProgChapter> readable, decimal? after) =>
            readable.Where(c => c.Number > (after ?? -1m)).Take(2);
    }
}
