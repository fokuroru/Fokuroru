namespace Maki.Core.Images;

/// <summary>
/// Cuts a tall webtoon strip into screen-shaped pieces for paged e-readers, snapping each cut to
/// the quietest nearby row (a gutter) so panels are not sliced through.
/// </summary>
public static class StripSlicer
{
    /// <summary>A page taller than this many widths counts as a strip; shorter pages are left alone.</summary>
    public const double StripRatio = 2.2;

    /// <summary>
    /// Returns JPEG tiles of about <paramref name="tileRatio"/> heights per width, or null when the
    /// page is not a strip (so the caller keeps the original bytes untouched).
    /// </summary>
    public static List<byte[]>? Split(byte[] page, double tileRatio, int quality = 85)
    {
        var header = ImageCodec.TryIdentify(page);
        if (header is not { } h || h.Height <= h.Width * StripRatio) return null;

        var raster = Raster.Decode(page, 3);
        var tiles = new List<byte[]>();
        foreach (var (top, height) in Cuts(raster, tileRatio))
        {
            var tile = new Raster(raster.Width, height, 3);
            tile.CopyFrom(raster, 0, top, raster.Width, height, 0, 0);
            tiles.Add(tile.EncodeJpeg(quality));
        }
        return tiles;
    }

    internal static IEnumerable<(int Top, int Height)> Cuts(Raster raster, double tileRatio)
    {
        var tile = Math.Max(1, (int)(raster.Width * tileRatio));
        var window = tile / 5; // look this far above the ideal cut for a gutter
        var top = 0;
        while (raster.Height - top > tile + window)
        {
            var cut = top + tile;
            var best = cut;
            var bestScore = double.MaxValue;
            for (var y = cut; y > cut - window; y--)
            {
                var score = RowNoise(raster, y);
                if (score < bestScore) { bestScore = score; best = y; }
                if (score == 0) break;
            }
            yield return (top, best - top);
            top = best;
        }
        yield return (top, raster.Height - top);
    }

    // Spread of one row's bytes: a flat gutter row scores near 0, a row through art scores high.
    private static double RowNoise(Raster raster, int y)
    {
        var row = raster.Row(y);
        int min = 255, max = 0;
        for (var i = 0; i < row.Length; i += raster.Bands * 4)
        {
            var v = (row[i] + row[i + 1] + row[i + 2]) / 3;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        return max - min;
    }
}
