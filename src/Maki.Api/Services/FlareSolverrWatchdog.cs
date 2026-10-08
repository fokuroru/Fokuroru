using Maki.Core.Configuration;
using Maki.Core.Http;

namespace Maki.Api.Services;

/// <summary>
/// Notices when FlareSolverr can no longer start a browser and restarts its container.
/// <para>
/// FlareSolverr stays up when this happens: it still answers, then every solve spends over a minute failing
/// to launch Chrome and returns 500. Sources behind it stall instead of failing fast, and a preview's search
/// phase runs out its deadline before the sources that work are tried. A restart clears it, and nothing else
/// will, so the watchdog asks Docker for one.
/// </para>
/// <para>
/// Docker is reached through a restart-only socket proxy named by <c>MAKI_FLARESOLVERR_RESTART_URL</c>
/// (for example <c>http://docker-restarter:2375</c>), never the socket itself. Without that variable the
/// watchdog still probes and logs, and acts on nothing. Two failed probes in a row are required, and
/// restarts are spaced by <see cref="RestartCooldown"/>, so a flaky probe or a container that stays broken
/// cannot turn into a restart loop.
/// </para>
/// </summary>
public sealed class FlareSolverrWatchdog(
    FlareSolverrClient flare,
    IAppSettings settings,
    IHttpClientFactory httpClients,
    TimeProvider time,
    ILogger<FlareSolverrWatchdog> logger)
{
    public const string HttpClientName = "flaresolverr-restart";
    public const string RestartUrlVariable = "MAKI_FLARESOLVERR_RESTART_URL";
    public const string ContainerVariable = "MAKI_FLARESOLVERR_CONTAINER";

    private const string DefaultContainer = "flaresolverr";

    internal const int FailuresBeforeRestart = 2;
    internal static readonly TimeSpan RestartCooldown = TimeSpan.FromMinutes(20);

    private readonly object _sync = new();
    private int _failures;
    private DateTime _lastRestart = DateTime.MinValue;

    public async Task CheckAsync(CancellationToken ct)
    {
        var url = await settings.GetAsync(SettingKeys.FlareSolverrUrl, ct);
        if (string.IsNullOrWhiteSpace(url))
        {
            return;
        }

        var probe = await flare.ProbeBrowserAsync(url, ct);
        if (probe.Ok)
        {
            lock (_sync)
            {
                if (_failures > 0)
                {
                    logger.LogInformation("FlareSolverr can start its browser again");
                }

                _failures = 0;
            }

            return;
        }

        var restartUrl = Environment.GetEnvironmentVariable(RestartUrlVariable);
        var container = Environment.GetEnvironmentVariable(ContainerVariable) is { Length: > 0 } named ? named : DefaultContainer;
        var now = time.GetUtcNow().UtcDateTime;
        bool restart;
        lock (_sync)
        {
            _failures++;
            logger.LogWarning("FlareSolverr could not start a browser ({Failures} in a row): {Error}", _failures, probe.Error);
            restart = _failures >= FailuresBeforeRestart
                && !string.IsNullOrWhiteSpace(restartUrl)
                && now - _lastRestart >= RestartCooldown;
            if (restart)
            {
                _lastRestart = now;
                _failures = 0;
            }
        }

        if (string.IsNullOrWhiteSpace(restartUrl) && _failures >= FailuresBeforeRestart)
        {
            logger.LogWarning("FlareSolverr needs a restart, but {Variable} is not set so none will be requested", RestartUrlVariable);
            return;
        }

        if (restart)
        {
            await RestartAsync(restartUrl!, container, ct);
        }
    }

    private async Task RestartAsync(string restartUrl, string container, CancellationToken ct)
    {
        try
        {
            var client = httpClients.CreateClient(HttpClientName);
            var endpoint = $"{restartUrl.TrimEnd('/')}/containers/{Uri.EscapeDataString(container)}/restart?t=10";
            using var response = await client.PostAsync(endpoint, content: null, ct);
            if (response.IsSuccessStatusCode)
            {
                logger.LogWarning("Restarted the {Container} container because FlareSolverr could not start a browser", container);
            }
            else
            {
                logger.LogWarning("Docker refused to restart {Container}: {Status}", container, (int)response.StatusCode);
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Could not ask Docker to restart {Container}", container);
        }
    }
}
