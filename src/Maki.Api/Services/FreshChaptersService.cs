using Maki.Api.Dtos;
using Maki.Core.Entities;
using Maki.Core.Reading;
using Maki.Data;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Services;

/// <summary>One series on Home's rail of new chapters for series the reader had caught up on.</summary>
/// <param name="ChapterId">The oldest of the new chapters still unread, for the card's Read button.</param>
/// <param name="NewChapterCount">New chapters still unread and on disk.</param>
public record HomeFreshItem(
    int SeriesId,
    string SeriesTitle,
    string? CoverUrl,
    int ChapterId,
    string ChapterLabel,
    int NewChapterCount,
    DateTime DiscoveredAt,
    string? SpineColor);

/// <summary>
/// The chapters that arrived for series the caller was up to date on.
/// <para>
/// A chapter counts when sync first listed it as a new release (<see cref="Chapter.DiscoveredAt"/>,
/// null for backfill), within <see cref="Window"/>, it is on disk, and the caller has not read it.
/// The series must have been up to date <em>before</em> those arrived: every main chapter outside
/// the fresh set read, and the series still running. Reading or deleting a fresh chapter takes it
/// off the rail; once nothing fresh is left the series leaves too.
/// </para>
/// </summary>
public class FreshChaptersService(MakiDbContext db)
{
    public static readonly TimeSpan Window = TimeSpan.FromDays(7);

    public async Task<IReadOnlyList<HomeFreshItem>> RailAsync(DateTime now, int limit, CancellationToken ct)
    {
        var cutoff = now - Window;

        var fresh = await db.Chapters
            .AsNoTracking()
            .Where(c => c.DiscoveredAt != null && c.DiscoveredAt >= cutoff && c.ChapterFileId != null)
            .Select(c => new { c.Id, c.SeriesId, c.Number, c.Volume, c.Title, c.IsOneShot, DiscoveredAt = c.DiscoveredAt!.Value })
            .ToListAsync(ct);
        fresh = fresh.Where(c => ReadingStatuses.IsMain(c.Number)).ToList();
        if (fresh.Count == 0)
        {
            return [];
        }

        var seriesIds = fresh.Select(c => c.SeriesId).Distinct().ToList();
        var series = await db.Series
            .AsNoTracking()
            .Where(s => seriesIds.Contains(s.Id))
            .Select(s => new { s.Id, s.Title, s.Status, s.CoverPath, s.LastMetadataRefresh, s.SpineColor })
            .ToDictionaryAsync(s => s.Id, ct);

        // Read by number, in any language and whether or not the file survived: history, as in
        // SeriesReadingService.
        var readNumbers = (await (from p in db.ChapterProgress
                                  join c in db.Chapters on p.ChapterId equals c.Id
                                  where p.Completed && seriesIds.Contains(c.SeriesId)
                                  select new { c.SeriesId, c.Number }).ToListAsync(ct))
            .Where(x => ReadingStatuses.IsMain(x.Number))
            .GroupBy(x => x.SeriesId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Number!.Value).ToHashSet());

        var baseline = (await db.Chapters
                .AsNoTracking()
                .Where(c => seriesIds.Contains(c.SeriesId) && c.Number != null &&
                            (c.DiscoveredAt == null || c.DiscoveredAt < cutoff))
                .Select(c => new { c.SeriesId, c.Number })
                .ToListAsync(ct))
            .Where(x => ReadingStatuses.IsMain(x.Number))
            .GroupBy(x => x.SeriesId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Number!.Value).ToHashSet());

        var items = new List<(HomeFreshItem Item, DateTime At)>();
        foreach (var group in fresh.GroupBy(c => c.SeriesId))
        {
            if (!series.TryGetValue(group.Key, out var s))
            {
                continue;
            }

            var read = readNumbers.GetValueOrDefault(group.Key) ?? [];
            var before = ReadingStatuses.For(s.Status, baseline.GetValueOrDefault(group.Key) ?? [], read);
            if (before != ReadingStatus.UpToDate)
            {
                continue;
            }

            var unread = group.Where(c => !read.Contains(c.Number!.Value)).OrderBy(c => c.Number).ToList();
            if (unread.Count == 0)
            {
                continue;
            }

            var first = unread[0];
            items.Add((new HomeFreshItem(
                s.Id,
                s.Title,
                SeriesDto.CoverUrlFor(s.Id, s.CoverPath, s.LastMetadataRefresh),
                first.Id,
                ChapterLabel.For(first.Number, first.Volume, first.Title, first.IsOneShot),
                unread.Count,
                unread.Max(c => c.DiscoveredAt),
                s.SpineColor), unread.Max(c => c.DiscoveredAt)));
        }

        return items.OrderByDescending(i => i.At).Take(limit).Select(i => i.Item).ToList();
    }
}
