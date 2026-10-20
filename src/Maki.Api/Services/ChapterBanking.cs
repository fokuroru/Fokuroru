using Maki.Core.Configuration;
using Maki.Core.Reading;
using Maki.Data;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Services;

/// <summary>
/// New chapters for a reader who is up to date are downloaded but kept out of sight ("banked") until
/// <see cref="SettingKeys.ReadingBankPages"/> pages are waiting, so a single short chapter is not
/// read the moment it lands. Nothing here is stored per chapter apart from the release stamp:
/// whether a chapter is banked is worked out from the reader's history every time.
/// <para>
/// A series banks for a reader who has read something and whose only unread chapters are new
/// releases (<see cref="Maki.Core.Entities.Chapter.DiscoveredAt"/> set: sync first listed them after
/// the series already had chapters), all after their furthest read, none already released. A backlog
/// of older unread chapters means they are not caught up, and nothing is banked. The new releases
/// wanted or downloaded are the batch.
/// <see cref="BankReleaseService"/> stamps the batch once its pages add up.
/// </para>
/// </summary>
public static class ChapterBanking
{
    public const int DefaultPages = 100;

    /// <summary>The page threshold; 0 means banking is off.</summary>
    public static async Task<int> PagesAsync(IAppSettings settings, CancellationToken ct) =>
        int.TryParse(await settings.GetAsync(SettingKeys.ReadingBankPages, ct), out var pages) && pages >= 0
            ? pages
            : DefaultPages;

    public sealed record Row(
        int Id, decimal? Number, int? Volume, bool Wanted, bool HasFile, bool Released, bool Read, bool IsNew = true);

    /// <summary>The banked chapter ids of one series for one reader, from all of the series' chapters.</summary>
    public static HashSet<int> BankedIn(IReadOnlyList<Row> chapters)
    {
        // Read by number in any language, as the rest of the reading status code does.
        var readNumbers = chapters.Where(c => c.Read && c.Number is not null).Select(c => c.Number!.Value).ToHashSet();
        bool IsRead(Row c) => c.Read || (c.Number is { } n && readNumbers.Contains(n));

        var ordered = ChapterOrder.Sort(chapters, c => c.Number, c => c.Volume, c => c.Id);
        var furthest = ordered.FindLastIndex(IsRead);
        if (furthest < 0)
        {
            return [];
        }

        var unread = ordered
            .Select((c, index) => (Chapter: c, Index: index))
            .Where(x => !IsRead(x.Chapter) && (x.Chapter.Wanted || x.Chapter.HasFile))
            .ToList();
        if (unread.Count == 0 || unread.Any(x => x.Index < furthest || x.Chapter.Released || !x.Chapter.IsNew))
        {
            return [];
        }

        return unread.Select(x => x.Chapter.Id).ToHashSet();
    }

    /// <summary>
    /// Banked chapter ids per series for <paramref name="userId"/>, over <paramref name="seriesIds"/> or
    /// every series they have read. Empty while banking is off.
    /// </summary>
    public static async Task<Dictionary<int, HashSet<int>>> BankedAsync(
        MakiDbContext db, int userId, IReadOnlyCollection<int>? seriesIds, int pages, CancellationToken ct)
    {
        if (pages <= 0 || seriesIds is { Count: 0 })
        {
            return [];
        }

        var done = await db.ChapterProgress.IgnoreQueryFilters()
            .Where(p => p.UserId == userId && p.Completed && (seriesIds == null || seriesIds.Contains(p.SeriesId)))
            .Select(p => new { p.SeriesId, p.ChapterId })
            .ToListAsync(ct);
        if (done.Count == 0)
        {
            return [];
        }

        var readBySeries = done.GroupBy(p => p.SeriesId).ToDictionary(g => g.Key, g => g.Select(p => p.ChapterId).ToHashSet());
        var ids = readBySeries.Keys.ToList();
        var rows = (await db.Chapters.IgnoreQueryFilters()
                .Where(c => ids.Contains(c.SeriesId))
                .Select(c => new
                {
                    c.SeriesId, c.Id, c.Number, c.Volume, c.Wanted,
                    HasFile = c.ChapterFileId != null, Released = c.BankReleasedAt != null,
                    IsNew = c.DiscoveredAt != null,
                })
                .ToListAsync(ct))
            .GroupBy(c => c.SeriesId);

        var result = new Dictionary<int, HashSet<int>>();
        foreach (var series in rows)
        {
            var read = readBySeries[series.Key];
            var banked = BankedIn(series
                .Select(c => new Row(c.Id, c.Number, c.Volume, c.Wanted, c.HasFile, c.Released, read.Contains(c.Id), c.IsNew))
                .ToList());
            if (banked.Count > 0)
            {
                result[series.Key] = banked;
            }
        }

        return result;
    }

    /// <summary>Banked chapters per series for the current reader (every series they have read when <paramref name="seriesIds"/> is null).</summary>
    public static async Task<Dictionary<int, HashSet<int>>> BankedForCallerAsync(
        MakiDbContext db, IAppSettings? settings, IReadOnlyCollection<int>? seriesIds, CancellationToken ct) =>
        settings is null
            ? []
            : await BankedAsync(db, db.Scope.UserId, seriesIds, await PagesAsync(settings, ct), ct);

    /// <summary>
    /// Which of <paramref name="chapterIds"/> are banked for at least one reader of the series. Background
    /// work has no reader of its own, and an announcement would reach all of them.
    /// </summary>
    public static async Task<HashSet<int>> BankedForAnyoneAsync(
        MakiDbContext db, IAppSettings? settings, int seriesId, IReadOnlyCollection<int> chapterIds, CancellationToken ct)
    {
        var banked = new HashSet<int>();
        if (settings is null || chapterIds.Count == 0)
        {
            return banked;
        }

        var pages = await PagesAsync(settings, ct);
        if (pages <= 0)
        {
            return banked;
        }

        var readers = await db.ChapterProgress.IgnoreQueryFilters()
            .Where(p => p.SeriesId == seriesId && p.Completed).Select(p => p.UserId).Distinct().ToListAsync(ct);
        foreach (var userId in readers)
        {
            var mine = (await BankedAsync(db, userId, [seriesId], pages, ct)).GetValueOrDefault(seriesId);
            if (mine is not null)
            {
                banked.UnionWith(chapterIds.Where(mine.Contains));
            }
        }

        return banked;
    }

    /// <summary>The chapters of the series banked for the current reader, for request paths.</summary>
    public static async Task<HashSet<int>> BankedForCallerAsync(
        MakiDbContext db, IAppSettings settings, int seriesId, CancellationToken ct) =>
        (await BankedAsync(db, db.Scope.UserId, [seriesId], await PagesAsync(settings, ct), ct))
        .GetValueOrDefault(seriesId) ?? [];
}
