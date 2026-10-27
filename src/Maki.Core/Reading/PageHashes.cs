using System.IO.Compression;
using System.Numerics;
using Maki.Core.Images;

namespace Maki.Core.Reading;

/// <summary>
/// A comic file's pages as 64-bit perceptual (difference) hashes, so two files can be recognised as
/// holding the same pages whatever their numbering, naming or encoding. A volume ripped as JPEG and the
/// same volume from a site as PNG share no bytes, but their pages hash within a few bits of each other.
/// <para>
/// Numbers lie (one source's "Chapter 1.1" is another's whole first volume); the pages do not. On a real
/// series this found 16 duplicate files (about 470 MB) that no chapter number, file name or page count
/// gave away.
/// </para>
/// </summary>
public static class PageHashes
{
    /// <summary>Hamming distance at which two page hashes count as the same page.</summary>
    public const int MaxDistance = 8;

    /// <summary>
    /// Per-page cutoff for an unbroken run (see <see cref="AlignedCoverage"/>): in order and contiguous is strong
    /// evidence on its own, so each page may differ a little more. Across every pair of files in a real series,
    /// this found only genuine copies.
    /// </summary>
    public const int RunDistance = 12;

    /// <summary>Below this many informative pages a file is too short to judge by content.</summary>
    public const int MinPages = 3;

    /// <summary>Flat pages (blank, solid colour) hash to all zeros and say nothing about a file.</summary>
    public static bool Informative(ulong hash) => hash != 0 && hash != ulong.MaxValue;

    /// <summary>One hash per page in reading order; 0 for a page that cannot be decoded. Empty for a PDF.</summary>
    public static ulong[] OfArchive(string path, CancellationToken ct)
    {
        if (ComicFile.IsPdf(path))
        {
            return [];
        }

        try
        {
            using var archive = ZipFile.OpenRead(path);
            var names = CbzReader.PageNames(archive);
            var hashes = new ulong[names.Count];
            for (var i = 0; i < names.Count; i++)
            {
                ct.ThrowIfCancellationRequested();
                using var stream = CbzReader.OpenEntry(archive, names[i]);
                hashes[i] = stream is null ? 0 : Hash(stream);
            }

            return hashes;
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    /// <summary>A 9 by 8 greyscale difference hash of one image, or 0 when it cannot be read.</summary>
    public static ulong Hash(Stream image)
    {
        try
        {
            using var buffer = new MemoryStream();
            image.CopyTo(buffer);
            // The page squeezed to 9 by 8, shrunk while decoding where the format allows it.
            var grey = ImageCodec.ForcedGrey(buffer.ToArray(), 9, 8);
            ulong bits = 0;
            for (var y = 0; y < 8; y++)
            {
                for (var x = 0; x < 8; x++)
                {
                    bits = (bits << 1) | (grey[y * 9 + x] > grey[y * 9 + x + 1] ? 1UL : 0UL);
                }
            }

            return bits;
        }
        catch (Exception ex) when (ex is NetVips.VipsException or NotSupportedException or InvalidDataException)
        {
            return 0;
        }
    }

    /// <summary>
    /// The share of <paramref name="pages"/> (informative ones only) that appear, within
    /// <see cref="MaxDistance"/> bits, among <paramref name="others"/>. 0 when there are too few to judge.
    /// </summary>
    public static double Coverage(IReadOnlyList<ulong> pages, IEnumerable<IReadOnlyList<ulong>> others)
    {
        var mine = pages.Where(Informative).ToList();
        if (mine.Count < MinPages)
        {
            return 0;
        }

        var pool = others.SelectMany(o => o).Where(Informative).ToHashSet().ToArray();
        if (pool.Length == 0)
        {
            return 0;
        }

        var hits = mine.Count(p => pool.Any(q => BitOperations.PopCount(p ^ q) <= MaxDistance));
        return hits / (double)mine.Count;
    }

    /// <summary>
    /// For a short file: the best share of its informative pages that sit, in order and unbroken, at some
    /// position of <paramref name="larger"/>. A few low-detail pages can each match some other page by chance,
    /// but the same run of consecutive pages matching in the same order is a copy. 0 below <see cref="MinPages"/>.
    /// </summary>
    public static double AlignedCoverage(IReadOnlyList<ulong> small, IReadOnlyList<ulong> larger, int maxDistance = RunDistance)
    {
        var informative = small.Count(Informative);
        if (informative < MinPages || larger.Count < small.Count)
        {
            return 0;
        }

        var best = 0;
        for (var offset = 0; offset + small.Count <= larger.Count; offset++)
        {
            var hits = 0;
            for (var i = 0; i < small.Count; i++)
            {
                if (Informative(small[i]) && Informative(larger[offset + i])
                    && BitOperations.PopCount(small[i] ^ larger[offset + i]) <= maxDistance)
                {
                    hits++;
                }
            }

            best = Math.Max(best, hits);
        }

        return best / (double)informative;
    }

    public static byte[] Pack(ulong[] hashes)
    {
        var bytes = new byte[hashes.Length * sizeof(ulong)];
        Buffer.BlockCopy(hashes, 0, bytes, 0, bytes.Length);
        return bytes;
    }

    public static ulong[] Unpack(byte[] bytes)
    {
        var hashes = new ulong[bytes.Length / sizeof(ulong)];
        Buffer.BlockCopy(bytes, 0, hashes, 0, hashes.Length * sizeof(ulong));
        return hashes;
    }
}
