using Maki.Core.Images;

namespace Maki.Core.Tests;

public class StripSlicerTests
{
    private static byte[] Strip(int width, int height, params (int Top, int Bottom)[] art)
    {
        var raster = new Raster(width, height, new Rgba(255, 255, 255), 3);
        foreach (var (top, bottom) in art)
        for (var y = top; y < bottom; y++)
        for (var x = 0; x < width; x += 2)
            raster[x, y] = new Rgba(0, 0, 0);
        return raster.EncodePng();
    }

    [Fact]
    public void A_normal_page_is_left_alone()
    {
        Assert.Null(StripSlicer.Split(Strip(100, 150), 1.35));
    }

    [Fact]
    public void A_strip_is_cut_in_the_gutter_not_through_art()
    {
        // ideal cut at row 135; art covers 100-134 and 140-300, gutter rows 135-139
        var tiles = StripSlicer.Split(Strip(100, 400, (100, 135), (140, 300)), 1.35);

        Assert.NotNull(tiles);
        var heights = tiles.Select(t => ImageCodec.Identify(t).Height).ToArray();
        Assert.Equal(400, heights.Sum());
        Assert.InRange(heights[0], 135, 140);
    }
}
