using Maki.Api.Localization;
using Maki.Api.Services;
using Maki.Core.Configuration;
using Microsoft.AspNetCore.Mvc;

namespace Maki.Api.Controllers;

/// <summary>
/// The caller's own reader tap zones. They live in the caller's <c>UserSettings</c>, so there is nothing
/// to authorize beyond being signed in. Kept apart for the Android app and for browsers: <c>client</c> is
/// <c>app</c> or <c>web</c>.
/// </summary>
[ApiController]
[Route("api/v1/reader/tap-zones")]
public class ReaderTapZonesController(IUserSettings userSettings, ILocalizer localizer) : ControllerBase
{
    private static string? KeyFor(string client) => client switch
    {
        "app" => SettingKeys.ReaderTapZonesApp,
        "web" => SettingKeys.ReaderTapZonesWeb,
        _ => null,
    };

    [HttpGet("{client}")]
    public async Task<IActionResult> Get(string client, CancellationToken ct)
    {
        if (KeyFor(client) is not { } key)
        {
            return NotFound();
        }

        return Ok(TapZoneDocuments.Parse(await userSettings.GetAsync(key, ct)));
    }

    [HttpPut("{client}")]
    public async Task<IActionResult> Put(string client, [FromBody] TapZoneDocument request, CancellationToken ct)
    {
        if (KeyFor(client) is not { } key)
        {
            return NotFound();
        }

        if (TapZoneDocuments.Tidy(request) is not { } tidied)
        {
            return this.Fail(localizer, "error.tapZones.invalid");
        }

        await userSettings.SetAsync(key, TapZoneDocuments.Serialize(tidied), ct);
        return Ok(tidied);
    }
}
