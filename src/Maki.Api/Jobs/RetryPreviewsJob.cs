using Maki.Api.Services;
using Maki.Core.Metadata;
using Maki.Metadata.MangaBaka;
using Quartz;

namespace Maki.Api.Jobs;

/// <summary>
/// Starts again the previews that did not finish: a failed one a day after it failed, and one a restart cut
/// off. A preview waits on slow sources, so a failure is not the end of the request. It stays wanted until it is
/// ready or someone deletes it.
/// </summary>
[DisallowConcurrentExecution]
public class RetryPreviewsJob(
    SeriesPreviewService previews,
    MangaBakaLocalStore store,
    ILogger<RetryPreviewsJob> logger) : IJob
{
    public async Task Execute(IJobExecutionContext context)
    {
        var ct = context.CancellationToken;
        var due = previews.DueForRetry();
        if (due.Count == 0 || !await store.IsAvailableAsync(ct))
        {
            return;
        }

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
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Could not restart the preview for MangaBaka {ProviderId}", providerId);
            }
        }
    }
}
