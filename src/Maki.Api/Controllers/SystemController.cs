using Maki.Api.Auth;
using Maki.Api.Configuration;
using Maki.Api.Jobs;
using Maki.Api.Localization;
using Maki.Api.Services;
using Maki.Core.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Quartz;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Controllers;

[ApiController]
[Route("api/v1/system")]
public class SystemController(
    AppPaths paths,
    BackupService backups,
    UpdateCheckService updateCheck,
    MemoryDiagnostics memory,
    ImageCacheRebuildService imageCache,
    ImageCacheRebuildStatus imageCacheStatus,
    ISchedulerFactory schedulerFactory,
    ICurrentUser currentUser,
    IHostApplicationLifetime lifetime,
    Maki.Api.Localization.ILocalizer localizer,
    ILogger<SystemController> logger) : ControllerBase
{
    /// <summary>
    /// Open health issues for the header indicator.
    /// </summary>
    /// <remarks>
    /// Acknowledged checks are excluded. Acknowledging is the user saying "I have seen this and it
    /// is not going to change" - a service they do not run, a drive they know is small - and if the
    /// badge kept counting it anyway the acknowledgement would mean nothing. The check itself stays
    /// in the workspace, and any change of status clears the flag so a new problem is never
    /// inherited as already-seen.
    /// </remarks>
    [Authorize(Policy = Policies.Admin)]
    [HttpGet("health")]
    public async Task<IActionResult> Health(CancellationToken ct)
    {
        var rows = await HttpContext.RequestServices.GetRequiredService<Maki.Data.MakiDbContext>().HealthChecks
            .Where(HealthTransitions.Unattended)
            .Select(i => new { i.Category, i.Status, i.MessageKey, i.ParamsJson, i.Message }).ToListAsync(ct);
        return Ok(rows.Select(i => new
        {
            type = i.Category,
            severity = i.Status,
            message = i.MessageKey is { Length: > 0 } key
                ? localizer.Get(key, HealthMonitor.HealthParams(i.ParamsJson))
                : i.Message,
        }));
    }

    [HttpGet("status")]
    public IActionResult Status()
    {
        return Ok(new
        {
            appName = "Fōkurōru",
            version = VersionInfo.Version,
            commit = VersionInfo.Commit,
            isDevBuild = VersionInfo.IsDevBuild,
            osName = Environment.OSVersion.Platform.ToString(),
            // Withheld from non-admins: it is an absolute path on the host, which tells a reader
            // account the deployment layout and nothing it has any use for.
            configDir = currentUser.Has(MakiPermission.Admin) ? paths.ConfigDir : null,
            startTime = System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime(),
            uptimeSeconds = (long)(DateTime.UtcNow - System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime()).TotalSeconds
        });
    }

    /// <summary>
    /// One-call server snapshot: uptime, process and disk figures, database reachability, scheduler
    /// state and the open health issues counted by severity. <c>status</c> is "ok", "degraded" or
    /// "down" so a monitor can alert on a single field.
    /// </summary>
    /// <remarks>
    /// Admin-only for the same reason as <see cref="Memory"/>: it describes the host, not the
    /// caller's library. Acknowledged checks are excluded, matching <see cref="Health"/>.
    /// </remarks>
    [Authorize(Policy = Policies.Admin)]
    [HttpGet("server-health")]
    public async Task<IActionResult> ServerHealth(CancellationToken ct)
    {
        var db = HttpContext.RequestServices.GetRequiredService<Maki.Data.MakiDbContext>();
        using var process = System.Diagnostics.Process.GetCurrentProcess();
        var started = process.StartTime.ToUniversalTime();

        var dbReachable = false;
        Dictionary<string, int> issues = [];
        try
        {
            dbReachable = await db.Database.CanConnectAsync(ct);
            if (dbReachable)
                issues = await db.HealthChecks.Where(HealthTransitions.Unattended)
                    .GroupBy(i => i.Status).Select(g => new { g.Key, Count = g.Count() })
                    .ToDictionaryAsync(g => g.Key ?? "unknown", g => g.Count, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Server health could not query the database");
        }

        bool? schedulerRunning = null;
        try
        {
            var scheduler = await schedulerFactory.GetScheduler(ct);
            schedulerRunning = scheduler.IsStarted && !scheduler.InStandbyMode && !scheduler.IsShutdown;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Server health could not read the scheduler");
        }

        object? disk = null;
        try
        {
            var drive = new DriveInfo(Path.GetFullPath(paths.ConfigDir));
            disk = new { freeBytes = drive.AvailableFreeSpace, totalBytes = drive.TotalSize };
        }
        catch (Exception ex) when (ex is IOException or ArgumentException or UnauthorizedAccessException)
        {
            logger.LogDebug(ex, "Server health could not read disk space");
        }

        var problemCount = issues.Where(kv => !string.Equals(kv.Key, "ok", StringComparison.OrdinalIgnoreCase)).Sum(kv => kv.Value);
        var status = !dbReachable || schedulerRunning == false ? "down" : problemCount > 0 ? "degraded" : "ok";

        return Ok(new
        {
            status,
            version = VersionInfo.Version,
            startTime = started,
            uptimeSeconds = (long)(DateTime.UtcNow - started).TotalSeconds,
            database = new { reachable = dbReachable },
            scheduler = new { running = schedulerRunning },
            process = new
            {
                workingSetBytes = process.WorkingSet64,
                managedBytes = GC.GetTotalMemory(false),
                threads = process.Threads.Count,
                cpuSeconds = process.TotalProcessorTime.TotalSeconds,
            },
            disk,
            issues = new { total = problemCount, bySeverity = issues },
        });
    }

    [HttpGet("update")]
    public IActionResult UpdateStatus() => Ok(updateCheck.GetStatus());

    /// <summary>
    /// Where the process's memory is, split into managed heap, native, and the kernel's own
    /// accounting, plus which discovery artifacts are currently loaded.
    /// </summary>
    /// <remarks>
    /// Admin-only: it describes the host rather than the caller's library, and the cgroup limit
    /// tells a reader account how the deployment is provisioned.
    /// <para>
    /// <c>collect=true</c> forces a blocking compacting collection first and reports the managed
    /// total from both before and after it, which is the only way to tell a genuinely retained
    /// hundred megabytes from a hundred megabytes of garbage nothing has needed to reclaim yet.
    /// It stalls every request for the length of the collection, so it is opt-in.
    /// </para>
    /// </remarks>
    [Authorize(Policy = Policies.Admin)]
    [HttpGet("memory")]
    public IActionResult Memory([FromQuery] bool collect = false) => Ok(memory.Snapshot(collect));

    /// <summary>
    /// Live rebuild status plus what the image caches occupy on disk. Admin-only: the byte counts
    /// and the missing-poster tally describe the instance, not the caller's library.
    /// </summary>
    [Authorize(Policy = Policies.Admin)]
    [HttpGet("image-cache")]
    public async Task<IActionResult> ImageCache(CancellationToken ct) =>
        Ok(new { status = imageCacheStatus.Snapshot(), usage = await imageCache.UsageAsync(ct) });

    public record RebuildImageCacheRequest(bool Force);

    /// <summary>
    /// Clears the reader thumbnail and source-preview caches, drops poster folders for series that
    /// no longer exist, and re-downloads posters: every one when <c>force</c> is set, otherwise only
    /// the ones that are missing or do not decode.
    /// <para>
    /// Fires the Quartz job and returns immediately — a full forced pass is one provider lookup and
    /// one image download per series, which is minutes on a large library. Poll
    /// <c>GET system/image-cache</c> for progress.
    /// </para>
    /// </summary>
    [Authorize(Policy = Policies.Admin)]
    [HttpPost("image-cache/rebuild")]
    public async Task<IActionResult> RebuildImageCache(
        [FromBody] RebuildImageCacheRequest request, CancellationToken ct)
    {
        if (imageCacheStatus.Running)
        {
            return Ok(new { started = false, message = "A rebuild is already running" });
        }

        var scheduler = await schedulerFactory.GetScheduler(ct);
        var data = new JobDataMap { { ImageCacheRebuildJob.ForceKey, request.Force } };
        await scheduler.TriggerJob(ImageCacheRebuildJob.Key, data, ct);
        return Ok(new { started = true });
    }

    [Authorize(Policy = Policies.Admin)]
    [HttpGet("backups")]
    public IActionResult ListBackups() => Ok(backups.List());

    [Authorize(Policy = Policies.Admin)]
    [HttpPost("backups")]
    public async Task<IActionResult> CreateBackup(CancellationToken ct)
    {
        try
        {
            return Ok(await backups.CreateAsync("manual", ct));
        }
        catch (BackupCreateException ex)
        {
            return this.Fail(localizer, ex.Key);
        }
    }

    [Authorize(Policy = Policies.Admin)]
    [HttpGet("backups/{name}")]
    public IActionResult DownloadBackup(string name)
    {
        try
        {
            return PhysicalFile(backups.PathFor(name), "application/zip", name);
        }
        catch (Exception ex) when (ex is ArgumentException or FileNotFoundException)
        {
            return NotFound(new { message = ex.Message });
        }
    }

    [Authorize(Policy = Policies.Admin)]
    [HttpDelete("backups/{name}")]
    public IActionResult DeleteBackup(string name)
    {
        try
        {
            backups.Delete(name);
            return NoContent();
        }
        catch (Exception ex) when (ex is ArgumentException or FileNotFoundException)
        {
            return NotFound(new { message = ex.Message });
        }
    }

    [Authorize(Policy = Policies.Admin)]
    [HttpPost("backups/{name}/restore")]
    public async Task<IActionResult> RestoreBackup(string name, CancellationToken ct)
    {
        try
        {
            await backups.StagePendingRestoreFromFileAsync(name, ct);
        }
        catch (BackupRestoreException ex)
        {
            return this.Fail(localizer, ex.Key, ex.Args);
        }
        catch (Exception ex) when (ex is ArgumentException or FileNotFoundException or InvalidOperationException)
        {
            return BadRequest(new { message = ex.Message });
        }

        ScheduleRestart();
        return Accepted(new { message = "Restore staged. Restarting to apply." });
    }

    [Authorize(Policy = Policies.Admin)]
    [HttpPost("backups/restore-upload")]
    [RequestSizeLimit(1_073_741_824)] // 1 GiB
    public async Task<IActionResult> RestoreUpload(IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return this.Fail(localizer, "error.system.noFileUploaded");

        try
        {
            await using var stream = file.OpenReadStream();
            await backups.StagePendingRestoreFromUploadAsync(stream, ct);
        }
        catch (BackupRestoreException ex)
        {
            return this.Fail(localizer, ex.Key, ex.Args);
        }
        catch (Exception ex) when (ex is InvalidOperationException or InvalidDataException)
        {
            return BadRequest(new { message = ex.Message });
        }

        ScheduleRestart();
        return Accepted(new { message = "Restore staged. Restarting to apply." });
    }

    /// <summary>Stops the app shortly after the response flushes so the staged restore is applied on
    /// the next boot. Only auto-recovers under a supervisor (Docker restart policy, systemd).</summary>
    private void ScheduleRestart()
    {
        logger.LogWarning("Restore staged — stopping application so it restarts into the restored data");
        _ = Task.Run(async () =>
        {
            await Task.Delay(TimeSpan.FromMilliseconds(500));
            lifetime.StopApplication();
        });
    }
}
