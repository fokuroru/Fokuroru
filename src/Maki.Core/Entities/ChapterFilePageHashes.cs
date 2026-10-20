namespace Maki.Core.Entities;

/// <summary>
/// The perceptual hash of every page of a <see cref="ChapterFile"/> (see <c>PageHashes</c>), kept apart from
/// the file row so the many queries that load files do not carry it. Used to recognise the same pages in
/// another file whatever its numbering or encoding.
/// </summary>
public class ChapterFilePageHashes
{
    public int ChapterFileId { get; set; }

    /// <summary>Eight bytes per page, in reading order.</summary>
    public byte[] Hashes { get; set; } = [];

    /// <summary>The file size and added time the hashes were computed from, so a replaced file is hashed again.</summary>
    public string Key { get; set; } = string.Empty;
}
