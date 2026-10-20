using Maki.Api.Controllers;
using Maki.Api.Services;
using Maki.Core.Entities;
using Microsoft.AspNetCore.Mvc;

namespace Maki.Api.Tests;

public class SeriesProgressControllerTests : IDisposable
{
    private readonly TestDb _db = new();

    public void Dispose() => _db.Dispose();

    private SeriesProgressController Controller() => new(_db.NewContext(), new FakeAppSettings(), new TestLocalizer());

    private (int Series, int File) Seed(int chaptersOnFile)
    {
        using var db = _db.NewContext();
        var root = new RootFolder { Path = Path.Combine(Path.GetTempPath(), "maki-progress-" + Guid.NewGuid().ToString("N")[..8]) };
        db.RootFolders.Add(root);
        db.SaveChanges();
        var series = new Series { Title = "S", SortTitle = "S", FolderName = "S", RootFolderId = root.Id };
        db.Series.Add(series);
        db.SaveChanges();
        var file = new ChapterFile { SeriesId = series.Id, RelativePath = "S/Spare file.cbz", Size = 10, PageCount = 7, DateAdded = DateTime.UtcNow };
        db.ChapterFiles.Add(file);
        db.SaveChanges();
        for (var i = 0; i < chaptersOnFile; i++)
        {
            db.Chapters.Add(new Chapter { SeriesId = series.Id, Number = i + 1, Volume = 1, ChapterFileId = file.Id });
        }

        db.SaveChanges();
        return (series.Id, file.Id);
    }

    [Fact]
    public async Task Placing_a_file_with_no_row_gives_it_one_in_the_chosen_spot_and_it_stops_being_unplaced()
    {
        var (series, file) = Seed(chaptersOnFile: 0);

        Assert.IsType<NoContentResult>(await Controller().Place(series, new PlaceBonusRequest(null, file, 2, 9m), default));

        using var db = _db.NewContext();
        var chapter = db.Chapters.Single();
        Assert.Equal((2, 9m, file), (chapter.PlacedVolume, chapter.PlacedAfter, chapter.ChapterFileId));
        Assert.Equal("Spare file", chapter.Title);
        var progress = (SeriesProgress)((OkObjectResult)await Controller().Get(series, default)).Value!;
        Assert.Empty(progress.Unplaced);
        Assert.Equal("user", progress.Volumes.Single(v => v.Volume == 2).Rows.Single().Why);
    }

    [Fact]
    public async Task Placing_again_moves_it_and_clearing_sends_it_back_to_the_unplaced_list()
    {
        var (series, file) = Seed(chaptersOnFile: 0);
        await Controller().Place(series, new PlaceBonusRequest(null, file, 1, 3m), default);
        var chapterId = _db.NewContext().Chapters.Single().Id;

        await Controller().Place(series, new PlaceBonusRequest(chapterId, null, 1, -1m), default);
        Assert.Equal(-1m, _db.NewContext().Chapters.Single().PlacedAfter);

        Assert.IsType<NoContentResult>(await Controller().Clear(series, chapterId, default));
        var progress = (SeriesProgress)((OkObjectResult)await Controller().Get(series, default)).Value!;
        Assert.Contains(progress.Unplaced, u => u.ChapterId == chapterId);
    }

    [Fact]
    public async Task A_file_that_backs_several_chapters_is_not_placed_as_one_entry()
    {
        var (series, file) = Seed(chaptersOnFile: 3);

        var result = await Controller().Place(series, new PlaceBonusRequest(null, file, 1, null), default);

        Assert.IsNotType<NoContentResult>(result);
        Assert.All(_db.NewContext().Chapters.ToList(), c => Assert.Null(c.PlacedVolume));
    }

    [Fact]
    public async Task Bad_requests_and_other_series_rows_are_refused()
    {
        var (series, _) = Seed(chaptersOnFile: 1);
        var (other, _) = Seed(chaptersOnFile: 1);
        var foreign = _db.NewContext().Chapters.First(c => c.SeriesId == other).Id;

        Assert.IsType<BadRequestResult>(await Controller().Place(series, new PlaceBonusRequest(null, 1, -5, null), default));
        Assert.IsType<NotFoundResult>(await Controller().Place(series, new PlaceBonusRequest(foreign, null, 1, null), default));
        Assert.IsType<NotFoundResult>(await Controller().Clear(series, foreign, default));
    }

    [Fact]
    public async Task The_disk_summary_counts_files_not_chapters()
    {
        var (series, _) = Seed(chaptersOnFile: 3);

        var progress = (SeriesProgress)((OkObjectResult)await Controller().Get(series, default)).Value!;

        Assert.Equal((1, 1, 3, 0), (progress.Disk.Files, progress.Disk.VolumeFiles, progress.Disk.VolumeChapters, progress.Disk.LooseFiles));
    }
}
