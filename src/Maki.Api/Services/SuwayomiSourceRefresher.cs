using Maki.Sources.Suwayomi;

namespace Maki.Api.Services;

/// <summary>
/// Keeps <see cref="SuwayomiSourceProvider"/> in step with the extensions installed in Suwayomi, which
/// change in its own UI while Maki runs. The first read is awaited (briefly) before the host starts
/// serving, so the sources are there for the first request; after that it is a slow poll.
/// </summary>
public class SuwayomiSourceRefresher(SuwayomiSourceProvider provider) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan FirstReadBudget = TimeSpan.FromSeconds(10);

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        if (SuwayomiClient.Configured)
        {
            using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            budget.CancelAfter(FirstReadBudget);
            await provider.RefreshAsync(budget.Token);
        }

        await base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!SuwayomiClient.Configured)
        {
            return;
        }

        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await provider.RefreshAsync(stoppingToken);
        }
    }
}
