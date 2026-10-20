using System.Text.RegularExpressions;

namespace Maki.Core.Parsing;

/// <summary>
/// Recognises a video release by its title. Prowlarr answers a series name with anime episodes and seasons too
/// ("[Shroud] Call of the Night Season 2 (1080p BD REMUX AVC FLAC)"), and nothing in a manga release's name
/// (volumes, years, "Digital", a release group) looks like these: a resolution, a video codec, a video source
/// or an episode number.
/// </summary>
public static partial class VideoRelease
{
    [GeneratedRegex(
        @"(?<![0-9a-z])(?:480|576|720|1080|1440|2160|4320)[pi](?![a-z0-9])" +
        @"|\b(?:x26[45]|h\.?26[45]|hevc|xvid|divx)\b" +
        @"|\b(?:web[-. ]?dl|web[-. ]?rip|bd[-. ]?rip|bd[-. ]?remux|dvd[-. ]?rip)\b" +
        @"|\bs\d{1,2}e\d{1,3}\b" +
        @"|\bdual[-. ]audio\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Markers();

    public static bool IsVideo(string? title) => !string.IsNullOrEmpty(title) && Markers().IsMatch(title);
}
