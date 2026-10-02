using Maki.Api.Services;
using Maki.Core.Sources;

namespace Maki.Api.Tests;

/// <summary>Which chapter the Discover preview opens on a source's listing.</summary>
public class SeriesPreviewTests
{
    [Theory]
    [InlineData(29, true)]
    [InlineData(30, false)]
    [InlineData(31, false)]
    public void Finished_preview_survives_restart_for_thirty_days(int ageDays, bool reusable)
    {
        var root = Path.Combine(Path.GetTempPath(), $"preview-test-{Guid.NewGuid():N}");
        var pages = Path.Combine(root, "abc123", "fake");
        Directory.CreateDirectory(pages);
        try
        {
            File.WriteAllText(Path.Combine(pages, "000.jpg"), "page");
            File.WriteAllText(Path.Combine(root, "preview.json"), System.Text.Json.JsonSerializer.Serialize(
                new SeriesPreviewService.CachedPreview(DateTime.UtcNow.AddDays(-ageDays), "abc123", "fake", "Fake", "1", 1)));
            Assert.Equal(reusable, SeriesPreviewService.LoadCached(root) is not null);
            if (reusable)
            {
                File.Delete(Path.Combine(pages, "000.jpg"));
                Assert.Null(SeriesPreviewService.LoadCached(root));
            }
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    private static void SeedPreview(string dir, long providerId, int ageDays)
    {
        var root = Path.Combine(dir, providerId.ToString());
        var pages = Path.Combine(root, "tok", "fake");
        Directory.CreateDirectory(pages);
        File.WriteAllText(Path.Combine(pages, "000.jpg"), "page");
        File.WriteAllText(Path.Combine(root, "preview.json"), System.Text.Json.JsonSerializer.Serialize(
            new SeriesPreviewService.CachedPreview(DateTime.UtcNow.AddDays(-ageDays), "tok", "fake", "Fake", "1", 1)));
    }

    [Fact]
    public void Lists_downloaded_previews_newest_first_and_skips_expired_and_stray_folders()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"preview-list-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(dir, "not-a-provider"));
        try
        {
            SeedPreview(dir, 11, ageDays: 5);
            SeedPreview(dir, 22, ageDays: 1);
            SeedPreview(dir, 33, ageDays: 40);

            Assert.Equal([22L, 11L], SeriesPreviewService.CachedProviders(dir));
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    [Fact]
    public void Deleting_a_preview_removes_only_that_one()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"preview-del-{Guid.NewGuid():N}");
        try
        {
            SeedPreview(dir, 11, ageDays: 1);
            SeedPreview(dir, 22, ageDays: 2);

            SeriesPreviewService.DeleteProvider(dir, 11);
            SeriesPreviewService.DeleteProvider(dir, 999);

            Assert.Equal([22L], SeriesPreviewService.CachedProviders(dir));
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    [Fact]
    public void Lists_nothing_when_no_preview_was_ever_made()
    {
        Assert.Empty(SeriesPreviewService.CachedProviders(Path.Combine(Path.GetTempPath(), $"missing-{Guid.NewGuid():N}")));
    }

    private static SourceChapter Chapter(decimal? number, string id = "") =>
        new("fake", "s", id == "" ? number?.ToString() ?? "x" : id, number?.ToString(), number, null, null, "en", null);

    [Fact]
    public void Picks_chapter_one_even_when_a_prologue_is_listed()
    {
        var picked = SeriesPreviewService.PickFirstChapter([Chapter(3), Chapter(0), Chapter(1), Chapter(2)]);

        Assert.Equal(1m, picked?.Number);
    }

    [Fact]
    public void Falls_back_to_the_lowest_numbered_chapter()
    {
        // MangaDex drops old scans, so a listing can start well past chapter 1.
        var picked = SeriesPreviewService.PickFirstChapter([Chapter(52), Chapter(48), Chapter(50)]);

        Assert.Equal(48m, picked?.Number);
    }

    [Fact]
    public void Unnumbered_extras_are_never_picked()
    {
        Assert.Equal(7m, SeriesPreviewService.PickFirstChapter([Chapter(null, "oneshot"), Chapter(7)])?.Number);
        Assert.Null(SeriesPreviewService.PickFirstChapter([Chapter(null, "oneshot")]));
    }

    [Fact]
    public void An_empty_listing_has_no_first_chapter() =>
        Assert.Null(SeriesPreviewService.PickFirstChapter([]));

    private static SeriesPreviewService.ListedCandidate Listed(string name, decimal? first) =>
        new(new SourceCandidate(new FakeSource { Name = name }, "s", null), first is null ? null : Chapter(first), null);

    [Fact]
    public void A_source_with_chapter_one_beats_a_higher_ranked_one_that_starts_later()
    {
        // Official sites tend to list only the newest free chapters, and a preview of chapter 3 is
        // not what anyone opened it for.
        var order = SeriesPreviewService.FetchOrder(
            [Listed("webtoons", 3), Listed("empty", null), Listed("mangadex", 1), Listed("weebcentral", 1)]);

        Assert.Equal(["mangadex", "weebcentral", "webtoons"], order.Select(l => l.Candidate.Source.Name));
    }
}
