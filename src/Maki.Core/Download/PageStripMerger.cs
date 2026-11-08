using Maki.Core.Images;

namespace Maki.Core.Download;

/// <summary>
/// Some sources cut a page in two and serve the bottom as a separate short image (a "strip"). Glues
/// each strip back under the page before it. Originals are left alone, so a retry is idempotent.
/// </summary>
public static class PageStripMerger
{
    /// <summary>A strip is at most this fraction of the page width tall.</summary>
    private const double MaxStripAspect = 1.0 / 3;

    /// <summary>Page plus strip must still look like one page; taller is a webtoon or a banner.</summary>
    private const double MaxMergedAspect = 1.6;

    public static bool IsStrip(int pageWidth, int pageHeight, int stripWidth, int stripHeight) =>
        stripWidth == pageWidth
        && stripHeight <= pageWidth * MaxStripAspect
        && pageHeight >= pageWidth
        && pageHeight + stripHeight <= pageWidth * MaxMergedAspect;

    /// <returns>The page list to package: merged pages are new files in <paramref name="outDir"/>, the rest are the inputs.</returns>
    public static async Task<List<string>> MergeAsync(
        IReadOnlyList<string> pageFiles, string outDir, CancellationToken ct = default)
    {
        var sizes = pageFiles.Select(TryIdentify).ToList();
        var groups = new List<List<int>>();
        var height = 0;
        for (var i = 0; i < pageFiles.Count; i++)
        {
            if (groups.Count > 0 && sizes[groups[^1][0]] is { } first && sizes[i] is { } strip &&
                IsStrip(first.Width, height, strip.Width, strip.Height))
            {
                groups[^1].Add(i);
                height += strip.Height;
                continue;
            }

            groups.Add([i]);
            height = sizes[i]?.Height ?? 0;
        }

        if (groups.All(g => g.Count == 1))
        {
            return [.. pageFiles];
        }

        Directory.CreateDirectory(outDir);
        var result = new List<string>(groups.Count);
        foreach (var group in groups)
        {
            if (group.Count == 1)
            {
                result.Add(pageFiles[group[0]]);
                continue;
            }

            var files = group.Select(i => pageFiles[i]).ToList();
            try
            {
                result.Add(await ImageWorkGate.RunAsync(() => StackAsync(files, outDir, group[0], ct), ct));
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                // An undecodable half must not lose the pages: ship them split, as before.
                result.AddRange(files);
            }
        }

        return result;
    }

    /// <summary>
    /// The validator trusts an AVIF by its container without decoding it, so a page may not decode here.
    /// Such a page is shipped as it is and never merged, rather than failing the whole download.
    /// </summary>
    private static ImageHeader? TryIdentify(string path)
    {
        try
        {
            return ImageCodec.IdentifyFile(path);
        }
        catch (NetVips.VipsException)
        {
            return null;
        }
    }

    private static async Task<string> StackAsync(List<string> files, string outDir, int index, CancellationToken ct)
    {
        var rasters = new List<Raster>(files.Count);
        foreach (var file in files)
        {
            rasters.Add(Raster.Decode(await File.ReadAllBytesAsync(file, ct)));
        }

        var merged = new Raster(rasters[0].Width, rasters.Sum(r => r.Height), rasters[0].Bands);
        var y = 0;
        foreach (var raster in rasters)
        {
            merged.CopyFrom(raster, 0, 0, raster.Width, raster.Height, 0, y);
            y += raster.Height;
        }

        var extension = Path.GetExtension(files[0]).ToLowerInvariant();
        var (bytes, ext) = extension switch
        {
            ".jpg" or ".jpeg" => (merged.EncodeJpeg(92), extension),
            ".webp" => (merged.EncodeWebp(92), extension),
            _ => (merged.EncodePng(), ".png"),
        };
        var target = Path.Combine(outDir, $"{index:000}{ext}");
        await File.WriteAllBytesAsync(target, bytes, ct);
        return target;
    }
}
