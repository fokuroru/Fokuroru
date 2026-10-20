using System.IO.Compression;
using System.Numerics;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

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
            // The target size lets decoders that can (JPEG) read the page already shrunk.
            using var picture = Image.Load<L8>(new DecoderOptions { TargetSize = new Size(72, 72) }, image);
            picture.Mutate(x => x.Resize(9, 8, KnownResamplers.Box));
            ulong bits = 0;
            for (var y = 0; y < 8; y++)
            {
                for (var x = 0; x < 8; x++)
                {
                    bits = (bits << 1) | (picture[x, y].PackedValue > picture[x + 1, y].PackedValue ? 1UL : 0UL);
                }
            }

            return bits;
        }
        catch (Exception ex) when (ex is UnknownImageFormatException or InvalidImageContentException or NotSupportedException)
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
