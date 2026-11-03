using Maki.Api.Configuration;
using Maki.Core.Reading;

namespace Maki.Api.Services;

/// <summary>Reads one reader page's bytes outside a request, for the upscale worker.</summary>
public static class ReaderPageCache
{
    /// <summary>
    /// A PDF page from its rendered cache file, anything else out of the archive. Null when the page
    /// cannot be read.
    /// </summary>
    public static async Task<byte[]?> ReadPageBytesAsync(
        AppPaths paths, ReaderArchiveCache archives, ReaderService.PageSlice slice, int absoluteIndex, CancellationToken ct)
    {
        var entry = slice.Pages[absoluteIndex];
        if (ComicFile.IsPdf(slice.ArchivePath))
        {
            var cached = Path.Combine(paths.ReaderCacheDir, slice.ChapterFileId.ToString(), $"{slice.ArchiveSize}-{absoluteIndex}.full.jpg");
            return File.Exists(cached) ? await File.ReadAllBytesAsync(cached, ct) : null;
        }

        await using var stream = await archives.OpenPageAsync(slice.ArchivePath, entry, ct);
        if (stream is null)
        {
            return null;
        }

        using var copy = new MemoryStream();
        await stream.CopyToAsync(copy, ct);
        return copy.ToArray();
    }
}
