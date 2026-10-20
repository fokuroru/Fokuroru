using System.IO.Compression;
using Maki.Core.Reading;
using PdfSharp.Drawing;
using PdfSharp.Pdf;

using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace Maki.Core.Tests;

public class PdfOrientationTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("maki-orient").FullName;

    public void Dispose() => Directory.Delete(_dir, true);

    [Fact]
    public void Reverse_flips_page_order_and_leaves_no_temp_file()
    {
        var path = Path.Combine(_dir, "v1.pdf");
        using (var doc = new PdfDocument())
        {
            foreach (var width in new[] { 100, 200, 300 })
            {
                var page = doc.AddPage();
                page.Width = XUnitPt.FromPoint(width);
            }
            doc.Save(path);
        }

        PdfOrientation.Reverse(path);

        using var reversed = PdfSharp.Pdf.IO.PdfReader.Open(path, PdfSharp.Pdf.IO.PdfDocumentOpenMode.Import);
        Assert.Equal([300d, 200d, 100d], reversed.Pages.Cast<PdfPage>().Select(p => p.Width.Point));
        Assert.Single(Directory.GetFiles(_dir));
    }

    [Fact]
    public void ReversedAgainst_matches_covers_across_the_pair()
    {
        var old = Cbz("old.cbz", Shade(0), Shade(1), Shade(2));
        Assert.True(PdfOrientation.ReversedAgainst(Cbz("backwards.cbz", Shade(2), Shade(1), Shade(0)), old));
        Assert.False(PdfOrientation.ReversedAgainst(Cbz("same.cbz", Shade(0), Shade(1), Shade(2)), old));
    }

    // A page whose left half is dark and right half light, or the opposite, per seed.
    private static byte[] Shade(int seed)
    {
        using var image = new Image<L8>(64, 64);
        for (var y = 0; y < 64; y++)
            for (var x = 0; x < 64; x++)
                image[x, y] = new L8((byte)((x * (seed + 1) * 7 + y * (seed + 2) * 3 + seed * 90) % 256));
        using var ms = new MemoryStream();
        image.SaveAsPng(ms);
        return ms.ToArray();
    }

    private string Cbz(string name, params byte[][] pages)
    {
        var path = Path.Combine(_dir, name);
        using var zip = ZipFile.Open(path, ZipArchiveMode.Create);
        for (var i = 0; i < pages.Length; i++)
        {
            using var s = zip.CreateEntry($"{i + 1:000}.png").Open();
            s.Write(pages[i]);
        }
        return path;
    }
}
