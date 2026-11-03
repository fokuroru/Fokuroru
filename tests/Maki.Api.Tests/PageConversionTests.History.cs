using System.IO.Compression;
using Maki.Api.Controllers;
using Maki.Api.Jobs;
using Maki.Api.Services;
using Maki.Core.Configuration;
using Maki.Core.Entities;
using Maki.Core.Images;
using Maki.Core.Kavita;
using Maki.Core.Quality;
using Maki.Core.Storage;
using Maki.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maki.Api.Tests;

public sealed partial class PageConversionTests
{
    private static readonly PageConversionSettings High = new(PageConversionFormat.Webp, PageConversionStop.High, false);

    /// <summary>A measured JPEG chapter of <paramref name="pages"/> pages, so the middle third holds three.</summary>
    private (int ChapterId, int FileId, string Path) JpegFile(decimal number, int pages, Action<ChapterFile>? file = null,
        int seed = 0)
    {
        var (chapterId, fileId) = _world.Chapter(number, f =>
        {
            f.ImageFormat = "jpg";
            file?.Invoke(f);
        });
        using var db = _world.Db.NewContext();
        var row = db.ChapterFiles.Single(f => f.Id == fileId);
        var path = Path.Combine(_world.Library, row.RelativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using (var zip = ZipFile.Open(path, ZipArchiveMode.Create))
        {
            for (var i = 0; i < pages; i++)
            {
                using var stream = zip.CreateEntry($"{i + 1:000}.jpg", CompressionLevel.NoCompression).Open();
                stream.Write(ScanJpeg(500, 750, seed * 100 + i));
            }
        }

        row.Size = new FileInfo(path).Length;
        row.PageCount = pages;
        row.MedianWidth = 500;
        row.MedianHeight = 750;
        db.SaveChanges();
        return (chapterId, fileId!.Value, path);
    }

    private async Task ConvertAsync(int fileId, string? passId)
    {
        using var db = _world.Db.NewContext();
        var result = await Service(db).ConvertAsync(fileId, PageConversionPlan.For(Webp), new PageConversionPassCache { PassId = passId },
            CancellationToken.None);
        Assert.Equal(FileConversionStatus.Converted, result.Status);
    }

    private PageConversionHistory History(int fileId)
    {
        using var db = _world.Db.NewContext();
        return db.PageConversionHistory.AsNoTracking().Where(h => h.ChapterFileId == fileId).OrderBy(h => h.Id).Last();
    }

    [Fact]
    public async Task A_converted_file_records_its_original_in_a_history_row()
    {
        var (chapterId, fileId, path) = JpegChapter(1);
        var before = Row(fileId).Size;

        await ConvertAsync(fileId, "2026-10-26T10:00:00.0000000Z");

        var row = History(fileId);
        var after = Row(fileId);
        Assert.Equal((_world.SeriesId, (int?)chapterId, "2026-10-26T10:00:00.0000000Z"), (row.SeriesId, row.ChapterId, row.PassId));
        Assert.Equal(Path.GetFullPath(Assert.Single(TrashedOriginals())), Path.GetFullPath(Path.Combine(_world.Library, row.TrashPath!)));
        Assert.StartsWith($".maki-trash/{_world.SeriesId}/conv-{fileId}-", row.TrashPath);
        Assert.Equal((before, before, before), (row.TrashBytes!.Value, row.BytesBefore, new FileInfo(Path.Combine(_world.Library, row.TrashPath!)).Length));
        Assert.Equal((after.Size, new FileInfo(path).Length), (row.BytesAfter, row.BytesAfter));
        Assert.Equal((Webp.Name(), "jpg", "webp"), (row.Action, row.SourceFormat, row.ResultFormat));
        Assert.Null(row.UndoneAtUtc);

        using var db = _world.Db.NewContext();
        var library = Saved(await Controller(db).Status(CancellationToken.None)).Library;
        Assert.Equal((1, before), (library.TrashFiles, library.TrashBytes));
    }

    [Fact]
    public async Task The_trash_purge_ages_conversion_rows_and_keeps_originals_a_row_still_names()
    {
        var (_, oldId, _) = JpegChapter(1);
        var (_, freshId, _) = JpegChapter(2);
        await ConvertAsync(oldId, null);
        await ConvertAsync(freshId, null);
        var oldTrash = Path.Combine(_world.Library, History(oldId).TrashPath!);
        var freshTrash = Path.Combine(_world.Library, History(freshId).TrashPath!);
        var stray = Path.Combine(UpgradeTrash.SeriesFolder(_world.Library, _world.SeriesId), "conv-999-stray.cbz");
        File.WriteAllBytes(stray, [1, 2, 3]);
        foreach (var file in new[] { oldTrash, freshTrash, stray })
        {
            File.SetLastWriteTimeUtc(file, DateTime.UtcNow.AddDays(-40));
        }

        using (var db = _world.Db.NewContext())
        {
            db.PageConversionHistory.Single(h => h.ChapterFileId == oldId).CreatedAtUtc = DateTime.UtcNow.AddDays(-40);
            db.SaveChanges();
        }

        using (var db = _world.Db.NewContext())
        {
            await new UpgradeTrashService(db, _world.Settings, NullLogger<UpgradeTrashService>.Instance).PurgeAsync(CancellationToken.None);
        }

        var aged = History(oldId);
        Assert.Equal((null, null), (aged.TrashPath, aged.TrashBytes));
        Assert.False(File.Exists(oldTrash));
        Assert.NotNull(History(freshId).TrashPath);
        Assert.True(File.Exists(freshTrash));
        Assert.False(File.Exists(stray));
    }

    private int OtherSeries(string title, Action<Series>? series = null, long size = 4000, string format = "jpg")
    {
        using var db = _world.Db.NewContext();
        var row = new Series
        {
            Title = title, SortTitle = title.ToLowerInvariant(), FolderName = title,
            RootFolderId = db.Series.Single(s => s.Id == _world.SeriesId).RootFolderId
        };
        series?.Invoke(row);
        db.Series.Add(row);
        db.SaveChanges();
        db.ChapterFiles.Add(new ChapterFile
        {
            SeriesId = row.Id, RelativePath = $"{title}/{title} 001.cbz", SourceName = "agg", Size = size, ImageFormat = format
        });
        db.SaveChanges();
        return row.Id;
    }

    private (PageConversionUndoService Undo, KavitaScanService Kavita, PageConversionWorker Worker) Undo(MakiDbContext db,
        Func<string, string, bool>? move = null)
    {
        var kavita = new KavitaScanService(new KavitaClient(new StubHttpClientFactory("{}")), _world.Settings,
            _world.Db.ScopeFactory(), NullLogger<KavitaScanService>.Instance);
        var worker = new PageConversionWorker(_world.Db.ScopeFactory(), new SettingsService(_world.Db.ScopeFactory()),
            NullLogger<PageConversionWorker>.Instance);
        return (new PageConversionUndoService(db, _world.Archives, kavita, worker, new PageConversionPlanService(db),
            new TestLocalizer(), NullLogger<PageConversionUndoService>.Instance) { MoveFile = move }, kavita, worker);
    }

    [Fact]
    public async Task Undo_passes_over_a_changed_file_a_missing_original_and_a_series_with_a_download_in_flight()
    {
        var (_, changed, changedPath) = JpegChapter(1);
        var (_, gone, _) = JpegChapter(2);
        var (_, kept, keptPath) = JpegChapter(3);
        foreach (var id in new[] { changed, gone, kept })
        {
            await ConvertAsync(id, null);
        }

        await File.AppendAllTextAsync(changedPath, "more");
        File.Delete(Path.Combine(_world.Library, History(gone).TrashPath!));
        var keptConverted = File.ReadAllBytes(keptPath);

        using (var db = _world.Db.NewContext())
        {
            db.DownloadQueue.Add(new DownloadQueueItem { SeriesId = _world.SeriesId, Status = QueueStatus.Packaging, QueuedAt = DateTime.UtcNow });
            db.SaveChanges();
            var blocked = await Undo(db).Undo.UndoAsync(_world.SeriesId, false, false, CancellationToken.None);
            Assert.Equal((0, 3), (blocked!.Restored, blocked.Skipped));
            Assert.Equal(["pageConversion.undo.downloadInFlight"], blocked.Reasons);
            Assert.Equal(keptConverted, File.ReadAllBytes(keptPath));
            db.DownloadQueue.RemoveRange(db.DownloadQueue.IgnoreQueryFilters());
            db.SaveChanges();
        }

        using (var db = _world.Db.NewContext())
        {
            var result = await Undo(db).Undo.UndoAsync(_world.SeriesId, false, false, CancellationToken.None);
            Assert.Equal((1, 2), (result!.Restored, result.Skipped));
            Assert.Contains(result.Reasons, r => r.StartsWith("pageConversion.undo.fileChanged") && r.Contains("Series 001.cbz"));
            Assert.Contains(result.Reasons, r => r.StartsWith("pageConversion.undo.trashGone") && r.Contains("Series 002.cbz"));
        }

        Assert.Equal(PlanAction.UndoneName, Row(kept).CheckedWith);
        Assert.Equal("webp", Row(changed).ImageFormat);
        Assert.NotNull(History(changed).TrashPath);
        Assert.Null(History(changed).UndoneAtUtc);
    }

    [Fact]
    public async Task Undo_moves_the_converted_copy_back_when_the_original_cannot_come_back()
    {
        var (_, fileId, path) = JpegChapter(1);
        await ConvertAsync(fileId, null);
        var converted = File.ReadAllBytes(path);
        var trash = Path.GetFullPath(Path.Combine(_world.Library, History(fileId).TrashPath!));

        using var db = _world.Db.NewContext();
        var (undo, _, _) = Undo(db, (from, to) =>
        {
            if (Path.GetFullPath(from) == trash)
            {
                return false;
            }

            File.Move(from, to);
            return true;
        });
        var result = await undo.UndoAsync(_world.SeriesId, false, false, CancellationToken.None);

        Assert.Equal((0, 1), (result!.Restored, result.Skipped));
        Assert.StartsWith("pageConversion.undo.moveFailed", Assert.Single(result.Reasons));
        Assert.Equal(converted, File.ReadAllBytes(path));
        Assert.True(File.Exists(trash));
        Assert.DoesNotContain(TmpFiles(), f => Path.GetFileName(f).StartsWith(PageConversionUndoService.AsidePrefix));
        Assert.Equal("webp", Row(fileId).ImageFormat);
        Assert.Null(History(fileId).UndoneAtUtc);
    }

    [Fact]
    public async Task Undo_can_set_the_series_to_never()
    {
        var (_, fileId, _) = JpegChapter(1);
        await ConvertAsync(fileId, null);

        using var db = _world.Db.NewContext();
        var result = await Undo(db).Undo.UndoAsync(_world.SeriesId, setNever: true, convertAgain: false, CancellationToken.None);

        Assert.Equal(1, result!.Restored);
        using var check = _world.Db.NewContext();
        Assert.Equal(PageConversionOverride.Never, check.Series.Single(s => s.Id == _world.SeriesId).PageConversion);
        Assert.Equal(PlanAction.UndoneName, Row(fileId).CheckedWith);
    }

    [Fact]
    public async Task Convert_again_clears_the_stamps_and_starts_a_pass()
    {
        EnableConversion();
        var (_, fileId, _) = JpegChapter(1);
        await ConvertAsync(fileId, null);

        using var db = _world.Db.NewContext();
        var (undo, _, worker) = Undo(db);
        var result = await undo.UndoAsync(_world.SeriesId, setNever: false, convertAgain: true, CancellationToken.None);

        Assert.Equal(1, result!.Restored);
        Assert.Equal(["pageConversion.undo.queued(count=1)"], result.Reasons);
        var row = Row(fileId);
        Assert.Equal((null, null, "jpg"), (row.ConversionCheckedAtUtc, row.CheckedWith, row.ImageFormat));
        Assert.Equal(PageConversionPassState.Running, await worker.StateAsync(CancellationToken.None));
        using var pending = _world.Db.NewContext();
        Assert.Contains(fileId, await PageConversionWorker.PendingQuery(pending).Select(f => f.Id).ToListAsync());
    }

    [Fact]
    public async Task Undo_refuses_convert_again_together_with_never()
    {
        using var db = _world.Db.NewContext();
        var result = await SeriesController(db).UndoPageConversion(_world.SeriesId,
            new SeriesController.PageConversionUndoRequest(SetNever: true, ConvertAgain: true), Undo(db).Undo, CancellationToken.None);

        var error = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Contains("error.pageConversion.undoConflict", System.Text.Json.JsonSerializer.Serialize(error.Value));
    }

    [Fact]
    public async Task A_recheck_leaves_an_undone_file_alone()
    {
        EnableConversion();
        var (_, fileId, _) = JpegChapter(1);
        Stamp(fileId, PlanAction.UndoneName);

        using var db = _world.Db.NewContext();
        var plans = new PageConversionPlanService(db);
        var plan = await PageConversionOptions.LoadPlanAsync(db, CancellationToken.None);
        Assert.Equal(0, await plans.RecheckAsync(plan, null, CancellationToken.None));
        Assert.Equal(0, await plans.RecheckAsync(plan, _world.SeriesId, CancellationToken.None));
        Assert.Equal(0, await plans.RecheckFileAsync(plan, fileId, CancellationToken.None));

        Assert.Equal(PlanAction.UndoneName, Row(fileId).CheckedWith);
        Assert.NotNull(Row(fileId).ConversionCheckedAtUtc);
    }

    [Fact]
    public async Task The_series_history_counts_what_an_undo_can_still_restore()
    {
        var (_, first, _) = JpegChapter(1);
        var (_, second, _) = JpegChapter(2);
        var (_, upgraded, _) = JpegChapter(4);
        await ConvertAsync(first, null);
        await ConvertAsync(second, null);
        await ConvertAsync(upgraded, null);
        // The history never looks at the disk; the undo finds the missing original when it gets there.
        File.Delete(Path.Combine(_world.Library, History(second).TrashPath!));
        _world.Chapter(3, f => (f.OriginalImageFormat, f.ImageFormat, f.ConversionSavedBytes) = ("jpg", "webp", 100));
        using (var db = _world.Db.NewContext())
        {
            // Upgraded since, and the download converted the new copy before placement, so no new history row.
            var row = db.ChapterFiles.Single(f => f.Id == upgraded);
            row.Size += 1234;
            row.ConversionSavedBytes = 50;
            db.SaveChanges();
        }

        using var dbc = _world.Db.NewContext();
        var result = await SeriesController(dbc).PageConversionHistory(_world.SeriesId, Undo(dbc).Undo, CancellationToken.None);

        var history = Assert.IsType<SeriesConversionDto>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal(4, history.ConvertedFiles);
        Assert.Equal(Row(first).ConversionSavedBytes + Row(second).ConversionSavedBytes + 150, history.SavedBytes);
        Assert.Equal((2, History(first).TrashBytes!.Value + History(second).TrashBytes!.Value),
            (history.RestorableFiles, history.RestorableBytes));
        Assert.Equal([Webp.Name()], history.CheckedWith);
        Assert.IsType<NotFoundResult>(await SeriesController(dbc).PageConversionHistory(9999, Undo(dbc).Undo, CancellationToken.None));

        var undone = await Undo(dbc).Undo.UndoAsync(_world.SeriesId, false, false, CancellationToken.None);
        Assert.Equal((1, 1), (undone!.Restored, undone.Skipped));
        Assert.Equal(2, undone.Reasons.Count);
        Assert.StartsWith("pageConversion.undo.trashGone", undone.Reasons[0]);
        Assert.Equal("pageConversion.undo.stale(count=1)", undone.Reasons[1]);
        Assert.Equal("webp", Row(upgraded).ImageFormat);
    }

    [Fact]
    public async Task Undo_sums_up_conversions_that_no_longer_apply_in_one_line()
    {
        var (_, reset, _) = JpegChapter(1);
        var (_, removed, _) = JpegChapter(2);
        var (_, reconverted, _) = JpegChapter(3);
        var (_, kept, _) = JpegChapter(4);
        foreach (var id in new[] { reset, removed, reconverted })
        {
            await ConvertAsync(id, null);
        }

        using (var db = _world.Db.NewContext())
        {
            var row = db.ChapterFiles.Single(f => f.Id == reset);
            row.ResetConversion();
            row.Size += 10;
            db.ChapterFiles.Single(f => f.Id == reconverted).Size += 10;
            db.SaveChanges();
            await db.ChapterFiles.Where(f => f.Id == removed).ExecuteDeleteAsync();
            db.DownloadQueue.Add(new DownloadQueueItem { SeriesId = _world.SeriesId, Status = QueueStatus.Downloading, QueuedAt = DateTime.UtcNow });
            db.SaveChanges();
        }

        using (var db = _world.Db.NewContext())
        {
            Assert.Equal(0, (await Undo(db).Undo.HistoryAsync(_world.SeriesId, CancellationToken.None))!.RestorableFiles);
            var nothing = await Undo(db).Undo.UndoAsync(_world.SeriesId, false, false, CancellationToken.None);
            Assert.Equal((0, 0), (nothing!.Restored, nothing.Skipped));
            Assert.Equal(["pageConversion.undo.stale(count=3)"], nothing.Reasons);
            db.DownloadQueue.RemoveRange(db.DownloadQueue.IgnoreQueryFilters());
            db.SaveChanges();
        }

        await ConvertAsync(kept, null);
        using (var db = _world.Db.NewContext())
        {
            var result = await Undo(db).Undo.UndoAsync(_world.SeriesId, false, false, CancellationToken.None);
            Assert.Equal((1, 0), (result!.Restored, result.Skipped));
            Assert.Equal(["pageConversion.undo.stale(count=3)"], result.Reasons);
        }

        Assert.Equal(PlanAction.UndoneName, Row(kept).CheckedWith);
        Assert.Null(History(reconverted).UndoneAtUtc);
    }

    [Fact]
    public async Task The_trash_size_counts_originals_conversion_left_there()
    {
        var (_, fileId, _) = JpegChapter(1);
        await ConvertAsync(fileId, null);
        var bytes = History(fileId).TrashBytes!.Value;

        using var db = _world.Db.NewContext();
        Assert.Equal((bytes, 1), await new UpgradeTrashService(db, _world.Settings, NullLogger<UpgradeTrashService>.Instance)
            .SizeAsync(CancellationToken.None));

        await Undo(db).Undo.UndoAsync(_world.SeriesId, false, false, CancellationToken.None);
        Assert.Equal((0L, 0), await UpgradeTrashService.SizeAsync(db, CancellationToken.None));
    }
}
