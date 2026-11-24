using Maki.Api.Auth;
using Maki.Api.Services;
using Maki.Core.Configuration;
using Maki.Core.Security;
using Maki.Data;
using Maki.Data.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Maki.Api.Controllers;

public record DevicePairStart(string? Name);

public record PendingDevice(string Id, string Code, string Name, DateTimeOffset RequestedAt);

/// <summary>
/// The device side of quick connect. Lives under the OPDS prefix because that is the one path the
/// reverse proxy lets through without a browser sign-in, which a Kindle cannot do.
/// </summary>
[ApiController]
[Route("api/v1/opds/pair")]
[AllowAnonymous]
public class DevicePairingController(DevicePairing pairing) : ControllerBase
{
    [HttpPost("start")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public IActionResult Start([FromBody] DevicePairStart? request)
    {
        if (pairing.Start(request?.Name) is not { } started)
        {
            return StatusCode(StatusCodes.Status429TooManyRequests);
        }

        return Ok(new { secret = started.Secret, code = started.Code, expiresIn = (int)DevicePairing.Lifetime.TotalSeconds });
    }

    /// <summary>202 while waiting, 200 with the feed path once approved (once only), 404 when unknown or expired.</summary>
    [HttpGet("poll")]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public IActionResult Poll([FromQuery] string? secret)
    {
        var (known, token) = pairing.Poll(secret ?? string.Empty);
        if (!known)
        {
            return NotFound();
        }

        return token is null ? Accepted() : Ok(new { path = $"/api/v1/opds/{token}" });
    }
}

/// <summary>The signed-in side: see what is waiting, approve it or turn it away.</summary>
[ApiController]
[Route("api/v1/device-pairing")]
[Authorize(Policy = Policies.UseOpds)]
public class DevicePairingApprovalController(
    DevicePairing pairing,
    MakiDbContext db,
    ICurrentUser currentUser,
    IUserSettings userSettings,
    TimeProvider clock) : ControllerBase
{
    [HttpGet("pending")]
    public IActionResult Pending() =>
        Ok(pairing.Waiting().Select(r => new PendingDevice(r.Id, r.Code, r.Name, r.Created)));

    [HttpPost("{id}/approve")]
    public async Task<IActionResult> Approve(string id, CancellationToken ct)
    {
        if (pairing.Find(id) is not { } request)
        {
            return NotFound();
        }

        var secret = ApiKeyCrypto.Generate();
        db.UserApiKeys.Add(new UserApiKey
        {
            UserId = currentUser.UserId,
            Name = request.Name,
            KeyHash = ApiKeyCrypto.Hash(secret),
            Prefix = ApiKeyCrypto.Prefix(secret),
            Scope = UserApiKeyScope.Device,
            CreatedAt = clock.GetUtcNow().UtcDateTime
        });
        await db.SaveChangesAsync(ct);

        // Approving a device is asking for it to read, so the catalogue has to be on for this user.
        await userSettings.SetAsync(SettingKeys.OpdsEnabled, "true", ct);
        OpdsAccessService.EvictUser(currentUser.UserId);

        return pairing.Complete(id, secret) ? NoContent() : NotFound();
    }

    [HttpDelete("{id}")]
    public IActionResult Deny(string id) => pairing.Deny(id) ? NoContent() : NotFound();
}
