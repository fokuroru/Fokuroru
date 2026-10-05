using Maki.Data;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Services;

/// <summary>
/// Finishes a "I read this chapter as a preview" that was recorded before the series had chapters,
/// which is every add from a preview: source matching runs after the add returns.
/// <see cref="ChapterSyncService"/> calls this once it has written new chapters, and each reader with
/// a pending mark gets that chapter marked read and unwanted in their own scope, so it is neither
/// offered as unread nor downloaded again.
/// </summary>
public class PreviewReadPendingService(IServiceScopeFactory scopes, ILogger<PreviewReadPendingService> logger)
{
    public async Task ApplyAsync(int seriesId, CancellationToken ct)
    {
        List<(int UserId, double Number)> pending;
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MakiDbContext>();
            pending = (await db.UserSeriesStates.IgnoreQueryFilters().AsNoTracking()
                    .Where(s => s.SeriesId == seriesId && s.PreviewReadPendingTo != null)
                    .Select(s => new { s.UserId, s.PreviewReadPendingTo })
                    .ToListAsync(ct))
                .Select(s => (s.UserId, s.PreviewReadPendingTo!.Value))
                .ToList();
        }

        foreach (var (userId, number) in pending)
        {
            try
            {
                await ApplyForUserAsync(seriesId, userId, (decimal)number, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Could not apply the pending preview read mark on series {SeriesId} for user {UserId}",
                    seriesId, userId);
            }
        }
    }

    private async Task ApplyForUserAsync(int seriesId, int userId, decimal number, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MakiDbContext>();
        db.Scope.SetUser(userId, allRootFolders: true);

        // In memory: Chapter.Number is REAL and EF's SQLite provider cannot compare decimals.
        var chapterIds = (await db.Chapters.AsNoTracking()
                .Where(c => c.SeriesId == seriesId && c.Number != null)
                .Select(c => new { c.Id, c.Number })
                .ToListAsync(ct))
            .Where(c => c.Number == number)
            .Select(c => c.Id)
            .ToList();

        // Kept while the chapter has not turned up: a later sync may bring it, and clearing now
        // would drop the reader's mark.
        if (chapterIds.Count == 0)
        {
            return;
        }

        await scope.ServiceProvider.GetRequiredService<ReaderService>().MarkReadAsync(chapterIds, ct, markUnwanted: true);

        var state = await db.UserSeriesStates.FirstAsync(s => s.SeriesId == seriesId, ct);
        state.PreviewReadPendingTo = null;
        state.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }
}
