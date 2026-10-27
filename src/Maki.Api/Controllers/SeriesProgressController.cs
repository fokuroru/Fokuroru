using Maki.Api.Auth;
using Maki.Api.Localization;
using Maki.Api.Services;
using Maki.Core.Configuration;
using Maki.Core.Entities;
using Maki.Core.Images;
using Maki.Core.Paths;
using Maki.Core.Reading;
using Maki.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Controllers;

/// <param name="ChapterId">The chapter row to place, or null to place a file.</param>
/// <param name="FileId">The file to place when it has no row of its own yet; ignored with a chapter id.</param>
/// <param name="Volume">The volume to slot it into.</param>
/// <param name="After">The whole chapter number it follows; -1 for the start of the volume and null for the end.</param>
public record PlaceBonusRequest(int? ChapterId, int? FileId, int Volume, decimal? After);

/// <summary>
/// The series page's view of progress: chapters by volume with bonus entries in place, what has nowhere to go yet,
/// and the means to put it somewhere (<see cref="SeriesProgressBuilder"/> holds the rules).
/// </summary>
[ApiController]
[Route("api/v1/series/{id:int}")]
public class SeriesProgressController(
    MakiDbContext db, IAppSettings settings, ILocalizer localizer) : ControllerBase
{
    private const int PreviewWidth = 240;

    [HttpGet("progress")]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var series = await db.Series.AsNoTracking().Include(s => s.RootFolder).FirstOrDefaultAsync(s => s.Id == id, ct);
        if (series is null)
        {
            return NotFound();
        }

        var chapters = await db.Chapters.AsNoTracking().Where(c => c.SeriesId == id).ToListAsync(ct);
        var files = await db.ChapterFiles.AsNoTracking().Where(f => f.SeriesId == id).ToListAsync(ct);
        var reads = (await db.ChapterProgress.AsNoTracking().Where(p => p.SeriesId == id).ToListAsync(ct))
            .GroupBy(p => p.ChapterId).ToDictionary(g => g.Key, g => g.OrderByDescending(p => p.UpdatedAt).First());
        var hidden = (await ChapterBanking.BankedForCallerAsync(db, settings, [id], ct)).GetValueOrDefault(id) ?? [];

        var rows = chapters.Select(c =>
        {
            reads.TryGetValue(c.Id, out var p);
            var started = p is { Completed: false, UnreadAt: null, PageIndex: > 0 };
            return new ProgChapter(
                c.Id, c.Number, c.Language, c.Volume, c.PlacedVolume, c.PlacedAfter, c.Title, c.IsOneShot, c.Wanted,
                c.ChapterFileId, c.PageCount, hidden.Contains(c.Id),
                p is { Completed: true }, started, p?.PageIndex ?? 0, p?.PageCount ?? 0, started ? p!.UpdatedAt : null);
        }).ToList();
        var progFiles = files.Select(f => new ProgFile(
            f.Id, Path.GetFileName(f.RelativePath), f.Size, f.PageCount ?? 0, f.SourceName)).ToList();

        var progress = SeriesProgressBuilder.Build(rows, progFiles);
        return Ok(progress with { Disk = await DiskAsync(series, files, chapters, ct) });
    }

    [Authorize(Policy = Policies.EditMetadata)]
    [HttpPut("placements")]
    public async Task<IActionResult> Place(int id, [FromBody] PlaceBonusRequest request, CancellationToken ct)
    {
        if (request.Volume is < 0 or > 9999 || request.After is < -1)
        {
            return BadRequest();
        }

        Chapter? chapter = null;
        if (request.ChapterId is { } chapterId)
        {
            chapter = await db.Chapters.FirstOrDefaultAsync(c => c.Id == chapterId && c.SeriesId == id, ct);
        }
        else if (request.FileId is { } fileId)
        {
            var file = await db.ChapterFiles.FirstOrDefaultAsync(f => f.Id == fileId && f.SeriesId == id, ct);
            if (file is null)
            {
                return NotFound();
            }

            var linked = await db.Chapters.Where(c => c.SeriesId == id && c.ChapterFileId == fileId).ToListAsync(ct);
            if (linked.Count > 1)
            {
                // A volume or compilation backs several chapters: it is placed through them, not as one entry.
                return this.Fail(localizer, "error.series.placeSharedFile");
            }

            chapter = linked.FirstOrDefault() ?? db.Chapters.Add(new Chapter
            {
                SeriesId = id,
                Title = Path.GetFileNameWithoutExtension(file.RelativePath),
                IsOneShot = true,
                Wanted = false,
                ChapterFileId = file.Id,
            }).Entity;
        }

        if (chapter is null)
        {
            return NotFound();
        }

        chapter.PlacedVolume = request.Volume;
        chapter.PlacedAfter = request.After is { } after ? decimal.Floor(after) : null;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [Authorize(Policy = Policies.EditMetadata)]
    [HttpDelete("placements/{chapterId:int}")]
    public async Task<IActionResult> Clear(int id, int chapterId, CancellationToken ct)
    {
        var chapter = await db.Chapters.FirstOrDefaultAsync(c => c.Id == chapterId && c.SeriesId == id, ct);
        if (chapter is null)
        {
            return NotFound();
        }

        chapter.PlacedVolume = null;
        chapter.PlacedAfter = null;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>A small JPEG of one page of a file, so an unplaced file can be looked at before it is slotted in.</summary>
    [HttpGet("files/{fileId:int}/pages/{index:int}")]
    public async Task<IActionResult> Preview(int id, int fileId, int index, CancellationToken ct)
    {
        var row = await db.ChapterFiles.AsNoTracking()
            .Where(f => f.Id == fileId && f.SeriesId == id)
            .Select(f => new { f.RelativePath, Root = db.Series.Where(s => s.Id == id).Select(s => s.RootFolder!.Path).FirstOrDefault() })
            .FirstOrDefaultAsync(ct);
        if (row?.Root is null || LibraryPaths.Resolve(row.Root, row.RelativePath) is not { } path || !System.IO.File.Exists(path))
        {
            return NotFound();
        }

        var names = CbzReader.PageNames(path);
        if (index < 0 || index >= names.Count)
        {
            return NotFound();
        }

        byte[]? bytes = null;
        await ImageWorkGate.RunAsync(async () =>
        {
            await using var source = await CbzReader.OpenPageAsync(path, names[index], ct);
            if (source is null)
            {
                return;
            }

            using var buffer = new MemoryStream();
            await source.CopyToAsync(buffer, ct);
            // Shrunk while decoding where the format allows it, and never enlarged.
            bytes = ImageCodec.JpegThumbnail(buffer.ToArray(), PreviewWidth, 70, enlarge: false);
        }, ct);

        if (bytes is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "private, max-age=3600";
        return File(bytes, "image/jpeg");
    }

    private async Task<ProgressDisk> DiskAsync(Series series, List<ChapterFile> files, List<Chapter> chapters, CancellationToken ct)
    {
        var volumeFileIds = chapters.Where(c => c.ChapterFileId != null).GroupBy(c => c.ChapterFileId!.Value)
            .Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet();
        var trashFiles = 0;
        long trashBytes = 0;
        DateTime? purgeAfter = null;
        if (series.RootFolder is { } root)
        {
            var folder = UpgradeTrash.SeriesFolder(root.Path, series.Id);
            if (Directory.Exists(folder))
            {
                var infos = new DirectoryInfo(folder).EnumerateFiles().ToList();
                trashFiles = infos.Count;
                trashBytes = infos.Sum(f => f.Length);
                if (infos.Count > 0)
                {
                    var days = (await UpgradeOptions.LoadAsync(settings, ct)).TrashRetentionDays;
                    purgeAfter = infos.Min(f => f.LastWriteTimeUtc).AddDays(days);
                }
            }
        }

        return new ProgressDisk(
            files.Count,
            files.Sum(f => f.Size),
            volumeFileIds.Count,
            chapters.Where(c => c.ChapterFileId is { } f && volumeFileIds.Contains(f) && ChapterSequence.IsMain(c.Number))
                .Select(c => c.Number).Distinct().Count(),
            files.Count - volumeFileIds.Count,
            trashFiles,
            trashBytes,
            purgeAfter);
    }
}
