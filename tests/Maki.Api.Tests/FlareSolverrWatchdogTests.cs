using System.Net;
using Maki.Api.Services;
using Maki.Core.Configuration;
using Maki.Core.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;

namespace Maki.Api.Tests;

/// <summary>
/// FlareSolverr that answers its landing page but cannot start Chrome gets restarted, after two failed probes and
/// no more than once per cooldown, and only when a restart proxy has been configured.
/// </summary>
[Collection(ConfigDirCollection.Name)]
public class FlareSolverrWatchdogTests : IDisposable
{
    private const string BrokenBody = """{"status":"error","message":"Error solving the challenge. Message: session not created"}""";
    private const string HealthyBody = """{"status":"ok","message":"Session created successfully."}""";

    private readonly Router _router = new();
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 10, 8, 12, 0, 0, TimeSpan.Zero));

    public FlareSolverrWatchdogTests()
    {
        Environment.SetEnvironmentVariable(FlareSolverrWatchdog.RestartUrlVariable, "http://restarter:2375");
        Environment.SetEnvironmentVariable(FlareSolverrWatchdog.ContainerVariable, null);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable(FlareSolverrWatchdog.RestartUrlVariable, null);
        Environment.SetEnvironmentVariable(FlareSolverrWatchdog.ContainerVariable, null);
    }

    private FlareSolverrWatchdog Watchdog(string flareUrl = "http://flaresolverr:8191")
    {
        var factory = new RouterFactory(_router);
        return new FlareSolverrWatchdog(
            new FlareSolverrClient(factory),
            new FakeAppSettings().Set(SettingKeys.FlareSolverrUrl, flareUrl),
            factory,
            _time,
            NullLogger<FlareSolverrWatchdog>.Instance);
    }

    [Fact]
    public async Task One_failed_probe_is_not_enough_to_restart()
    {
        _router.FlareBody = BrokenBody;
        var watchdog = Watchdog();

        await watchdog.CheckAsync(CancellationToken.None);

        Assert.Empty(_router.Restarts);
    }

    [Fact]
    public async Task Two_failed_probes_in_a_row_restart_the_container()
    {
        _router.FlareBody = BrokenBody;
        var watchdog = Watchdog();

        await watchdog.CheckAsync(CancellationToken.None);
        await watchdog.CheckAsync(CancellationToken.None);

        Assert.Equal(["http://restarter:2375/containers/flaresolverr/restart?t=10"], _router.Restarts);
    }

    [Fact]
    public async Task A_healthy_probe_in_between_resets_the_count()
    {
        var watchdog = Watchdog();
        _router.FlareBody = BrokenBody;
        await watchdog.CheckAsync(CancellationToken.None);
        _router.FlareBody = HealthyBody;
        await watchdog.CheckAsync(CancellationToken.None);
        _router.FlareBody = BrokenBody;
        await watchdog.CheckAsync(CancellationToken.None);

        Assert.Empty(_router.Restarts);
    }

    [Fact]
    public async Task A_container_that_stays_broken_is_not_restarted_again_inside_the_cooldown()
    {
        _router.FlareBody = BrokenBody;
        var watchdog = Watchdog();
        await watchdog.CheckAsync(CancellationToken.None);
        await watchdog.CheckAsync(CancellationToken.None);

        for (var i = 0; i < 4; i++)
        {
            _time.Advance(TimeSpan.FromMinutes(3));
            await watchdog.CheckAsync(CancellationToken.None);
        }

        Assert.Single(_router.Restarts);

        _time.Advance(FlareSolverrWatchdog.RestartCooldown);
        await watchdog.CheckAsync(CancellationToken.None);
        await watchdog.CheckAsync(CancellationToken.None);

        Assert.Equal(2, _router.Restarts.Count);
    }

    [Fact]
    public async Task Nothing_is_restarted_without_a_restart_proxy()
    {
        Environment.SetEnvironmentVariable(FlareSolverrWatchdog.RestartUrlVariable, null);
        _router.FlareBody = BrokenBody;
        var watchdog = Watchdog();

        await watchdog.CheckAsync(CancellationToken.None);
        await watchdog.CheckAsync(CancellationToken.None);
        await watchdog.CheckAsync(CancellationToken.None);

        Assert.Empty(_router.Restarts);
    }

    [Fact]
    public async Task A_named_container_is_the_one_restarted()
    {
        Environment.SetEnvironmentVariable(FlareSolverrWatchdog.ContainerVariable, "fs 2");
        _router.FlareBody = BrokenBody;
        var watchdog = Watchdog();

        await watchdog.CheckAsync(CancellationToken.None);
        await watchdog.CheckAsync(CancellationToken.None);

        Assert.Equal(["http://restarter:2375/containers/fs%202/restart?t=10"], _router.Restarts);
    }

    [Fact]
    public async Task A_hanging_probe_counts_as_failed()
    {
        _router.FlareStatus = HttpStatusCode.InternalServerError;
        _router.FlareBody = "";
        var watchdog = Watchdog();

        await watchdog.CheckAsync(CancellationToken.None);
        await watchdog.CheckAsync(CancellationToken.None);

        Assert.Single(_router.Restarts);
    }

    private sealed class Router
    {
        public string FlareBody { get; set; } = HealthyBody;
        public HttpStatusCode FlareStatus { get; set; } = HttpStatusCode.OK;
        public List<string> Restarts { get; } = [];
    }

    private sealed class RouterFactory(Router router) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new Handler(router));

        private sealed class Handler(Router router) : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                var uri = request.RequestUri!;
                if (uri.Host == "restarter")
                {
                    router.Restarts.Add(uri.OriginalString);
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent));
                }

                return Task.FromResult(new HttpResponseMessage(router.FlareStatus) { Content = new StringContent(router.FlareBody) });
            }
        }
    }
}
