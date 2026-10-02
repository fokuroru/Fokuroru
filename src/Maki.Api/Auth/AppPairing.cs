using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Maki.Api.Auth;

/// <summary>
/// One-time codes a signed-in person shows as a QR code so the Android app can sign in as them without
/// typing a password. A code lives five minutes, works once, and is kept only in memory: a restart
/// invalidates every outstanding code, which is the safe direction to fail.
/// </summary>
public class AppPairing(TimeProvider clock)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(5);

    private const int MaxOutstanding = 200;

    private readonly ConcurrentDictionary<string, (int UserId, DateTimeOffset Expires)> codes = new();

    public (string Code, DateTimeOffset Expires) Create(int userId)
    {
        Sweep();
        if (codes.Count >= MaxOutstanding)
        {
            // Whoever is asking for this many has no use for the old ones; start clean rather than refuse.
            codes.Clear();
        }

        var code = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var expires = clock.GetUtcNow() + Lifetime;
        codes[code] = (userId, expires);
        return (code, expires);
    }

    /// <summary>The account the code was made for, or null when it is unknown, used or expired. Spent either way.</summary>
    public int? Redeem(string? code)
    {
        if (string.IsNullOrEmpty(code) || !codes.TryRemove(code, out var entry))
        {
            return null;
        }

        return entry.Expires > clock.GetUtcNow() ? entry.UserId : null;
    }

    private void Sweep()
    {
        var now = clock.GetUtcNow();
        foreach (var (code, entry) in codes)
        {
            if (entry.Expires <= now)
            {
                codes.TryRemove(code, out _);
            }
        }
    }
}
