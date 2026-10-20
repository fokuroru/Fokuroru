using Maki.Core.Parsing;

namespace Maki.Core.Tests;

public class VideoReleaseTests
{
    // Titles from the proposals the volume search actually stored.
    [Theory]
    [InlineData("[FLE] Witch Hat Atelier - S01 (WEB 1080p HEVC E-AC-3) [Dual Audio] | Tongari Boushi no Atelier Season 1")]
    [InlineData("[DB] Dandadan 2nd Season | Dan Da Dan Season 2 [Dual Audio 10bit 1080p][HEVC-x265]")]
    [InlineData("[ANi] Grand Blue Dreaming  GRAND BLUE 3  12 [1080P][Baha][WEB DL][AAC AVC][CHT][MP4]")]
    [InlineData("[Shroud] Call of the Night Season 2 (1080p BD REMUX AVC FLAC)")]
    [InlineData("Some Show 720p WEB-DL")]
    [InlineData("Some Show S03E11 [English Dub]")]
    [InlineData("Movie.2023.BDRip.x264")]
    public void Video_releases_are_recognised(string title) => Assert.True(VideoRelease.IsVideo(title));

    [Theory]
    [InlineData("Solo Leveling (2021-2026) (Digital) (1r0n)")]
    [InlineData("The Guy She Was Interested In Wasn't a Guy at All v01-03 (2024-2025) (Digital) (1r0n)")]
    [InlineData("A Delinquent's Life Hacks 001-088 as v01-08 (2022) (Digital-Compilation) (Oak) [Completed]")]
    [InlineData("[Okina Keikaku (Shiwasu no Okina)] 100-Kai Furareta Zetsubou-teki ni Motenai Ore o Awarenda Kareshi")]
    [InlineData("My Love Story with Yamada-kun at Lv999 v01 + 010-107 (2022-2024) (Digital) (1r0n)")]
    [InlineData("Bocchi the Rock! v01-07 (2023-2025) (Digital) (1r0n)")]
    [InlineData("Series Name Vol.3 Ch.73-112 Season 2 Special")]
    public void Manga_releases_are_not(string title) => Assert.False(VideoRelease.IsVideo(title));

    [Fact]
    public void Nothing_is_not_video()
    {
        Assert.False(VideoRelease.IsVideo(null));
        Assert.False(VideoRelease.IsVideo(""));
    }
}
