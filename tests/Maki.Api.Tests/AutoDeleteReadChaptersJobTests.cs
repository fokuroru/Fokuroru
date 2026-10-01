using Maki.Api.Jobs;
using Maki.Api.Services;
using Maki.Core.Configuration;
using Maki.Core.Entities;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maki.Api.Tests;

public class AutoDeleteReadChaptersJobTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 9, 28, 12, 0, 0, TimeSpan.Zero);

    private readonly TestDb _db = new();
    private readonly string _root = Directory.CreateTempSubdirectory("maki-autodelete-").FullName;
    private readonly int _seriesId;

    public AutoDeleteReadChaptersJobTests()
    {
        _seriesId = _db.SeedSeries(title: "Berserk");
        using var db = _db.NewContext();
        db.RootFolders.Single().Path = _root;
        db.SaveChanges();
    }

    public void Dispose()
    {
        _db.Dispose();
        Directory.Delete(_root, recursive: true);
    }

    private readonly FakeAppSettings _settings = new();

    private AutoDeleteReadChaptersJob Job(Maki.Data.MakiDbContext db) => new(
        db, _settings, new ReaderArchiveCache(NullLogger<ReaderArchiveCache>.Instance),
        new StoppedClock(Now), NullLogger<AutoDeleteReadChaptersJob>.Instance);

    private int SeedFile(string name, params (decimal Number, int? DaysSinceRead)[] chapters)
    {
        var relative = Path.Combine("Berserk", name);
        Directory.CreateDirectory(Path.Combine(_root, "Berserk"));
        File.WriteAllText(Path.Combine(_root, relative), "x");

        using var db = _db.NewContext();
        var file = new ChapterFile { SeriesId = _seriesId, RelativePath = relative, DateAdded = Now.UtcDateTime };
        db.ChapterFiles.Add(file);
        db.SaveChanges();
        foreach (var (number, daysSinceRead) in chapters)
        {
            var chapter = new Chapter { SeriesId = _seriesId, Number = number, Language = "en", ChapterFileId = file.Id };
            db.Chapters.Add(chapter);
            db.SaveChanges();
            if (daysSinceRead is { } days)
            {
                db.ChapterProgress.Add(new ChapterProgress
                {
                    UserId = 1, SeriesId = _seriesId, ChapterId = chapter.Id, Completed = true,
                    CompletedAt = Now.UtcDateTime.AddDays(-days), StartedAt = Now.UtcDateTime, UpdatedAt = Now.UtcDateTime
                });
            }
        }
        db.SaveChanges();
        return file.Id;
    }

    private async Task<int> Run(int days)
    {
        using var db = _db.NewContext();
        return await Job(db).RunAsync(days, CancellationToken.None);
    }

    [Fact]
    public async Task Deletes_a_file_read_long_enough_ago_and_unwants_its_chapter()
    {
        var fileId = SeedFile("Berserk Ch.1.cbz", (1m, 10));

        Assert.Equal(1, await Run(days: 7));

        Assert.False(File.Exists(Path.Combine(_root, "Berserk", "Berserk Ch.1.cbz")));
        using var check = _db.NewContext();
        Assert.DoesNotContain(check.ChapterFiles, f => f.Id == fileId);
        var chapter = Assert.Single(check.Chapters);
        Assert.Null(chapter.ChapterFileId);
        Assert.False(chapter.Wanted);
    }

    [Fact]
    public async Task Keeps_the_most_recently_read_chapter_when_asked_to()
    {
        SeedFile("Berserk Ch.1.cbz", (1m, 30));
        SeedFile("Berserk Ch.2.cbz", (2m, 20));
        SeedFile("Berserk Ch.3.cbz", (3m, 10));
        _settings.Set(SettingKeys.LibraryAutoDeleteKeepLast, "true");

        Assert.Equal(2, await Run(days: 7));

        Assert.False(File.Exists(Path.Combine(_root, "Berserk", "Berserk Ch.1.cbz")));
        Assert.False(File.Exists(Path.Combine(_root, "Berserk", "Berserk Ch.2.cbz")));
        Assert.True(File.Exists(Path.Combine(_root, "Berserk", "Berserk Ch.3.cbz")));
    }

    [Fact]
    public async Task Keeps_files_read_recently_or_not_read()
    {
        SeedFile("Berserk Ch.1.cbz", (1m, 2));
        SeedFile("Berserk Ch.2.cbz", (2m, null));

        Assert.Equal(0, await Run(days: 7));

        Assert.True(File.Exists(Path.Combine(_root, "Berserk", "Berserk Ch.1.cbz")));
        Assert.True(File.Exists(Path.Combine(_root, "Berserk", "Berserk Ch.2.cbz")));
        using var check = _db.NewContext();
        Assert.All(check.Chapters, c => Assert.True(c.Wanted));
    }

    [Fact]
    public async Task Keeps_a_volume_until_every_chapter_in_it_qualifies()
    {
        SeedFile("Berserk v01.cbz", (1m, 30), (2m, 30), (3m, null));

        Assert.Equal(0, await Run(days: 7));
        Assert.True(File.Exists(Path.Combine(_root, "Berserk", "Berserk v01.cbz")));
    }

    /// <summary>
    /// Root B sits inside root A, so B's <c>ch1.cbz</c> and A's <c>Berserk/ch1.cbz</c> are one file.
    /// The old same-root check could not see B's claim and deleted the file out from under an
    /// unread chapter. Root B is spelled with a trailing separator and a "." segment on purpose.
    /// </summary>
    [Fact]
    public async Task Keeps_a_file_another_root_folder_also_points_at()
    {
        var fileA = SeedFile("ch1.cbz", (1m, 30));
        var otherSeries = _db.SeedSeries(title: "Berserk (nested root)");
        int chapterB;
        using (var db = _db.NewContext())
        {
            var series = db.Series.Single(s => s.Id == otherSeries);
            db.RootFolders.Single(r => r.Id == series.RootFolderId).Path =
                Path.Combine(_root, ".", "Berserk") + Path.DirectorySeparatorChar;
            var file = new ChapterFile { SeriesId = otherSeries, RelativePath = "ch1.cbz", DateAdded = Now.UtcDateTime };
            db.ChapterFiles.Add(file);
            db.SaveChanges();
            var chapter = new Chapter { SeriesId = otherSeries, Number = 1m, Language = "en", ChapterFileId = file.Id };
            db.Chapters.Add(chapter);
            db.SaveChanges();
            chapterB = chapter.Id;
        }

        Assert.Equal(0, await Run(days: 7));

        Assert.True(File.Exists(Path.Combine(_root, "Berserk", "ch1.cbz")));
        using var check = _db.NewContext();
        Assert.Contains(check.ChapterFiles, f => f.Id == fileA);
        Assert.NotNull(check.Chapters.Single(c => c.Id == chapterB).ChapterFileId);
        Assert.All(check.Chapters, c => Assert.NotNull(c.ChapterFileId));
    }

    [Fact]
    public async Task Keeps_a_file_a_second_row_in_the_same_root_points_at()
    {
        SeedFile("ch1.cbz", (1m, 30));
        using (var db = _db.NewContext())
        {
            var file = new ChapterFile
            {
                SeriesId = _seriesId, RelativePath = Path.Combine("Berserk", "CH1.cbz"), DateAdded = Now.UtcDateTime,
            };
            db.ChapterFiles.Add(file);
            db.SaveChanges();
            db.Chapters.Add(new Chapter { SeriesId = _seriesId, Number = 1m, Language = "es", ChapterFileId = file.Id });
            db.SaveChanges();
        }

        Assert.Equal(0, await Run(days: 7));
        Assert.True(File.Exists(Path.Combine(_root, "Berserk", "ch1.cbz")));
    }

    [Fact]
    public async Task Days_setting_reads_zero_as_off_and_rejects_nonsense()
    {
        Assert.Equal(0, await AutoDeleteReadChaptersJob.DaysAsync(new FakeAppSettings(), CancellationToken.None));
        Assert.Equal(0, await AutoDeleteReadChaptersJob.DaysAsync(
            new FakeAppSettings().Set(SettingKeys.LibraryAutoDeleteReadDays, "-3"), CancellationToken.None));
        Assert.Equal(14, await AutoDeleteReadChaptersJob.DaysAsync(
            new FakeAppSettings().Set(SettingKeys.LibraryAutoDeleteReadDays, "14"), CancellationToken.None));
    }
}

public class ChapterProgressCompletedAtTests : IDisposable
{
    private readonly TestDb _db = new();

    public void Dispose() => _db.Dispose();

    [Fact]
    public void Completing_stamps_the_time_and_unreading_clears_it()
    {
        var seriesId = _db.SeedSeries();
        using var db = _db.NewContext();
        var chapter = new Chapter { SeriesId = seriesId, Number = 1m, Language = "en" };
        db.Chapters.Add(chapter);
        db.SaveChanges();

        var row = new ChapterProgress { UserId = 1, SeriesId = seriesId, ChapterId = chapter.Id };
        db.ChapterProgress.Add(row);
        db.SaveChanges();
        Assert.Null(row.CompletedAt);

        row.Completed = true;
        db.SaveChanges();
        var first = Assert.NotNull(row.CompletedAt);

        row.PageIndex = 3;
        db.SaveChanges();
        Assert.Equal(first, row.CompletedAt);

        row.Completed = false;
        db.SaveChanges();
        Assert.Null(row.CompletedAt);
    }
}
