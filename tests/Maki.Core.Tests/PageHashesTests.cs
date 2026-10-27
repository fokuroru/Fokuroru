using Maki.Core.Images;
using Maki.Core.Reading;

namespace Maki.Core.Tests;

public class PageHashesTests
{
    // A page with a few shapes whose layout depends on the seed: distinct seeds are distinct "pages".
    private static Raster Page(int seed, int width, int height)
    {
        var image = new Raster(width, height, new Rgba(255, 255, 255), bands: 3);
        var rng = new Random(seed);
        for (var i = 0; i < 6; i++)
        {
            var w = (int)(width * (0.1 + rng.NextDouble() * 0.3));
            var h = (int)(height * (0.1 + rng.NextDouble() * 0.3));
            var x0 = (int)(rng.NextDouble() * (width - w));
            var y0 = (int)(rng.NextDouble() * (height - h));
            var shade = (byte)rng.Next(0, 200);
            for (var y = y0; y < y0 + h; y++)
            {
                for (var x = x0; x < x0 + w; x++)
                {
                    image[x, y] = new Rgba(shade, shade, shade);
                }
            }
        }

        return image;
    }

    private static ulong HashOf(Raster image, bool jpeg)
    {
        using var stream = new MemoryStream(jpeg ? image.EncodeJpeg(70) : image.EncodePng());
        return PageHashes.Hash(stream);
    }

    [Fact]
    public void The_same_page_hashes_alike_whatever_its_size_and_encoding()
    {
        for (var seed = 1; seed <= 12; seed++)
        {
            var big = Page(seed, 1600, 2400);
            var small = Page(seed, 800, 1200);
            var distance = System.Numerics.BitOperations.PopCount(HashOf(big, jpeg: true) ^ HashOf(small, jpeg: false));
            Assert.True(distance <= PageHashes.MaxDistance, $"seed {seed}: {distance} bits apart");
        }
    }

    [Fact]
    public void Different_pages_hash_apart()
    {
        var a = Page(1, 800, 1200);
        var b = Page(2, 800, 1200);
        var distance = System.Numerics.BitOperations.PopCount(HashOf(a, true) ^ HashOf(b, true));
        Assert.True(distance > PageHashes.MaxDistance, $"{distance} bits apart");
    }

    [Fact]
    public void A_blank_page_says_nothing()
    {
        var blank = new Raster(400, 600, new Rgba(255, 255, 255), bands: 3);
        Assert.False(PageHashes.Informative(HashOf(blank, jpeg: false)));
    }

    [Fact]
    public void Coverage_counts_the_pages_found_among_the_others_and_ignores_flat_ones()
    {
        ulong[] volume = [11, 0xF0F0F0F0F0F0F0F0, 0x123456789ABCDEF0, 0x0FF00FF00FF00FF0, 0xAAAAAAAAAAAAAAAA];
        ulong[] chapter = [0xF0F0F0F0F0F0F0F1, 0x123456789ABCDEF0, 0x0FF00FF00FF00FF3, 0];

        Assert.Equal(1.0, PageHashes.Coverage(chapter, [volume]));
        Assert.Equal(0.0, PageHashes.Coverage(chapter, [new ulong[] { 0x5555555555555555 }]));
        // Two informative pages are too few to say anything.
        Assert.Equal(0.0, PageHashes.Coverage(new ulong[] { 0xF0F0F0F0F0F0F0F1, 0x123456789ABCDEF0 }, [volume]));
    }

    [Fact]
    public void Coverage_can_come_from_several_files_together()
    {
        ulong[] first = [0xF0F0F0F0F0F0F0F0, 0x123456789ABCDEF0];
        ulong[] second = [0x0FF00FF00FF00FF0, 0xAAAAAAAAAAAAAAAA];
        ulong[] dump = [0xF0F0F0F0F0F0F0F0, 0x123456789ABCDEF0, 0x0FF00FF00FF00FF0, 0xAAAAAAAAAAAAAAAA];

        Assert.Equal(1.0, PageHashes.Coverage(dump, [first, second]));
    }

    [Fact]
    public void Hashes_survive_packing()
    {
        ulong[] hashes = [1, ulong.MaxValue - 1, 0x123456789ABCDEF0];
        Assert.Equal(hashes, PageHashes.Unpack(PageHashes.Pack(hashes)));
    }
}
