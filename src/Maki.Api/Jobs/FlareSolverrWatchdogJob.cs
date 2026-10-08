using Maki.Api.Services;
using Quartz;

namespace Maki.Api.Jobs;

[DisallowConcurrentExecution]
public class FlareSolverrWatchdogJob(FlareSolverrWatchdog watchdog) : IJob
{
    public Task Execute(IJobExecutionContext context) => watchdog.CheckAsync(context.CancellationToken);
}
