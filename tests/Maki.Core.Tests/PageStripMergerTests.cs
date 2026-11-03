using Maki.Core.Download;
using Maki.Core.Images;

namespace Maki.Core.Tests;

public class PageStripMergerTests
{
    [Theory]
    [InlineData(800, 1000, 800, 200, true)]
    [InlineData(800, 1000, 800, 600, false)]
    [InlineData(800, 1000, 700, 200, false)]
    [InlineData(800, 3000, 800, 200, false)]
    [InlineData(800, 300, 800, 100, false)]
    public void IsStrip_judges_by_width_and_proportion(int pw, int ph, int sw, int sh, bool expected) =>
        Assert.Equal(expected, PageStripMerger.IsStrip(pw, ph, sw, sh));

    [Fact]
    public async Task Strip_is_glued_under_its_page()
    {
        var dir = Directory.CreateTempSubdirectory().FullName;
        try
        {
            string Write(string name, int w, int h, Rgba color)
            {
                var path = Path.Combine(dir, name);
                File.WriteAllBytes(path, new Raster(w, h, color).EncodePng());
                return path;
            }

            var pages = new[]
            {
                Write("001.png", 400, 500, new Rgba(255, 0, 0)),
                Write("002.png", 400, 100, new Rgba(0, 255, 0)),
                Write("003.png", 400, 600, new Rgba(0, 0, 255)),
            };

            var merged = await PageStripMerger.MergeAsync(pages, Path.Combine(dir, "merged"));

            Assert.Equal(2, merged.Count);
            var first = Raster.Decode(File.ReadAllBytes(merged[0]));
            Assert.Equal(600, first.Height);
            Assert.Equal(new Rgba(255, 0, 0), first[0, 499]);
            Assert.Equal(new Rgba(0, 255, 0), first[0, 500]);
            Assert.Equal(pages[2], merged[1]);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }
}
