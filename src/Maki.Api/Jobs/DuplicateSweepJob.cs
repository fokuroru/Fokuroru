using Maki.Api.Services;
using Maki.Core.Configuration;
using Maki.Data;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace Maki.Api.Jobs;

/// <summary>
/// Moves files that only repeat what other files in the same series hold into the library's trash
/// (see <see cref="DuplicateFileService"/>). Series an import just touched go first; otherwise the job walks
/// the library a couple of series per run. Off with <see cref="SettingKeys.LibraryDedupe"/> = "false".
/// </summary>
[DisallowConcurrentExecution]
public class DuplicateSweepJob(
    IServiceScopeFactory scopeFactory, DuplicateSweep sweep, ILogger<DuplicateSweepJob> logger) : IJob
{
    private const int RequestedPerRun = 3;
    private const int WalkedPerRun = 2;

    public static async Task<bool> EnabledAsync(IAppSettings settings, CancellationToken ct) =>
        await settings.GetAsync(SettingKeys.LibraryDedupe, ct) != "false";

    public async Task Execute(IJobExecutionContext context)
    {
        var ct = context.CancellationToken;
        List<int> ids;
        using (var scope = scopeFactory.CreateScope())
        {
            if (!await EnabledAsync(scope.ServiceProvider.GetRequiredService<IAppSettings>(), ct))
            {
                return;
            }

            ids = sweep.Take(RequestedPerRun);
            if (ids.Count == 0)
            {
                var db = scope.ServiceProvider.GetRequiredService<MakiDbContext>();
                ids = await db.ChapterFiles.IgnoreQueryFilters()
                    .Where(f => f.SeriesId > sweep.Cursor)
                    .GroupBy(f => f.SeriesId)
                    .Where(g => g.Count() >= 2)
                    .Select(g => g.Key)
                    .OrderBy(id => id)
                    .Take(WalkedPerRun)
                    .ToListAsync(ct);
                sweep.Cursor = ids.Count == 0 ? 0 : ids[^1];
            }
        }

        foreach (var id in ids)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var report = await scope.ServiceProvider.GetRequiredService<DuplicateFileService>().RunAsync(id, apply: true, ct);
                if (report.Applied)
                {
                    logger.LogInformation("Series {SeriesId}: moved {Count} duplicate file(s) to the trash, freeing {Mb} MB",
                        id, report.Removals.Count, report.FreedBytes / 1_000_000);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Duplicate check failed for series {SeriesId}", id);
            }
        }
    }
}
