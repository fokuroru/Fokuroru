using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Maki.Core.Imaging;

/// <summary>
/// A series' spine colour, sampled from its cover: the most characteristic saturated colour in
/// the art, adjusted so it can carry white text, or left pale (and paired with dark text by the
/// client) when it is a yellow that darkening would turn muddy.
/// <para>
/// Skin tones are skipped. Faces dominate manga covers, and without that filter most series came
/// out the same terracotta. A cover with no usable colour (a pale, desaturated one) returns null
/// and the client falls back to the default spine.
/// </para>
/// </summary>
public static class SpineColor
{
    private const double WhiteContrastTarget = 4.8;

    public static string? Sample(Image<Rgb24> cover)
    {
        using var small = cover.Clone(x => x.Resize(new ResizeOptions { Size = new Size(60, 90), Mode = ResizeMode.Stretch }));

        var sums = new Dictionary<int, (long R, long G, long B, int N)>();
        var total = 0;
        small.ProcessPixelRows(rows =>
        {
            for (var y = 0; y < rows.Height; y++)
            {
                foreach (var p in rows.GetRowSpan(y))
                {
                    var key = (p.R >> 5) << 6 | (p.G >> 5) << 3 | (p.B >> 5);
                    sums.TryGetValue(key, out var s);
                    sums[key] = (s.R + p.R, s.G + p.G, s.B + p.B, s.N + 1);
                    total++;
                }
            }
        });

        (double Score, double H, double L, double S)? best = null;
        foreach (var (r, g, b, n) in sums.Values)
        {
            var share = (double)n / total;
            if (share < 0.012)
            {
                continue;
            }

            var (h, l, s) = ToHsl(r / (double)n / 255, g / (double)n / 255, b / (double)n / 255);
            var skin = h <= 0.11 && s < 0.75 && l > 0.45;
            if (s < 0.3 || l < 0.12 || l > 0.82 || skin)
            {
                continue;
            }

            var score = Math.Pow(share, 0.35) * Math.Pow(s, 1.6);
            if (best is null || score > best.Value.Score)
            {
                best = (score, h, l, s);
            }
        }

        if (best is not { } pick)
        {
            return null;
        }

        // A bright yellow darkened for white text goes olive; kept light instead, the client pairs it
        // with dark text.
        if (pick.H is > 0.11 and < 0.2 && pick.L > 0.45 && pick.S > 0.8)
        {
            return ToHex(FromHsl(pick.H, Math.Max(pick.L, 0.5), pick.S));
        }

        var light = pick.L;
        while (Contrast(FromHsl(pick.H, light, pick.S), (1, 1, 1)) < WhiteContrastTarget && light > 0.05)
        {
            light -= 0.01;
        }

        return ToHex(FromHsl(pick.H, light, pick.S));
    }

    private static (double H, double L, double S) ToHsl(double r, double g, double b)
    {
        var max = Math.Max(r, Math.Max(g, b));
        var min = Math.Min(r, Math.Min(g, b));
        var l = (max + min) / 2;
        if (max == min)
        {
            return (0, l, 0);
        }

        var d = max - min;
        var s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        double h;
        if (max == r)
        {
            h = (g - b) / d + (g < b ? 6 : 0);
        }
        else if (max == g)
        {
            h = (b - r) / d + 2;
        }
        else
        {
            h = (r - g) / d + 4;
        }

        return (h / 6, l, s);
    }

    private static (double R, double G, double B) FromHsl(double h, double l, double s)
    {
        if (s == 0)
        {
            return (l, l, l);
        }

        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        return (Hue(p, q, h + 1.0 / 3), Hue(p, q, h), Hue(p, q, h - 1.0 / 3));

        static double Hue(double p, double q, double t)
        {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1.0 / 6) return p + (q - p) * 6 * t;
            if (t < 0.5) return q;
            if (t < 2.0 / 3) return p + (q - p) * (2.0 / 3 - t) * 6;
            return p;
        }
    }

    private static double Luminance((double R, double G, double B) c)
    {
        static double Lin(double x) => x <= 0.03928 ? x / 12.92 : Math.Pow((x + 0.055) / 1.055, 2.4);
        return 0.2126 * Lin(c.R) + 0.7152 * Lin(c.G) + 0.0722 * Lin(c.B);
    }

    private static double Contrast((double R, double G, double B) a, (double R, double G, double B) b)
    {
        var la = Luminance(a);
        var lb = Luminance(b);
        return (Math.Max(la, lb) + 0.05) / (Math.Min(la, lb) + 0.05);
    }

    private static string ToHex((double R, double G, double B) c) =>
        $"#{Byte(c.R):x2}{Byte(c.G):x2}{Byte(c.B):x2}";

    private static int Byte(double v) => (int)Math.Round(Math.Clamp(v, 0, 1) * 255);
}
