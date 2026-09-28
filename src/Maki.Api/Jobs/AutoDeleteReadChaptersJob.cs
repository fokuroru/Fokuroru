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
/// another row in the same root also points at (a manual link) is left alone.
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

        var readChapterIds = db.ChapterProgress
            .Where(p => p.Completed && p.CompletedAt != null && p.CompletedAt <= cutoff)
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

        var rootIds = files.Where(f => f.Root != null).Select(f => f.Root!.Id).Distinct().ToList();
        var pathClaims = (await (from f in db.ChapterFiles
                                 join s in db.Series on f.SeriesId equals s.Id
                                 where rootIds.Contains(s.RootFolderId)
                                 select new { f.Id, RootId = s.RootFolderId, f.RelativePath })
                .ToListAsync(ct))
            .ToLookup(f => (f.RootId, LibraryPaths.ComparisonKey(f.RelativePath)));

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

            if (pathClaims[(root.Id, LibraryPaths.ComparisonKey(file.RelativePath))].Any(f => f.Id != file.Id))
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
