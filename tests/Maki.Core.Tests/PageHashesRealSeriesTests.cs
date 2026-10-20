using Maki.Core.Reading;

namespace Maki.Core.Tests;

/// <summary>
/// Runs against the real "The Guy She Was Interested In Wasn't a Guy at All" folder when the library share is
/// mounted, and passes trivially when it is not. The duplicate figures are what a perceptual comparison with
/// macOS sips found (see the series' folder: every volume exists twice, and Ch.1.x are copies of Volume 1).
/// </summary>
public class PageHashesRealSeriesTests
{
    private const string Folder =
        "/Volumes/SSD RAID/Comics/Manga/The Guy She Was Interested In Wasn't a Guy at All (2022)";

    private static ulong[] Hashes(string name) =>
        PageHashes.OfArchive(Path.Combine(Folder, $"The Guy She Was Interested In Wasn't a Guy at All{name}.cbz"), default);

    [Fact]
    public void The_real_duplicates_are_found_and_the_unrelated_files_are_not()
    {
        if (!Directory.Exists(Folder))
        {
            return;
        }

        var torrentVolume1 = Hashes(" Vol.1 Ch.0");
        var siteVolume1 = Hashes(" - Volume 1");
        var dump = Hashes(" Ch.1.1");
        var bonus = Hashes(" Ch.0.1");
        var torrentVolume2 = Hashes(" Vol.2 Ch.38-72");
        var unrelated = Hashes(" Ch.180");

        Assert.True(PageHashes.Coverage(siteVolume1, [torrentVolume1]) >= 0.9);
        Assert.True(PageHashes.Coverage(dump, [torrentVolume1]) >= 0.9);
        Assert.True(PageHashes.Coverage(bonus, [torrentVolume2]) >= 0.8);
        Assert.True(PageHashes.Coverage(unrelated, [torrentVolume1, torrentVolume2]) < 0.2);
        Assert.True(PageHashes.Coverage(torrentVolume2, [torrentVolume1]) < 0.2);
    }
}
