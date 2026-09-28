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
    /// A series is completed only when the reader has reached its last main release <em>and</em> the
    /// series is no longer running (completed, cancelled or on hiatus). Reaching the last main release
    /// of an ongoing series is up to date, never completed: trackers and the library used to call
    /// that completed, because a tracker's chapter total for a running series is just today's count.
    /// <para>
    /// "Main" means whole-numbered chapters. Specials (10.5, 12.1) are optional reading, so an unread
    /// omake must not keep a finished series reading as unfinished. A series with no numbered
    /// chapters at all has nothing to measure against and reads as <see cref="ReadingStatus.Reading"/>.
    /// </para>
    /// </summary>
    /// <param name="highestMainChapter">The highest whole chapter number the series lists.</param>
    /// <param name="highestReadMainChapter">The highest whole chapter number the reader has completed.</param>
    public static ReadingStatus For(SeriesStatus status, decimal? highestMainChapter, decimal? highestReadMainChapter)
    {
        if (highestMainChapter is not { } last || last <= 0 || highestReadMainChapter is not { } read || read < last)
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
