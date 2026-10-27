using Maki.Api.Services;
using Maki.Core.Configuration;

namespace Maki.Api.Tests;

[Collection("Suwayomi environment")]
public class SuwayomiEnvImportTests : IDisposable
{
    private readonly FakeSettings _settings = new();

    public SuwayomiEnvImportTests()
    {
        Environment.SetEnvironmentVariable(SuwayomiSourceRefresher.BaseUrlVariable, "http://suwayomi:4567/");
        Environment.SetEnvironmentVariable(SuwayomiSourceRefresher.PublicUrlVariable, "http://192.168.1.107:4568");
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable(SuwayomiSourceRefresher.BaseUrlVariable, null);
        Environment.SetEnvironmentVariable(SuwayomiSourceRefresher.PublicUrlVariable, null);
    }

    [Fact]
    public async Task Imports_the_variables_once()
    {
        await SuwayomiSourceRefresher.ImportEnvironmentAsync(_settings, default);

        Assert.Equal("http://suwayomi:4567", await _settings.GetAsync(SettingKeys.SuwayomiUrl));
        Assert.Equal("http://192.168.1.107:4568", await _settings.GetAsync(SettingKeys.SuwayomiPublicUrl));

        // An admin turning the integration off must not have it come back on the next start.
        await _settings.SetAsync(SettingKeys.SuwayomiUrl, null);
        await SuwayomiSourceRefresher.ImportEnvironmentAsync(_settings, default);
        Assert.Null(await _settings.GetAsync(SettingKeys.SuwayomiUrl));
    }

    [Fact]
    public async Task A_stored_url_is_not_overwritten()
    {
        await _settings.SetAsync(SettingKeys.SuwayomiUrl, "http://other:4567");

        await SuwayomiSourceRefresher.ImportEnvironmentAsync(_settings, default);

        Assert.Equal("http://other:4567", await _settings.GetAsync(SettingKeys.SuwayomiUrl));
        Assert.Null(await _settings.GetAsync(SettingKeys.SuwayomiPublicUrl));
    }

    private sealed class FakeSettings : IAppSettings
    {
        private readonly Dictionary<string, string?> _values = [];

        public Task<string?> GetAsync(string key, CancellationToken ct = default) =>
            Task.FromResult(_values.GetValueOrDefault(key));

        public Task SetAsync(string key, string? value, CancellationToken ct = default)
        {
            _values[key] = value;
            return Task.CompletedTask;
        }
    }
}
