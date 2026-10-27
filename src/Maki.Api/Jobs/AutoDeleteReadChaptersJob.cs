using Maki.Api.Services;
using Maki.Core.Configuration;
using Maki.Data;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace Maki.Api.Jobs;

/// <summary>
/// Deletes the files of chapters read more than <see cref="SettingKeys.LibraryAutoDeleteReadDays"/>
/// days ago. The chapter row stays (so read history and counts survive) and is marked removed
/// (<see cref="Maki.Core.Entities.Chapter.FileRemovedAt"/>), so nothing downloads it again. The delete is
/// permanent: cleanup runs unattended, so it never fills the recycle bin.
/// <para>
/// A file backing several chapters (a volume) goes only once every one of them qualifies, and a file
/// any other row points at, in this root or through an overlapping one, stays on disk
/// (<see cref="ChapterFileDeletion.ClaimedAsync"/>).
/// </para>
/// </summary>
[DisallowConcurrentExecution]
public class AutoDeleteReadChaptersJob(
    MakiDbContext db,
    IAppSettings settings,
    ChapterFileDeletion deletion,
    TimeProvider time,
    ILogger<AutoDeleteReadChaptersJob> logger) : IJob
{
    public const int MaxDays = 3650;

    public static async Task<int> DaysAsync(IAppSettings settings, CancellationToken ct) =>
        int.TryParse(await settings.GetAsync(SettingKeys.LibraryAutoDeleteReadDays, ct), out var days)
        && days is > 0 and <= MaxDays
            ? days
            : 0;

    public static async Task<bool> KeepLastAsync(IAppSettings settings, CancellationToken ct) =>
        await settings.GetAsync(SettingKeys.LibraryAutoDeleteKeepLast, ct) == "true";

    /// <summary>
    /// The chapter each reader completed most recently in each series. These are where people are up
    /// to, so with "keep the last read chapter" on they stay however long ago they were read.
    /// </summary>
    public static async Task<HashSet<int>> LastReadChapterIdsAsync(MakiDbContext db, CancellationToken ct)
    {
        var latest = db.ChapterProgress
            .Where(p => p.Completed && p.CompletedAt != null && p.UnreadAt == null)
            .GroupBy(p => new { p.UserId, p.SeriesId })
            .Select(g => new { g.Key.UserId, g.Key.SeriesId, At = g.Max(p => p.CompletedAt) });
        var ids = await db.ChapterProgress
            .Join(latest, p => new { p.UserId, p.SeriesId }, l => new { l.UserId, l.SeriesId }, (p, l) => new { p, l.At })
            .Where(x => x.p.Completed && x.p.CompletedAt == x.At)
            .Select(x => x.p.ChapterId)
            .Distinct()
            .ToListAsync(ct);
        return ids.ToHashSet();
    }

    internal async Task<List<int>> BankedLastReadIdsAsync(CancellationToken ct)
    {
        var pages = await ChapterBanking.PagesAsync(settings, ct);
        if (pages <= 0)
        {
            return [];
        }

        var kept = new List<int>();
        var userIds = await db.ChapterProgress.IgnoreQueryFilters()
            .Where(p => p.Completed).Select(p => p.UserId).Distinct().ToListAsync(ct);
        foreach (var userId in userIds)
        {
            var seriesIds = (await ChapterBanking.BankedAsync(db, userId, null, pages, ct)).Keys.ToList();
            if (seriesIds.Count == 0)
            {
                continue;
            }

            var last = await db.ChapterProgress.IgnoreQueryFilters()
                .Where(p => p.UserId == userId && p.Completed && p.CompletedAt != null && seriesIds.Contains(p.SeriesId))
                .GroupBy(p => p.SeriesId)
                .Select(g => g.OrderByDescending(p => p.CompletedAt).Select(p => p.ChapterId).First())
                .ToListAsync(ct);
            kept.AddRange(last);
        }

        return kept;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        var days = await DaysAsync(settings, context.CancellationToken);
        if (days > 0)
        {
            await RunAsync(days, context.CancellationToken);
        }
    }

    internal async Task<int> RunAsync(int days, CancellationToken ct)
    {
        var cutoff = time.GetUtcNow().UtcDateTime.AddDays(-days);

        var kept = await KeepLastAsync(settings, ct)
            ? (await LastReadChapterIdsAsync(db, ct)).ToList()
            : [];

        // While new chapters are banked for a reader, the chapter they finished last stays: it is the
        // only thing they can re-read or open the series from until the new ones come out.
        kept.AddRange(await BankedLastReadIdsAsync(ct));

        var readChapterIds = db.ChapterProgress
            .Where(p => p.Completed && p.CompletedAt != null && p.CompletedAt <= cutoff && !kept.Contains(p.ChapterId))
            .Select(p => p.ChapterId);

        var fileIds = await db.Chapters
            .Where(c => c.ChapterFileId != null && readChapterIds.Contains(c.Id))
            .Select(c => c.ChapterFileId!.Value)
            .Distinct()
            .ToListAsync(ct);
        if (fileIds.Count == 0)
        {
            return 0;
        }

        var readIds = (await readChapterIds.Distinct().ToListAsync(ct)).ToHashSet();
        var chaptersByFile = (await db.Chapters
                .Where(c => c.ChapterFileId != null && fileIds.Contains(c.ChapterFileId.Value))
                .ToListAsync(ct))
            .ToLookup(c => c.ChapterFileId!.Value);

        var files = await db.ChapterFiles.Where(f => fileIds.Contains(f.Id))
            .Where(f => db.Series.Any(s => s.Id == f.SeriesId && s.RootFolderId != null))
            .ToListAsync(ct);

        // A volume goes only once every chapter on it qualifies.
        var qualifying = files
            .Where(f => chaptersByFile[f.Id].Any() && chaptersByFile[f.Id].All(c => readIds.Contains(c.Id)))
            .GroupBy(f => f.SeriesId);

        var deleted = 0;
        foreach (var group in qualifying)
        {
            if (ct.IsCancellationRequested)
            {
                break;
            }

            // Under the same lock a rescan or delete holds, and not while a worker is packaging into the series.
            using var seriesLock = await SeriesLocks.SeriesAsync(group.Key, ct);
            if (await SeriesLocks.InFlight(db.DownloadQueue).AnyAsync(q => q.SeriesId == group.Key, ct))
            {
                continue;
            }

            var series = await db.Series.Include(s => s.RootFolder).FirstAsync(s => s.Id == group.Key, ct);
            var result = await deletion.DeleteAsync(series, group.ToList(), CancellationToken.None);
            deleted += result.Deleted;
        }

        if (deleted > 0)
        {
            logger.LogInformation("Auto-delete removed {Count} file(s) read more than {Days} day(s) ago", deleted, days);
        }

        return deleted;
    }
}
