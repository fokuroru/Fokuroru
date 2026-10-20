using System.IO.Compression;
using Maki.Api.Services;
using Maki.Core.Entities;
using Maki.Core.Kavita;
using Maki.Core.Quality;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;

namespace Maki.Api.Tests;

public class DuplicateFileServiceTests : IDisposable
{
    private readonly TestDb _db = new();
    private readonly string _root = Path.Combine(Path.GetTempPath(), "maki-dupes-" + Guid.NewGuid().ToString("N")[..8]);

    public DuplicateFileServiceTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        _db.Dispose();
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    // A page whose layout depends on its seed, so different seeds are different pages.
    private static byte[] Page(int seed, bool jpeg, int width = 300, int height = 450)
    {
        using var image = new Image<Rgb24>(width, height, Color.White);
        var rng = new Random(seed);
        for (var i = 0; i < 6; i++)
        {
            var w = (int)(width * (0.1 + rng.NextDouble() * 0.3));
            var h = (int)(height * (0.1 + rng.NextDouble() * 0.3));
            var x0 = (int)(rng.NextDouble() * (width - w));
            var y0 = (int)(rng.NextDouble() * (height - h));
            var shade = (byte)rng.Next(0, 200);
            for (var y = y0; y < y0 + h; y++)
                for (var x = x0; x < x0 + w; x++)
                    image[x, y] = new Rgb24(shade, shade, shade);
        }

        using var stream = new MemoryStream();
        if (jpeg) image.Save(stream, new JpegEncoder { Quality = 75 });
        else image.Save(stream, new PngEncoder());
        return stream.ToArray();
    }

    private void Cbz(string folder, string name, IEnumerable<(string Entry, int Seed)> pages, bool jpeg)
    {
        var path = Path.Combine(_root, folder, name);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var archive = ZipFile.Open(path, ZipArchiveMode.Create);
        foreach (var (entry, seed) in pages)
        {
            using var stream = archive.CreateEntry(entry).Open();
            stream.Write(Page(seed, jpeg));
        }
    }

    private DuplicateFileService Service(Maki.Data.MakiDbContext db) => new(
        db, new ReaderArchiveCache(NullLogger<ReaderArchiveCache>.Instance),
        new KavitaScanService(new KavitaClient(new StubHttpClientFactory("{}")), new FakeAppSettings(), _db.ScopeFactory(),
            NullLogger<KavitaScanService>.Instance),
        NullLogger<DuplicateFileService>.Instance);

    [Fact]
    public async Task A_marked_volume_replaces_its_site_copy_and_a_loose_chapter_and_everything_else_stays()
    {
        const string folder = "Series (2022)";
        // Volume 1 holds chapters 1-3 of 8 pages (seeds 100-123). The site copy is the same pages as JPEG.
        var marked = Enumerable.Range(0, 24)
            .Select(i => ($"Series - c{(i / 8) + 1:000} (v01) - p{i:000}.png", 100 + i)).ToList();
        Cbz(folder, "Series Vol.1 Ch.1-3.cbz", marked, jpeg: false);
        Cbz(folder, "Series - Volume 1.cbz", Enumerable.Range(0, 24).Select(i => ($"{i + 1:000}.jpg", 100 + i)), jpeg: true);
        Cbz(folder, "Series Ch.2.cbz", Enumerable.Range(8, 8).Select(i => ($"{i + 1:000}.jpg", 100 + i)), jpeg: true);
        Cbz(folder, "Series Ch.9.cbz", Enumerable.Range(0, 8).Select(i => ($"{i + 1:000}.png", 500 + i)), jpeg: false);

        int seriesId, volume, site, loose, unique;
        List<int> chapterIds;
        using (var db = _db.NewContext())
        {
            var root = new RootFolder { Path = _root };
            db.RootFolders.Add(root);
            db.SaveChanges();
            var series = new Series { Title = "Series", SortTitle = "Series", FolderName = folder, RootFolderId = root.Id };
            db.Series.Add(series);
            db.SaveChanges();
            seriesId = series.Id;
            ChapterFile File(string name, QualityTier tier)
            {
                var info = new FileInfo(Path.Combine(_root, folder, name));
                var f = new ChapterFile
                {
                    SeriesId = seriesId, RelativePath = $"{folder}/{name}", Size = info.Length, DateAdded = DateTime.UtcNow, Tier = tier
                };
                db.ChapterFiles.Add(f);
                db.SaveChanges();
                return f;
            }

            volume = File("Series Vol.1 Ch.1-3.cbz", QualityTier.Official).Id;
            site = File("Series - Volume 1.cbz", QualityTier.Unknown).Id;
            loose = File("Series Ch.2.cbz", QualityTier.Unknown).Id;
            unique = File("Series Ch.9.cbz", QualityTier.Unknown).Id;

            Chapter Row(decimal? n, int? vol, string? title, int? fileId, bool wanted = true) =>
                new() { SeriesId = seriesId, Number = n, Volume = vol, Title = title, ChapterFileId = fileId, Wanted = wanted, PageCount = 8 };
            var rows = new[]
            {
                Row(1, 1, "Chapter 1", volume), Row(2, 1, "Chapter 2", loose), Row(3, 1, "Chapter 3", volume),
                Row(null, 1, "Volume 1", site), Row(9, 2, "Chapter 9", unique),
            };
            db.Chapters.AddRange(rows);
            db.SaveChanges();
            chapterIds = rows.Select(r => r.Id).ToList();
        }

        DuplicateReport report;
        using (var db = _db.NewContext())
        {
            report = await Service(db).RunAsync(seriesId, apply: true, default);
        }

        Assert.True(report.Applied);
        Assert.Equal(["Series - Volume 1.cbz", "Series Ch.2.cbz"],
            report.Removals.Select(r => Path.GetFileName(r.RelativePath)).Order().ToList());

        // The duplicates are in the trash, not gone; the volume and the unrelated chapter did not move.
        Assert.False(File.Exists(Path.Combine(_root, folder, "Series Ch.2.cbz")));
        Assert.False(File.Exists(Path.Combine(_root, folder, "Series - Volume 1.cbz")));
        Assert.Equal(2, Directory.GetFiles(Path.Combine(_root, ".maki-trash", seriesId.ToString())).Length);
        Assert.True(File.Exists(Path.Combine(_root, folder, "Series Vol.1 Ch.1-3.cbz")));
        Assert.True(File.Exists(Path.Combine(_root, folder, "Series Ch.9.cbz")));

        using var check = _db.NewContext();
        Assert.Equal([volume, unique], check.ChapterFiles.Select(f => f.Id).OrderBy(i => i).ToList().Order().ToList().Where(i => i == volume || i == unique).Order().ToList());
        Assert.DoesNotContain(check.ChapterFiles, f => f.Id == site || f.Id == loose);
        var byId = check.Chapters.ToDictionary(c => c.Id);
        // Chapter 2 now reads from the volume (its marker names it); the "Volume 1" row moved to the volume too.
        Assert.Equal(volume, byId[chapterIds[1]].ChapterFileId);
        Assert.Equal(volume, byId[chapterIds[3]].ChapterFileId);
        Assert.Equal(unique, byId[chapterIds[4]].ChapterFileId);
    }

    [Fact]
    public async Task A_series_with_nothing_volume_sized_is_left_alone_without_hashing_a_page()
    {
        const string folder = "Plain (2020)";
        Cbz(folder, "Plain Ch.1.cbz", Enumerable.Range(0, 6).Select(i => ($"{i}.png", 10 + i)), jpeg: false);
        Cbz(folder, "Plain Ch.2.cbz", Enumerable.Range(0, 6).Select(i => ($"{i}.png", 10 + i)), jpeg: false);
        int seriesId;
        using (var db = _db.NewContext())
        {
            var root = new RootFolder { Path = _root };
            db.RootFolders.Add(root);
            db.SaveChanges();
            var series = new Series { Title = "Plain", SortTitle = "Plain", FolderName = folder, RootFolderId = root.Id };
            db.Series.Add(series);
            db.SaveChanges();
            seriesId = series.Id;
            foreach (var n in new[] { 1, 2 })
            {
                var f = new ChapterFile { SeriesId = seriesId, RelativePath = $"{folder}/Plain Ch.{n}.cbz", DateAdded = DateTime.UtcNow };
                db.ChapterFiles.Add(f);
                db.SaveChanges();
                db.Chapters.Add(new Chapter { SeriesId = seriesId, Number = n, ChapterFileId = f.Id });
            }

            db.SaveChanges();
        }

        using var run = _db.NewContext();
        var report = await Service(run).RunAsync(seriesId, apply: true, default);

        Assert.Empty(report.Removals);
        Assert.Empty(run.ChapterFilePageHashes);
    }

    [Fact]
    public async Task A_loose_file_that_is_the_same_titled_chapter_as_one_in_the_volume_goes()
    {
        const string folder = "Titled (2022)";
        var marked = Enumerable.Range(0, 16)
            .Select(i => ($"Titled - c{(i / 8):000} (v01) - p{i:000}.png", 700 + i)).ToList(); // chapters 0 and 1, 8 pages each
        Cbz(folder, "Titled Vol.1 Ch.0-1.cbz", marked, jpeg: false);
        // "Rhythm A" again, listed as 0.5 by another source: a different scan, so its pages do not match.
        Cbz(folder, "Titled Ch.0.5.cbz", Enumerable.Range(0, 7).Select(i => ($"{i + 1:000}.png", 900 + i)), jpeg: false);
        // A different titled extra of about the same length stays.
        Cbz(folder, "Titled Ch.0.6.cbz", Enumerable.Range(0, 8).Select(i => ($"{i + 1:000}.png", 950 + i)), jpeg: false);
        int seriesId, twin, other;
        using (var db = _db.NewContext())
        {
            var root = new RootFolder { Path = _root };
            db.RootFolders.Add(root);
            db.SaveChanges();
            var series = new Series { Title = "Titled", SortTitle = "Titled", FolderName = folder, RootFolderId = root.Id };
            db.Series.Add(series);
            db.SaveChanges();
            seriesId = series.Id;
            int Add(string name)
            {
                var f = new ChapterFile
                {
                    SeriesId = seriesId, RelativePath = $"{folder}/{name}", DateAdded = DateTime.UtcNow,
                    Size = new FileInfo(Path.Combine(_root, folder, name)).Length
                };
                db.ChapterFiles.Add(f);
                db.SaveChanges();
                return f.Id;
            }

            var volume = Add("Titled Vol.1 Ch.0-1.cbz");
            twin = Add("Titled Ch.0.5.cbz");
            other = Add("Titled Ch.0.6.cbz");
            db.Chapters.AddRange(
                new Chapter { SeriesId = seriesId, Number = 0, Volume = 1, Title = "Rhythm A", ChapterFileId = volume, PageCount = 8 },
                new Chapter { SeriesId = seriesId, Number = 1, Volume = 1, Title = "Chapter 1", ChapterFileId = volume, PageCount = 8 },
                new Chapter { SeriesId = seriesId, Number = 0.5m, Title = "Rhythm A", ChapterFileId = twin, Wanted = false },
                new Chapter { SeriesId = seriesId, Number = 0.6m, Title = "Another extra", ChapterFileId = other, Wanted = false });
            db.SaveChanges();
        }

        using var run = _db.NewContext();
        var report = await Service(run).RunAsync(seriesId, apply: true, default);

        Assert.Equal(["Titled Ch.0.5.cbz"], report.Removals.Select(r => Path.GetFileName(r.RelativePath)).ToList());
        Assert.False(File.Exists(Path.Combine(_root, folder, "Titled Ch.0.5.cbz")));
        Assert.True(File.Exists(Path.Combine(_root, folder, "Titled Ch.0.6.cbz")));
        using var check = _db.NewContext();
        Assert.Null(check.Chapters.Single(c => c.Number == 0.5m).ChapterFileId);
        Assert.Equal(other, check.Chapters.Single(c => c.Number == 0.6m).ChapterFileId);
    }

    [Fact]
    public async Task A_short_chapter_that_is_a_run_inside_the_volume_goes()
    {
        const string folder = "Short (2022)";
        var marked = Enumerable.Range(0, 24)
            .Select(i => ($"Short - c{(i / 8) + 1:000} (v01) - p{i:000}.png", 300 + i)).ToList();
        Cbz(folder, "Short Vol.1 Ch.1-3.cbz", marked, jpeg: false);
        // Chapter 2 again as "2.1", only 4 pages of its 8, as JPEG.
        Cbz(folder, "Short Ch.2.1.cbz", Enumerable.Range(8, 4).Select(i => ($"{i + 1:000}.jpg", 300 + i)), jpeg: true);
        int seriesId;
        using (var db = _db.NewContext())
        {
            var root = new RootFolder { Path = _root };
            db.RootFolders.Add(root);
            db.SaveChanges();
            var series = new Series { Title = "Short", SortTitle = "Short", FolderName = folder, RootFolderId = root.Id };
            db.Series.Add(series);
            db.SaveChanges();
            seriesId = series.Id;
            ChapterFile Add(string name)
            {
                var f = new ChapterFile
                {
                    SeriesId = seriesId, RelativePath = $"{folder}/{name}", DateAdded = DateTime.UtcNow,
                    Size = new FileInfo(Path.Combine(_root, folder, name)).Length
                };
                db.ChapterFiles.Add(f);
                db.SaveChanges();
                return f;
            }

            var volume = Add("Short Vol.1 Ch.1-3.cbz");
            var loose = Add("Short Ch.2.1.cbz");
            db.Chapters.AddRange(
                new Chapter { SeriesId = seriesId, Number = 1, Volume = 1, ChapterFileId = volume.Id, PageCount = 8 },
                new Chapter { SeriesId = seriesId, Number = 2, Volume = 1, ChapterFileId = volume.Id, PageCount = 8 },
                new Chapter { SeriesId = seriesId, Number = 3, Volume = 1, ChapterFileId = volume.Id, PageCount = 8 },
                new Chapter { SeriesId = seriesId, Number = 2.1m, ChapterFileId = loose.Id, Wanted = false });
            db.SaveChanges();
        }

        using var run = _db.NewContext();
        var report = await Service(run).RunAsync(seriesId, apply: true, default);

        Assert.Equal(["Short Ch.2.1.cbz"], report.Removals.Select(r => Path.GetFileName(r.RelativePath)).ToList());
    }
}
