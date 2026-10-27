using Maki.Core.Images;
using Maki.Core.Imaging;

namespace Maki.Core.Tests;

public class SpineColorTests
{
    private static byte[] Cover(Rgba background, Rgba? band = null)
    {
        var image = new Raster(200, 300, background, bands: 3);
        if (band is { } b)
        {
            for (var y = 0; y < 90; y++)
            for (var x = 0; x < 200; x++)
                image[x, y] = b;
        }
        return image.EncodePng();
    }

    private static double WhiteContrast(string hex)
    {
        static double Lin(int c) { var x = c / 255.0; return x <= 0.03928 ? x / 12.92 : Math.Pow((x + 0.055) / 1.055, 2.4); }
        var r = Convert.ToInt32(hex[1..3], 16); var g = Convert.ToInt32(hex[3..5], 16); var b = Convert.ToInt32(hex[5..7], 16);
        var l = 0.2126 * Lin(r) + 0.7152 * Lin(g) + 0.0722 * Lin(b);
        return 1.05 / (l + 0.05);
    }

    [Fact]
    public void A_saturated_cover_gives_a_spine_that_carries_white_text()
    {
        var cover = Cover(new Rgba(245, 240, 232), new Rgba(226, 30, 40));

        var spine = SpineColor.Sample(cover);

        Assert.NotNull(spine);
        Assert.True(WhiteContrast(spine!) >= 4.5, $"{spine} is too light for white text");
        Assert.True(Convert.ToInt32(spine[1..3], 16) > Convert.ToInt32(spine[3..5], 16) * 2, $"{spine} is not red");
    }

    [Fact]
    public void Skin_tones_are_not_picked()
    {
        var cover = Cover(new Rgba(242, 196, 170));

        Assert.Null(SpineColor.Sample(cover));
    }

    [Fact]
    public void Skin_is_skipped_in_favour_of_a_smaller_real_colour()
    {
        var cover = Cover(new Rgba(242, 196, 170), new Rgba(40, 130, 150));

        var spine = SpineColor.Sample(cover);

        Assert.NotNull(spine);
        Assert.True(Convert.ToInt32(spine![5..7], 16) > Convert.ToInt32(spine[1..3], 16), $"{spine} is not the teal band");
    }

    [Fact]
    public void A_bright_yellow_stays_pale_rather_than_going_olive()
    {
        var cover = Cover(new Rgba(250, 245, 238), new Rgba(253, 240, 20));

        var spine = SpineColor.Sample(cover);

        Assert.NotNull(spine);
        Assert.True(WhiteContrast(spine!) < 3, $"{spine} was darkened; a pale spine takes dark text instead");
    }

    [Fact]
    public void A_colourless_cover_has_no_spine()
    {
        var cover = Cover(new Rgba(128, 128, 128), new Rgba(30, 30, 30));

        Assert.Null(SpineColor.Sample(cover));
    }
}
