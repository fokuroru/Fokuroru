using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Maki.Api.Auth;

/// <summary>
/// Lets a device with no keyboard ask for a feed token. The device gets a short code to show, a signed-in
/// person approves it on the web, and the device collects the token once. Kept only in memory: a restart
/// drops every request, which is the safe direction to fail.
/// </summary>
public class DevicePairing(TimeProvider clock)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    private const int MaxPending = 10;
    private const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    private readonly ConcurrentDictionary<string, Request> requests = new();

    public record Request(string Id, string Secret, string Code, string Name, DateTimeOffset Created, DateTimeOffset Expires)
    {
        public string? Token { get; internal set; }
    }

    /// <summary>Null when too many requests are already waiting.</summary>
    public Request? Start(string? name)
    {
        Sweep();
        if (requests.Count >= MaxPending)
        {
            return null;
        }

        var code = new string(Enumerable.Range(0, 8).Select(_ => Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)]).ToArray());
        var now = clock.GetUtcNow();
        var clean = new string((name ?? string.Empty).Where(c => !char.IsControl(c)).Take(40).ToArray()).Trim();
        var request = new Request(
            Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(6)),
            Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24)),
            $"{code[..4]}-{code[4..]}",
            clean.Length == 0 ? "Device" : clean,
            now, now + Lifetime);
        requests[request.Id] = request;
        return request;
    }

    public IReadOnlyList<Request> Waiting()
    {
        Sweep();
        return [.. requests.Values.Where(r => r.Token is null).OrderBy(r => r.Created)];
    }

    public Request? Find(string id)
    {
        Sweep();
        return requests.GetValueOrDefault(id) is { Token: null } found ? found : null;
    }

    public bool Complete(string id, string token)
    {
        if (!requests.TryGetValue(id, out var request) || request.Token is not null)
        {
            return false;
        }

        request.Token = token;
        return true;
    }

    public bool Deny(string id) => requests.TryRemove(id, out _);

    /// <summary>The token once approved (and forgotten at that point), "pending" while waiting, null when unknown or expired.</summary>
    public (bool Known, string? Token) Poll(string secret)
    {
        Sweep();
        var request = requests.Values.FirstOrDefault(r =>
            CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(r.Secret), System.Text.Encoding.UTF8.GetBytes(secret)));
        if (request is null)
        {
            return (false, null);
        }

        if (request.Token is not null)
        {
            requests.TryRemove(request.Id, out _);
        }

        return (true, request.Token);
    }

    private void Sweep()
    {
        var now = clock.GetUtcNow();
        foreach (var (id, request) in requests)
        {
            if (request.Expires <= now)
            {
                requests.TryRemove(id, out _);
            }
        }
    }
}
