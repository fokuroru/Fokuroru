using Maki.Core.Entities;
using Maki.Data;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Services;

/// <summary>Where one reader stands against a whole series, from their reading history.</summary>
/// <param name="ReadMain">Main releases read, each counted once whatever language it was read in.</param>
/// <param name="TotalMain">Main releases the series lists, downloaded or not.</param>
public sealed record SeriesReading(ReadingStatus Status, int ReadMain, int TotalMain);

/// <summary>The caller's reading status per series, shared by the series list and detail endpoints.</summary>
public static class SeriesReadingService
{
    /// <summary>
    /// The caller's reading of each series they have completed any chapter of (see
    /// <see cref="ReadingStatuses.For"/>). History, not storage: measured against every chapter the
    /// series lists and every chapter ever completed, so a file removed by auto-delete (progress kept,
    /// file gone) still counts as read, and "all downloaded read" with more still to fetch is not up
    /// to date. Chapter numbers are REAL in SQLite and can't be floored in SQL, so the sets are
    /// built in memory over two narrow projections.
    /// </summary>
    public static async Task<Dictionary<int, SeriesReading>> ForAsync(
        MakiDbContext db, Dictionary<int, SeriesStatus> statuses, CancellationToken ct)
    {
        var ids = statuses.Keys.ToList();
        var read = (await (from p in db.ChapterProgress
                           join c in db.Chapters on p.ChapterId equals c.Id
                           where p.Completed && ids.Contains(c.SeriesId)
                           select new { c.SeriesId, c.Number }).ToListAsync(ct))
            .GroupBy(x => x.SeriesId)
            .ToDictionary(
                g => g.Key,
                g => g.Where(x => ReadingStatuses.IsMain(x.Number)).Select(x => x.Number!.Value).ToHashSet());
        if (read.Count == 0)
        {
            return [];
        }

        var readIds = read.Keys.ToList();
        var listed = (await db.Chapters
                .Where(c => c.Number != null && readIds.Contains(c.SeriesId))
                .Select(c => new { c.SeriesId, c.Number })
                .ToListAsync(ct))
            .Where(x => ReadingStatuses.IsMain(x.Number))
            .GroupBy(x => x.SeriesId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Number!.Value).ToHashSet());

        return read.ToDictionary(
            r => r.Key,
            r =>
            {
                var main = listed.GetValueOrDefault(r.Key) ?? [];
                return new SeriesReading(
                    ReadingStatuses.For(statuses[r.Key], main, r.Value),
                    r.Value.Count(main.Contains),
                    main.Count);
            });
    }
}
