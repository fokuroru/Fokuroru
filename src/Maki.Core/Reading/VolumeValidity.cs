namespace Maki.Core.Reading;

public enum VolumeVerdict
{
    /// <summary>Not enough measured chapters to judge, so the volume is given the benefit of the doubt.</summary>
    Unknown,
    Valid,
    /// <summary>Far fewer pages than its chapters add up to: a partial or truncated volume.</summary>
    TooShort,
    /// <summary>Far more: a bundle of several volumes, or a different work.</summary>
    TooLong,
}

/// <summary>
/// Whether a volume's page count is plausible for the chapters it claims. A series' chapters are
/// close to one length (the median, "typical"), so a volume of N whole chapters should hold about
/// N times that, with room for bonus pages. Measured on a real series: Vol.1 holds 38 chapters of
/// 4 pages in 184 pages (1.2 times), Vol.2 35 in 167, Vol.3 40 in 185; the band 0.6 to 2.5 passes
/// those with margin and catches a 40-page "volume" of 38 chapters or a 400-page one.
/// </summary>
public static class VolumeValidity
{
    public const double MinRatio = 0.6;
    public const double MaxRatio = 2.5;

    /// <summary>The median of the measured page counts, or 0 when fewer than three are known.</summary>
    public static double TypicalPages(IEnumerable<int?> counts)
    {
        var known = counts.Where(c => c > 0).Select(c => c!.Value).Order().ToList();
        return known.Count < 3 ? 0 : known[known.Count / 2];
    }

    /// <param name="pages">Pages in the volume's file, or the page list a source offers for it.</param>
    /// <param name="mainChapters">Whole-numbered chapters the volume covers.</param>
    /// <param name="typical">See <see cref="TypicalPages"/>.</param>
    public static VolumeVerdict Check(int pages, int mainChapters, double typical)
    {
        if (typical <= 0 || mainChapters < 2 || pages <= 0)
        {
            return VolumeVerdict.Unknown;
        }

        var expected = mainChapters * typical;
        return pages < expected * MinRatio ? VolumeVerdict.TooShort
            : pages > expected * MaxRatio ? VolumeVerdict.TooLong
            : VolumeVerdict.Valid;
    }

    public static bool IsGood(VolumeVerdict verdict) => verdict is VolumeVerdict.Valid or VolumeVerdict.Unknown;
}
