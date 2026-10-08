using Maki.Core.Metadata;
using Maki.Metadata.MangaBaka;

namespace Maki.Api.Services;

/// <summary>When the next manual check may run, and how many previews the last one started again.</summary>
public record PreviewCheckResult(bool Started, int Restarted, DateTime NextCheckAt);

/// <summary>
/// Starts again the previews that did not finish. The timer job calls <see cref="RunDueAsync"/> for the ones
/// whose retry time has come; <see cref="CheckNowAsync"/> is the button, which brings every failed one forward
/// but only once per <see cref="ManualCooldown"/>, so pressing it repeatedly cannot hammer the sources.
/// A source that is rate limited still sits out its own cooldown, which the preview checks before it asks.
/// </summary>
public sealed class PreviewRetryService(
    SeriesPreviewService previews,
    MangaBakaLocalStore store,
    TimeProvider time,
    ILogger<PreviewRetryService> logger)
{
    public static readonly TimeSpan ManualCooldown = TimeSpan.FromMinutes(5);

    private readonly object _sync = new();
    private DateTime _lastManual = DateTime.MinValue;

    public DateTime NextCheckAt
    {
        get
        {
            lock (_sync)
            {
                return _lastManual + ManualCooldown;
            }
        }
    }

    public async Task<int> RunDueAsync(CancellationToken ct)
    {
        var due = previews.DueForRetry();
        if (due.Count == 0 || !await store.IsAvailableAsync(ct))
        {
            return 0;
        }

        var restarted = 0;
        foreach (var providerId in due)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var detail = await store.GetDetailAsync(providerId, ct);
                var metadata = detail is null ? null : await store.GetAsync(detail.ProviderId, ct);
                if (metadata is null)
                {
                    previews.GiveUp(providerId);
                    continue;
                }

                previews.Resume(providerId, SeriesMetadataMapper.NewFromMetadata(metadata));
                restarted++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Could not restart the preview for MangaBaka {ProviderId}", providerId);
            }
        }

        return restarted;
    }

    public async Task<PreviewCheckResult> CheckNowAsync(CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        lock (_sync)
        {
            if (now < _lastManual + ManualCooldown)
            {
                return new PreviewCheckResult(false, 0, _lastManual + ManualCooldown);
            }

            _lastManual = now;
        }

        previews.MakeAllDue();
        var restarted = await RunDueAsync(ct);
        return new PreviewCheckResult(true, restarted, now + ManualCooldown);
    }
}
