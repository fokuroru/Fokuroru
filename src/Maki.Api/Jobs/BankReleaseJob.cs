using Maki.Api.Localization;
using Maki.Api.Services;
using Maki.Core.Configuration;
using Maki.Core.Inbox;
using Maki.Core.Notifications;
using Maki.Data;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace Maki.Api.Jobs;

/// <summary>
/// Lets banked chapters out (see <see cref="ChapterBanking"/>) once the downloaded ones add up to the
/// page threshold. A released batch is stamped, its discovery date moves to now so Home's rail of new
/// chapters shows it as the news it now is, and the notification that was held back goes out once.
/// </summary>
[DisallowConcurrentExecution]
public class BankReleaseJob(
    IServiceScopeFactory scopeFactory,
    NotificationService notifications,
    InboxService inbox,
    IMessageCatalog localizer,
    IUserLocaleResolver locales,
    TimeProvider time,
    ILogger<BankReleaseJob> logger) : IJob
{
    public async Task Execute(IJobExecutionContext context)
    {
        var ct = context.CancellationToken;
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MakiDbContext>();
        var pages = await ChapterBanking.PagesAsync(scope.ServiceProvider.GetRequiredService<IAppSettings>(), ct);
        if (pages <= 0)
        {
            return;
        }

        var reader = scope.ServiceProvider.GetRequiredService<ReaderService>();
        var userIds = await db.ChapterProgress.IgnoreQueryFilters()
            .Where(p => p.Completed).Select(p => p.UserId).Distinct().ToListAsync(ct);

        var released = new HashSet<int>();
        foreach (var userId in userIds)
        {
            foreach (var (seriesId, banked) in await ChapterBanking.BankedAsync(db, userId, null, pages, ct))
            {
                if (released.Contains(seriesId) || !await IsDueAsync(db, reader, banked, pages, ct))
                {
                    continue;
                }

                await ReleaseAsync(db, seriesId, banked, ct);
                released.Add(seriesId);
            }
        }
    }

    /// <summary>Whether the downloaded chapters of the batch hold enough pages, measuring any not yet measured.</summary>
    private static async Task<bool> IsDueAsync(
        MakiDbContext db, ReaderService reader, HashSet<int> banked, int pages, CancellationToken ct)
    {
        var chapters = await db.Chapters.Where(c => banked.Contains(c.Id) && c.ChapterFileId != null).ToListAsync(ct);
        var total = 0;
        var unmeasured = new List<int>();
        foreach (var chapter in chapters)
        {
            if (chapter.PageCount is { } known && chapter.PageCountKey is not null)
            {
                total += known;
            }
            else
            {
                unmeasured.Add(chapter.Id);
            }
        }

        if (unmeasured.Count > 0)
        {
            var slices = await reader.SlicesAsync(unmeasured, ct);
            foreach (var chapter in chapters.Where(c => slices.ContainsKey(c.Id)))
            {
                var slice = slices[chapter.Id];
                chapter.PageCount = slice.PageCount;
                chapter.PageCountKey = $"{slice.ChapterFileId}:{slice.ArchiveSize}";
                total += slice.PageCount;
            }

            await db.SaveChangesAsync(ct);
        }

        return total >= pages;
    }

    private async Task ReleaseAsync(MakiDbContext db, int seriesId, HashSet<int> banked, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var chapters = await db.Chapters.Where(c => banked.Contains(c.Id)).ToListAsync(ct);
        foreach (var chapter in chapters)
        {
            chapter.BankReleasedAt = now;
            if (chapter.DiscoveredAt is not null)
            {
                chapter.DiscoveredAt = now;
            }
        }

        await db.SaveChangesAsync(ct);
        logger.LogInformation("Series {SeriesId}: released {Count} banked chapter(s)", seriesId, chapters.Count);

        var series = await db.Series.IgnoreQueryFilters().Where(s => s.Id == seriesId)
            .Select(s => new { s.Title, s.RootFolderId }).FirstOrDefaultAsync(ct);
        if (series is null)
        {
            return;
        }

        var locale = await locales.DefaultAsync();
        notifications.Dispatch(NotificationEventType.NewChapterAvailable, new NotificationMessage(
            NotificationEventType.NewChapterAvailable,
            Title: localizer.GetFor(locale, "notify.chapters.available.title"),
            Body: localizer.GetFor(locale, "notify.chapters.available.body", new { series = series.Title, count = chapters.Count }),
            SeriesTitle: series.Title,
            SeriesId: seriesId));
        inbox.Raise(InboxEventType.NewChapterAvailable, new InboxMessage(
                Key: "inbox.chapters.available",
                Params: InboxMessage.Args(new { count = chapters.Count }),
                SeriesId: seriesId,
                Url: $"/series/{seriesId}"),
            InboxAudience.SeriesTrackers(seriesId, series.RootFolderId));
    }
}
