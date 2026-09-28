namespace Maki.Core.Entities;

/// <summary>Where a reader stands against a whole series, as opposed to against what is downloaded.</summary>
public enum ReadingStatus
{
    /// <summary>Main releases remain unread.</summary>
    Reading,

    /// <summary>Every main release read, and the series is still coming out: more will follow.</summary>
    UpToDate,

    /// <summary>Every main release read, and the series has ended or is on hiatus.</summary>
    Completed,
}

public static class ReadingStatuses
{
    /// <summary>
    /// A series is completed only when the reader has read every main release <em>and</em> the series
    /// is no longer running (completed, cancelled or on hiatus). Every main release read on an
    /// ongoing series is up to date, never completed: trackers and the library used to call that
    /// completed, because a tracker's chapter total for a running series is just today's count.
    /// <para>
    /// Judged per release, not by the highest number read: reading only the last chapter, or
    /// marking a middle one unread again, leaves the series reading. "Main" means whole-numbered
    /// chapters; specials (10.5, 12.1) are optional, so an unread omake does not hold a finished
    /// series back. A release counts as read when any of its rows is, so a second language's copy of
    /// the same chapter never has to be read twice. A series with no numbered chapters has nothing
    /// to measure against and reads as <see cref="ReadingStatus.Reading"/>.
    /// </para>
    /// </summary>
    /// <param name="mainReleases">Every whole chapter number the series lists.</param>
    /// <param name="readReleases">The chapter numbers the reader has completed, in any language.</param>
    public static ReadingStatus For(SeriesStatus status, IReadOnlyCollection<decimal> mainReleases, IReadOnlySet<decimal> readReleases)
    {
        if (mainReleases.Count == 0 || mainReleases.Any(n => !readReleases.Contains(n)))
        {
            return ReadingStatus.Reading;
        }

        return Ended(status) ? ReadingStatus.Completed : ReadingStatus.UpToDate;
    }

    /// <summary>Completed, cancelled or on hiatus: nothing new is expected soon.</summary>
    public static bool Ended(SeriesStatus status) =>
        status is SeriesStatus.Completed or SeriesStatus.Cancelled or SeriesStatus.Hiatus;

    public static bool IsMain(decimal? number) => number is { } n && n > 0 && n % 1 == 0;
}
