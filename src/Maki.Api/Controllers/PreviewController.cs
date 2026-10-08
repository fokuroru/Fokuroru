using Maki.Api.Localization;
using Maki.Api.Services;
using Maki.Core.Metadata;
using Maki.Core.Reading;
using Maki.Core.Security;
using Maki.Metadata.MangaBaka;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Controllers;

/// <summary>
/// Chapter 1 of a series that is not in the library, for the Discover detail card. Open to every
/// signed-in user, since a user who can only request series is exactly who needs a look first.
/// Reading here writes nothing: no progress, no stats, no series.
/// </summary>
[ApiController]
[Route("api/v1/preview")]
public class PreviewController(
    ILocalizer localizer,
    MangaBakaLocalStore store,
    SeriesPreviewService previews,
    ICurrentUser currentUser) : ControllerBase
{
    [HttpPost("{providerId:long}")]
    public async Task<IActionResult> Start(long providerId, CancellationToken ct)
    {
        if (!await store.IsAvailableAsync(ct))
        {
            return this.Fail(localizer, "error.recommendation.localDbUnavailable");
        }

        // The detail lookup leaves novels out, which is the "nothing to page through" check.
        var detail = await store.GetDetailAsync(providerId, ct);
        var metadata = detail is null ? null : await store.GetAsync(detail.ProviderId, ct);
        if (detail is null || metadata is null)
        {
            return NotFound();
        }

        // These are real pages off a real site, so the ceiling applies here even though the
        // detail card itself is just text.
        if (!ContentRating.Permits(detail.ContentRating, currentUser.MaxContentRating))
        {
            return this.Forbidden(localizer, "error.preview.contentRating");
        }

        return Ok(previews.Start(providerId, SeriesMetadataMapper.NewFromMetadata(metadata), currentUser.UserId, localizer));
    }

    /// <summary>
    /// Series whose first chapter is already downloaded as a preview, newest first, as the same cards the
    /// Discover rails use. Series the library already has are left out (the real chapters beat a sample),
    /// and so is anything above this caller's content ceiling.
    /// </summary>
    [HttpGet("cached")]
    public async Task<IActionResult> Cached([FromServices] Maki.Data.MakiDbContext db, CancellationToken ct)
    {
        var ids = previews.CachedProviders();
        if (ids.Count == 0 || !await store.IsAvailableAsync(ct))
        {
            return Ok(Array.Empty<object>());
        }

        var owned = (await db.Series.AsNoTracking().Where(s => s.MangaBakaId != null)
            .Select(s => (long)s.MangaBakaId!.Value).ToListAsync(ct)).ToHashSet();
        var wanted = ids.Where(id => !owned.Contains(id)).ToList();

        return Ok(await store.GetByIdsAsync(wanted, ContentRating.Allowed(currentUser.MaxContentRating), ct));
    }

    public record PendingPreviewDto(MangaBakaRecommendation Item, string Status, int Attempts, DateTime? RetryAt);

    /// <summary>
    /// Every series with a preview request still waiting: queued, downloading, or failed and due to be tried
    /// again shortly. Previews belong to the instance, so everyone sees the same list, held to their own
    /// content ceiling. Series already in the library are left out.
    /// </summary>
    [HttpGet("pending")]
    public async Task<IActionResult> Pending([FromServices] Maki.Data.MakiDbContext db, CancellationToken ct)
    {
        var pending = previews.Pending();
        if (pending.Count == 0 || !await store.IsAvailableAsync(ct))
        {
            return Ok(Array.Empty<PendingPreviewDto>());
        }

        var owned = (await db.Series.AsNoTracking().Where(s => s.MangaBakaId != null)
            .Select(s => (long)s.MangaBakaId!.Value).ToListAsync(ct)).ToHashSet();
        var wanted = pending.Where(p => !owned.Contains(p.ProviderId)).ToList();
        var cards = (await store.GetByIdsAsync(wanted.Select(p => p.ProviderId).ToList(),
            ContentRating.Allowed(currentUser.MaxContentRating), ct)).ToDictionary(c => c.ProviderId);

        return Ok(wanted
            .Where(p => cards.ContainsKey(p.ProviderId.ToString(System.Globalization.CultureInfo.InvariantCulture)))
            .Select(p => new PendingPreviewDto(
                cards[p.ProviderId.ToString(System.Globalization.CultureInfo.InvariantCulture)], p.Status, p.Attempts, p.RetryAt)));
    }

    /// <summary>When the "check now" button next works. Until then it answers with this time and starts nothing.</summary>
    [HttpGet("pending/check")]
    public IActionResult CheckStatus([FromServices] PreviewRetryService retry) =>
        Ok(new { nextCheckAt = retry.NextCheckAt });

    /// <summary>
    /// Tries every failed preview request again now instead of waiting for its turn. Limited to once every few
    /// minutes for the whole instance, whoever presses it, so it cannot be used to hammer the sources.
    /// </summary>
    [HttpPost("pending/check")]
    public async Task<IActionResult> CheckNow([FromServices] PreviewRetryService retry, CancellationToken ct) =>
        Ok(await retry.CheckNowAsync(ct));

    public record PreviewReadRequest(decimal ChapterNumber);

    /// <summary>
    /// Records that the caller read this chapter as a preview before adding the series: it ends up
    /// read and unwanted. A fresh add has no chapters yet, so the mark is kept and
    /// <see cref="PreviewReadPendingService"/> applies it when the sync brings the chapter in.
    /// </summary>
    [HttpPost("~/api/v1/series/{seriesId:int}/preview-read")]
    public async Task<IActionResult> MarkRead(
        int seriesId,
        PreviewReadRequest request,
        [FromServices] Maki.Data.MakiDbContext db,
        [FromServices] PreviewReadPendingService pending,
        CancellationToken ct)
    {
        if (!await db.Series.AnyAsync(s => s.Id == seriesId, ct))
        {
            return NotFound();
        }

        var state = await db.UserSeriesStates.FirstOrDefaultAsync(s => s.SeriesId == seriesId, ct);
        if (state is null)
        {
            state = new Maki.Data.Identity.UserSeriesState { SeriesId = seriesId };
            db.UserSeriesStates.Add(state);
        }

        state.PreviewReadPendingTo = (double)request.ChapterNumber;
        state.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await pending.ApplyAsync(seriesId, ct);
        return NoContent();
    }

    [HttpGet("{providerId:long}")]
    public IActionResult Get(long providerId) =>
        previews.Snapshot(providerId, currentUser.UserId, localizer) is { } snapshot ? Ok(snapshot) : NotFound();

    /// <summary>Deletes the downloaded pages of a preview, for everyone. The next preview downloads it again.</summary>
    [HttpDelete("{providerId:long}/files")]
    public IActionResult Discard(long providerId)
    {
        previews.Discard(providerId);
        return NoContent();
    }

    [HttpDelete("{providerId:long}")]
    public IActionResult Release(long providerId)
    {
        previews.Release(providerId, currentUser.UserId);
        return NoContent();
    }

    [HttpGet("{providerId:long}/page/{index:int}")]
    public IActionResult Page(long providerId, int index)
    {
        if (previews.PageFile(providerId, currentUser.UserId, index) is not { } path)
        {
            return NotFound();
        }

        // Cache-busted by the ?v= the client takes from the snapshot, which changes with the source.
        Response.Headers.CacheControl = "private, max-age=3600";
        return PhysicalFile(path, CbzReader.ContentType(path));
    }
}
