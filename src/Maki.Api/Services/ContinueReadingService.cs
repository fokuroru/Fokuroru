using Maki.Core.Entities;
using Maki.Core.Reading;
using Maki.Data;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Services;

/// <summary>
/// What to read next in a series, and how much of it is left.
/// </summary>
/// <param name="ChapterId">The next chapter that has not been read.</param>
/// <param name="Label">Rendered server-side — see <see cref="ChapterLabel"/> for why.</param>
/// <param name="UnreadChapters">Candidate chapters in the series still unread, this one included.</param>
/// <param name="Downloaded">Whether it is on disk. Only ever false when missing chapters were asked for.</param>
public record NextChapter(int ChapterId, string Label, int UnreadChapters, bool Downloaded = true);

/// <summary>
/// Resolves "what do I read next" for a <em>set</em> of series in a fixed number of queries.
/// <para>
/// The per-series reader endpoint used to load every chapter row of the series and order them in
/// memory. That is fine for one series behind a detail page and quadratic behind a dashboard rail,
/// so both callers now come through here. The in-memory ordering itself stays: <c>Chapter.Number</c>
/// is a decimal stored as REAL and one-shots sort last on a null, neither of which SQLite can
/// express in an ORDER BY.
/// </para>
/// <para>
/// Reads <see cref="Maki.Core.Entities.ChapterProgress"/> and nothing else. <c>ReadingState</c> is
/// deliberately never joined here: <c>MaxChapter</c> is a forward-only mark that reports chapters
/// read which were never opened, and that table legally holds duplicate rows per <c>SeriesId</c>
/// (two Kavita series can resolve to one local series), so a join would also multiply rows.
/// </para>
/// </summary>
public class ContinueReadingService(MakiDbContext db, Maki.Core.Configuration.IAppSettings? settings = null)
{
    /// <summary>
    /// The next unread downloaded chapter per series. Series with nothing left to read are absent
    /// from the result rather than present with a null — callers drop them from their rails.
    /// </summary>
    /// <param name="includeMissing">
    /// Also consider chapters that are not downloaded yet, for a caller that can fetch one before
    /// opening it (the series page's "Download &amp; read"). Only a wanted chapter counts: one marked
    /// as not wanted was skipped on purpose and must not be offered for download. Rails leave this
    /// off: they can only offer what opens straight away.
    /// </param>
    public async Task<Dictionary<int, NextChapter>> NextForAsync(
        IReadOnlyCollection<int> seriesIds, CancellationToken ct, bool includeMissing = false)
    {
        if (seriesIds.Count == 0)
        {
            return [];
        }

        // A tombstone (explicitly marked unread) is Completed = false, so it correctly falls out of
        // this set and the chapter is offered again as next-to-read.
        var completed = (await db.ChapterProgress
                .Where(p => seriesIds.Contains(p.SeriesId) && p.Completed)
                .Select(p => p.ChapterId)
                .ToListAsync(ct))
            .ToHashSet();

        // Every chapter, not just downloaded ones: a volume's chapter 0 sorts by where the rest of
        // its volume sits, and those chapters may not be on disk.
        var chapters = await db.Chapters
            .Where(c => seriesIds.Contains(c.SeriesId))
            .Select(c => new { c.Id, c.SeriesId, c.Number, c.Volume, c.Title, c.IsOneShot, c.Wanted, c.PageCount, c.Language, c.ChapterFileId, HasFile = c.ChapterFileId != null })
            .ToListAsync(ct);

        // Pages of the archives several chapters share (volumes), to tell a volume that adds up from one that does not.
        var sharedFileIds = chapters.Where(c => c.ChapterFileId != null)
            .GroupBy(c => c.ChapterFileId!.Value).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        var filePages = sharedFileIds.Count == 0
            ? new Dictionary<int, int?>()
            : await db.ChapterFiles.Where(f => sharedFileIds.Contains(f.Id))
                .Select(f => new { f.Id, f.PageCount }).ToDictionaryAsync(f => f.Id, f => f.PageCount, ct);

        // Chapters held back until enough pages have piled up are not "next" for anyone to read.
        var banked = await ChapterBanking.BankedForCallerAsync(db, settings, seriesIds, ct);

        var result = new Dictionary<int, NextChapter>();
        foreach (var group in chapters.GroupBy(c => c.SeriesId))
        {
            var hidden = banked.GetValueOrDefault(group.Key);
            var ordered = ChapterOrder.Sort(group, c => c.Number, c => c.Volume, c => c.Id);
            bool Candidate(bool hasFile, bool wanted, decimal? number) =>
                hasFile || (includeMissing && wanted);

            // A release read under any row of its number is read: providers disagreeing on a volume
            // leave two rows for one chapter, and reading one must not leave the other "next".
            var readNumbers = ordered.Where(c => c.Number is not null && completed.Contains(c.Id))
                .Select(c => c.Number).ToHashSet();
            // Duplicates, volumes filed as chapters and rows of volumes that do not add up are not part of the sequence.
            var skipped = ChapterSequence.Ignored(
                ordered.Where(c => c.HasFile)
                    .Select(c => new ChapterSequence.Row(c.Id, c.Number, c.Language, c.Title, c.ChapterFileId, c.PageCount))
                    .ToList(),
                filePages);
            bool Unread(bool hasFile, bool wanted, decimal? number, int id) =>
                Candidate(hasFile, wanted, number) && !completed.Contains(id) && hidden?.Contains(id) != true
                && (number is null || !readNumbers.Contains(number)) && !skipped.Contains(id);

            var everything = ordered.Where(c => Unread(c.HasFile, c.Wanted, c.Number, c.Id)).ToList();
            // What the reader asked for comes before what merely happens to be on disk: a chapter
            // marked unwanted (an extra, a duplicate rip) is offered only when nothing wanted is left.
            var unread = everything.Where(c => c.Wanted).ToList();
            if (unread.Count == 0)
            {
                unread = everything;
            }

            if (unread.Count == 0)
            {
                continue;
            }

            // The earliest unread chapter after the furthest one read, else the earliest unread
            // (everything past the furthest read is done, so offer what was skipped). Another
            // language's copy of the furthest chapter is not "next".
            // Only whole-numbered chapters (the prologue included) move that place: a bonus read out of
            // curiosity (0.1, 37.5) says nothing about the chapters around it being read.
            var furthestRead = ordered.FindLastIndex(c => c.Number is { } n && n >= 0 && n % 1 == 0 && completed.Contains(c.Id));
            var furthestNumber = furthestRead < 0 ? null : ordered[furthestRead].Number;
            var next = ordered.Skip(furthestRead + 1)
                           .FirstOrDefault(c => unread.Contains(c) && (furthestRead < 0 || c.Number != furthestNumber))
                       ?? unread[0];

            if (includeMissing)
            {
                // The series page offers the earliest chapter never read, so one stray read chapter
                // (a mark from Kavita, a misclick) cannot hide dozens of unread ones before it. A
                // chapter whose number was read in another language does not count as unread.
                next = unread.FirstOrDefault(c => c.Number is null || !readNumbers.Contains(c.Number)) ?? next;
            }

            // Another language's copy of the same release already on disk beats fetching this one.
            if (!next.HasFile && next.Number is not null)
            {
                next = unread.FirstOrDefault(c => c.HasFile && c.Number == next.Number && c.Volume == next.Volume) ?? next;
            }

            result[group.Key] = new NextChapter(
                next.Id,
                ChapterLabel.For(next.Number, next.Volume, next.Title, next.IsOneShot),
                unread.Count,
                next.HasFile);
        }

        return result;
    }

    /// <summary>Convenience wrapper for the single-series reader endpoint.</summary>
    public async Task<NextChapter?> NextForAsync(int seriesId, CancellationToken ct, bool includeMissing = false) =>
        (await NextForAsync(new[] { seriesId }, ct, includeMissing)).GetValueOrDefault(seriesId);
}
