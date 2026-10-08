using Maki.Api.Configuration;
using Maki.Api.Services;
using Maki.Core.Configuration;
using Maki.Metadata.MangaBaka;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;

namespace Maki.Api.Tests;

/// <summary>The "check now" button works once per cooldown for the whole instance, whoever presses it.</summary>
[Collection(ConfigDirCollection.Name)]
public class PreviewRetryServiceTests : IDisposable
{
    private readonly string _configDir = Path.Combine(Path.GetTempPath(), "maki-retry-tests", Guid.NewGuid().ToString("N"));
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 10, 8, 12, 0, 0, TimeSpan.Zero));

    public void Dispose()
    {
        try
        {
            Directory.Delete(_configDir, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private PreviewRetryService Service()
    {
        var prior = Environment.GetEnvironmentVariable("MAKI_CONFIG_DIR");
        AppPaths paths;
        try
        {
            Environment.SetEnvironmentVariable("MAKI_CONFIG_DIR", _configDir);
            paths = new AppPaths();
        }
        finally
        {
            Environment.SetEnvironmentVariable("MAKI_CONFIG_DIR", prior);
        }

        var previews = new SeriesPreviewService(null!, null!, null!, null!, paths, NullLogger<SeriesPreviewService>.Instance);
        var store = new MangaBakaLocalStore(
            new MangaBakaDumpOptions("", Path.GetTempPath()), new FakeAppSettings(), NullLogger<MangaBakaLocalStore>.Instance);
        return new PreviewRetryService(previews, store, _time, NullLogger<PreviewRetryService>.Instance);
    }

    [Fact]
    public async Task A_second_press_inside_the_cooldown_starts_nothing_and_says_when_to_come_back()
    {
        var service = Service();

        var first = await service.CheckNowAsync(CancellationToken.None);
        _time.Advance(TimeSpan.FromMinutes(2));
        var second = await service.CheckNowAsync(CancellationToken.None);

        Assert.True(first.Started);
        Assert.False(second.Started);
        Assert.Equal(first.NextCheckAt, second.NextCheckAt);
        Assert.Equal(_time.GetUtcNow().UtcDateTime.AddMinutes(3), second.NextCheckAt);
    }

    [Fact]
    public async Task The_button_works_again_once_the_cooldown_has_passed()
    {
        var service = Service();
        await service.CheckNowAsync(CancellationToken.None);

        _time.Advance(PreviewRetryService.ManualCooldown + TimeSpan.FromSeconds(1));

        Assert.True((await service.CheckNowAsync(CancellationToken.None)).Started);
    }
}
