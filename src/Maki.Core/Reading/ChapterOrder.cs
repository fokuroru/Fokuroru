namespace Maki.Core.Reading;

/// <summary>
/// Reading order for a series' chapters: by number, one-shots last.
/// <para>
/// A chapter 0 that belongs to a volume other than the one chapter 1 is in is a volume-level
/// entry, not a prologue. MangaFire lists whole-volume uploads as "Ch. 0" titled "Volume 9", and
/// sorting by number alone put that at the very top of the series. Such a chapter sorts at the
/// start of its own volume instead.
/// </para>
/// </summary>
public static class ChapterOrder
{
    public static List<T> Sort<T>(
        IEnumerable<T> chapters, Func<T, decimal?> number, Func<T, int?> volume, Func<T, int> id)
    {
        var list = chapters as IReadOnlyCollection<T> ?? chapters.ToList();
        var volumeStart = list
            .Where(c => number(c) > 0 && volume(c) is not null)
            .GroupBy(c => volume(c)!.Value)
            .ToDictionary(g => g.Key, g => g.Min(c => number(c)!.Value));

        // The volume chapter 1 sits in. A chapter 0 inside it is that volume's prologue and goes first;
        // only a chapter 0 of some other volume is a volume-level entry.
        var firstVolume = list
            .Where(c => number(c) > 0 && volume(c) is not null)
            .OrderBy(c => number(c))
            .Select(c => volume(c))
            .FirstOrDefault();

        decimal SortNumber(T c) =>
            number(c) == 0 && volume(c) is { } v && v != firstVolume && volumeStart.TryGetValue(v, out var start)
                ? start
                : number(c)!.Value;

        return list
            .OrderBy(c => number(c) is null ? 1 : 0)
            .ThenBy(c => number(c) is null ? 0 : SortNumber(c))
            .ThenBy(c => number(c) == 0 ? 0 : 1)
            .ThenBy(c => volume(c))
            .ThenBy(id)
            .ToList();
    }
}
