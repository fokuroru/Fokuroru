using Maki.Core.Download;
using Maki.Core.Images;

namespace Maki.Core.Tests;

public class MangaFireDescramblerTests
{
    /// <summary>Every pixel encodes its own coordinates, so any misplaced tile is detected.</summary>
    private static Raster CoordinateImage(int width, int height)
    {
        var image = new Raster(width, height);
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                image[x, y] = new Rgba((byte)(x % 256), (byte)(y % 256), (byte)((x / 256 * 16) + (y / 256)));
            }
        }

        return image;
    }

    /// <summary>
    /// Applies the site's scramble (the inverse of what the descrambler does):
    /// the descrambler reads destination piece (x, y) from source piece
    /// ((max - x + offset) % max, ...), so the scrambler writes piece (x, y) of the
    /// original into that shuffled position.
    /// </summary>
    private static Raster Scramble(Raster original, int offset)
    {
        var width = original.Width;
        var height = original.Height;
        var pieceWidth = Math.Min(200, CeilDiv(width, 5));
        var pieceHeight = Math.Min(200, CeilDiv(height, 5));
        var xMax = CeilDiv(width, pieceWidth) - 1;
        var yMax = CeilDiv(height, pieceHeight) - 1;

        var scrambled = new Raster(width, height);
        for (var y = 0; y <= yMax; y++)
        {
            for (var x = 0; x <= xMax; x++)
            {
                var xDst = pieceWidth * x;
                var yDst = pieceHeight * y;
                var w = Math.Min(pieceWidth, width - xDst);
                var h = Math.Min(pieceHeight, height - yDst);
                var xSrc = pieceWidth * (x == xMax ? x : (xMax - x + offset) % xMax);
                var ySrc = pieceHeight * (y == yMax ? y : (yMax - y + offset) % yMax);

                // Inverse of the descrambler: original piece at (xDst, yDst) is
                // stored at the shuffled source position.
                scrambled.CopyFrom(original, xDst, yDst, w, h, xSrc, ySrc);
            }
        }

        return scrambled;
    }

    private static void AssertPixelsEqual(Raster expected, Raster actual)
    {
        Assert.Equal(expected.Width, actual.Width);
        Assert.Equal(expected.Height, actual.Height);
        for (var y = 0; y < expected.Height; y++)
        {
            for (var x = 0; x < expected.Width; x++)
            {
                Assert.True(expected[x, y] == actual[x, y], $"Pixel mismatch at ({x}, {y})");
            }
        }
    }

    [Theory]
    [InlineData(1100, 900, 3)]   // partial edge pieces (1100 % 200 != 0)
    [InlineData(800, 1200, 1)]   // exact-multiple width
    [InlineData(1000, 1000, 7)]  // offset larger than the grid
    [InlineData(150, 90, 2)]     // small image → pieces from ceil(size/5)
    public void Descramble_reverses_the_site_scramble(int width, int height, int offset)
    {
        var original = CoordinateImage(width, height);
        var scrambled = Scramble(original, offset);

        var descrambled = MangaFireDescrambler.Descramble(scrambled, offset);

        AssertPixelsEqual(original, descrambled);
    }

    [Fact]
    public void Tiny_image_roundtrips()
    {
        // MinSplitCount forces a grid even on tiny images (40 px → 8 px pieces).
        var original = CoordinateImage(40, 30);
        var scrambled = Scramble(original, 5);
        var descrambled = MangaFireDescrambler.Descramble(scrambled, 5);
        AssertPixelsEqual(original, descrambled);
    }

    [Fact]
    public async Task DescrambleFileAsync_roundtrips_png_in_place()
    {
        var dir = Directory.CreateTempSubdirectory("maki-descramble-tests");
        try
        {
            var path = Path.Combine(dir.FullName, "page.png");
            var original = CoordinateImage(600, 400);
            await File.WriteAllBytesAsync(path, Scramble(original, 4).EncodePng());

            await MangaFireDescrambler.DescrambleFileAsync(path, 4);

            var reloaded = Raster.Decode(await File.ReadAllBytesAsync(path));
            AssertPixelsEqual(original, reloaded);
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    private static int CeilDiv(int value, int divisor) => (value + divisor - 1) / divisor;
}
