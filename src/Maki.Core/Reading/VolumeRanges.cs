namespace Maki.Core.Reading;

/// <summary>Which volume a chapter number belongs to, from the volumes of the chapters around it.</summary>
public static class VolumeRanges
{
    /// <summary>
    /// The volume a number belongs to when the series numbers straight through its volumes (each volume's
    /// chapters all above the previous volume's), else null. A number below the first volume belongs to it; one between two volumes belongs to neither
    /// unless <c>fillGaps</c> hands it to the earlier one.
    /// </summary>
    public static int? ContinuousVolumeOf(
        IEnumerable<(int? Volume, decimal? Number)> chapters, decimal number, bool fillGaps = false)
    {
        var ranges = chapters
            .Where(c => c.Volume is not null && c.Number is { } n && n > 0 && n % 1 == 0 && n != number)
            .GroupBy(c => c.Volume!.Value)
            .Select(g => (Volume: g.Key, Min: g.Min(c => c.Number!.Value), Max: g.Max(c => c.Number!.Value)))
            .OrderBy(r => r.Volume)
            .ToList();
        if (ranges.Count < 2 || ranges.Zip(ranges.Skip(1)).Any(p => p.First.Max >= p.Second.Min))
        {
            return null;
        }

        if (number < ranges[0].Min)
        {
            return ranges[0].Volume;
        }

        if (number > ranges[^1].Max)
        {
            return ranges[^1].Volume;
        }

        foreach (var r in ranges)
        {
            if (number >= r.Min && number <= r.Max)
            {
                return r.Volume;
            }
        }

        // Between two volumes, so no source assigned it: the earlier volume's run continues until the next begins.
        return fillGaps ? ranges.Last(r => r.Max < number).Volume : null;
    }
}
