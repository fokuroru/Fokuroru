using Maki.Core.Configuration;
using Maki.Sources.Suwayomi;

namespace Maki.Api.Services;

/// <summary>
/// Brings an install that configured Suwayomi through the old environment variables onto the
/// settings, then keeps the stored source list in step with Suwayomi: once before the host starts
/// serving (briefly awaited, so existing mappings find their sources) and then on a slow poll,
/// since extensions are installed in Suwayomi's own UI.
/// </summary>
public class SuwayomiSourceRefresher(IServiceScopeFactory scopes, ILogger<SuwayomiSourceRefresher> logger) : BackgroundService
{
    public const string BaseUrlVariable = "MAKI_SOURCE_SUWAYOMI_BASEURL";
    public const string PublicUrlVariable = "MAKI_SOURCE_SUWAYOMI_PUBLICURL";

    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan FirstReadBudget = TimeSpan.FromSeconds(10);

    /// <summary>
    /// Copies the variables into the settings once, and only while no URL is stored. The marker keeps
    /// an admin who later clears the URL from having it come back on the next restart.
    /// </summary>
    public static async Task ImportEnvironmentAsync(IAppSettings settings, CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(await settings.GetAsync(SettingKeys.SuwayomiEnvImported, ct)))
        {
            return;
        }

        if (Environment.GetEnvironmentVariable(BaseUrlVariable) is { } url &&
            SuwayomiSettings.TryParseBaseUri(url, out var baseUri))
        {
            if (!SuwayomiSettings.TryParseBaseUri(await settings.GetAsync(SettingKeys.SuwayomiUrl, ct), out _))
            {
                await settings.SetAsync(SettingKeys.SuwayomiUrl, baseUri.ToString().TrimEnd('/'), ct);
                if (Environment.GetEnvironmentVariable(PublicUrlVariable) is { } publicUrl &&
                    SuwayomiSettings.TryParseBaseUri(publicUrl, out var publicUri))
                {
                    await settings.SetAsync(SettingKeys.SuwayomiPublicUrl, publicUri.ToString().TrimEnd('/'), ct);
                }
            }

            await settings.SetAsync(SettingKeys.SuwayomiEnvImported, "true", ct);
        }
    }

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(FirstReadBudget);
        await RefreshAsync(budget.Token);
        await base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RefreshAsync(stoppingToken);
        }
    }

    private async Task RefreshAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            if (await scope.ServiceProvider.GetRequiredService<SuwayomiSettings>().GetAsync(ct) is null)
            {
                return;
            }

            await scope.ServiceProvider.GetRequiredService<SuwayomiSnapshotService>().RefreshAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // Unreachable at startup is routine; the stored list keeps serving until the next poll.
            logger.LogWarning("Could not list the Suwayomi sources, keeping the stored list: {Message}", ex.Message);
        }
    }
}
