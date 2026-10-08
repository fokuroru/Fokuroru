using Maki.Api.Services;
using Quartz;

namespace Maki.Api.Jobs;

/// <summary>
/// Starts again the previews that did not finish: a failed one half an hour after it failed, and one a restart
/// cut off. A preview waits on slow sources, so a failure is not the end of the request. It stays wanted until it
/// is ready or someone deletes it.
/// </summary>
[DisallowConcurrentExecution]
public class RetryPreviewsJob(PreviewRetryService retry) : IJob
{
    public Task Execute(IJobExecutionContext context) => retry.RunDueAsync(context.CancellationToken);
}
