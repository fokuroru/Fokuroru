using Maki.Api.Services;
using Maki.Core.Configuration;
using Maki.Core.Paths;
using Maki.Data;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace Maki.Api.Jobs;

/// <summary>
/// Deletes the files of chapters read more than <see cref="SettingKeys.LibraryAutoDeleteReadDays"/>
/// days ago. The chapter row stays (so read history and counts survive) and is unwanted, because a
/// wanted chapter with no file is exactly what Smart Download and "Download N wanted" go looking for.
/// <para>
/// A file backing several chapters (a volume) goes only once every one of them qualifies, and a file
/// any other row points at, in this root or through an overlapping one, is left alone
/// (<see cref="FileClaims"/>).
/// </para>
/// </summary>
[DisallowConcurrentExecution]
public class AutoDeleteReadChaptersJob(
    MakiDbContext db,
    IAppSettings settings,
    ReaderArchiveCache archives,
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

        var files = await (from f in db.ChapterFiles
                           join s in db.Series on f.SeriesId equals s.Id
                           where fileIds.Contains(f.Id)
                           select new { File = f, Root = s.RootFolder })
            .ToListAsync(ct);

        var claims = await FileClaims.LoadAsync(db, ct);

        var deleted = 0;
        foreach (var (file, root) in files.Select(f => (f.File, f.Root)))
        {
            if (ct.IsCancellationRequested)
            {
                break;
            }

            var chapters = chaptersByFile[file.Id].ToList();
            if (root is null || chapters.Count == 0 || chapters.Any(c => !readIds.Contains(c.Id)))
            {
                continue;
            }

            if (claims.ClaimedByOthers(root.Path, file.RelativePath, new HashSet<int> { file.Id }))
            {
                continue;
            }

            var absPath = LibraryPaths.ResolveForDelete(root.Path, file.RelativePath);
            if (absPath is null)
            {
                logger.LogWarning("Auto-delete refused {File}: resolves outside {Root} or through a linked folder",
                    file.RelativePath, root.Path);
                continue;
            }

            try
            {
                File.Delete(absPath);
            }
            catch (DirectoryNotFoundException)
            {
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                logger.LogWarning(ex, "Auto-delete could not remove {File}, keeping it", file.RelativePath);
                continue;
            }

            foreach (var chapter in chapters)
            {
                chapter.ChapterFileId = null;
                chapter.Wanted = false;
            }

            archives.Invalidate(file.Id);
            db.ChapterFiles.Remove(file);
            deleted++;
        }

        await db.SaveChangesAsync(CancellationToken.None);
        if (deleted > 0)
        {
            logger.LogInformation("Auto-delete removed {Count} file(s) read more than {Days} day(s) ago", deleted, days);
        }

        return deleted;
    }
}
