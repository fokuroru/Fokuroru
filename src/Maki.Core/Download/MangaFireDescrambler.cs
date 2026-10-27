using Maki.Core.Images;

namespace Maki.Core.Download;

/// <summary>
/// Reverses MangaFire's tile scrambling. The site splits an image into pieces of at
/// most 200×200 px (at least a 5×5 grid) and shuffles all but the last row/column by
/// a per-image offset from the ajax response. Ported from the Tachiyomi MangaFire
/// extension's ImageInterceptor (removed upstream when the site changed APIs).
/// </summary>
public static class MangaFireDescrambler
{
    private const int PieceSize = 200;
    private const int MinSplitCount = 5;

    /// <summary>
    /// Descrambles the image file in place. Gated: this holds the source and the destination
    /// decoded at once, which is the largest per-page allocation anywhere in the download path.
    /// </summary>
    public static Task DescrambleFileAsync(string filePath, int offset, CancellationToken ct = default) =>
        ImageWorkGate.RunAsync(async () =>
        {
            var source = Raster.Decode(await File.ReadAllBytesAsync(filePath, ct));
            var result = Descramble(source, offset);

            // Written back in the format the file's own name says, so the bytes still match it.
            var bytes = Path.GetExtension(filePath).ToLowerInvariant() switch
            {
                ".jpg" or ".jpeg" => result.EncodeJpeg(90),
                ".webp" => result.EncodeWebp(90),
                ".gif" => result.EncodeGif(),
                _ => result.EncodePng(),
            };
            await File.WriteAllBytesAsync(filePath, bytes, ct);
        }, ct);

    public static Raster Descramble(Raster source, int offset)
    {
        var width = source.Width;
        var height = source.Height;
        var pieceWidth = Math.Min(PieceSize, CeilDiv(width, MinSplitCount));
        var pieceHeight = Math.Min(PieceSize, CeilDiv(height, MinSplitCount));
        var xMax = CeilDiv(width, pieceWidth) - 1;
        var yMax = CeilDiv(height, pieceHeight) - 1;

        var result = new Raster(width, height, source.Bands);
        for (var y = 0; y <= yMax; y++)
        {
            for (var x = 0; x <= xMax; x++)
            {
                var xDst = pieceWidth * x;
                var yDst = pieceHeight * y;
                var w = Math.Min(pieceWidth, width - xDst);
                var h = Math.Min(pieceHeight, height - yDst);

                // The last row/column stay in place; the rest are shuffled by the offset.
                var xSrc = pieceWidth * (x == xMax ? x : (xMax - x + offset) % xMax);
                var ySrc = pieceHeight * (y == yMax ? y : (yMax - y + offset) % yMax);

                result.CopyFrom(source, xSrc, ySrc, w, h, xDst, yDst);
            }
        }

        return result;
    }

    private static int CeilDiv(int value, int divisor) => (value + divisor - 1) / divisor;
}
