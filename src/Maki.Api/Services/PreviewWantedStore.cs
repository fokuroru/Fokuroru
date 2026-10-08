using System.Text.Json;

namespace Maki.Api.Services;

/// <summary>
/// The previews somebody asked for that have not finished, kept in a file next to the preview folders so a
/// restart does not lose the queue. An entry leaves when its preview is ready or is deleted. A preview that
/// fails stays and is tried again half an hour later, as often as it takes.
/// </summary>
internal sealed class PreviewWantedStore(string path, TimeProvider time, ILogger? logger = null)
{
    internal static readonly TimeSpan RetryAfter = TimeSpan.FromMinutes(30);

    internal sealed record Entry(long ProviderId, int Attempts, DateTime? RetryAt);

    private readonly object _sync = new();
    private Dictionary<long, Entry>? _entries;

    /// <summary>Records a request. An entry already there keeps its attempts and has its retry time cleared, since it is running again.</summary>
    public void Want(long providerId)
    {
        lock (_sync)
        {
            var entries = Load();
            entries[providerId] = new Entry(providerId, entries.TryGetValue(providerId, out var old) ? old.Attempts : 0, null);
            Save();
        }
    }

    public void Remove(long providerId)
    {
        lock (_sync)
        {
            if (Load().Remove(providerId))
            {
                Save();
            }
        }
    }

    /// <summary>A failed attempt: due again after <see cref="RetryAfter"/>. Does nothing for a preview nobody wants any more.</summary>
    public void Failed(long providerId)
    {
        lock (_sync)
        {
            if (Load().TryGetValue(providerId, out var old))
            {
                _entries![providerId] = new Entry(providerId, old.Attempts + 1, time.GetUtcNow().UtcDateTime + RetryAfter);
                Save();
            }
        }
    }

    /// <summary>
    /// Previews to start again: those whose retry time has passed, and those with no retry time that nothing
    /// is running for, which is what a restart leaves behind.
    /// </summary>
    /// <summary>Makes every failed entry due now, for a manual check. Returns how many were brought forward.</summary>
    public int MakeDue()
    {
        lock (_sync)
        {
            var now = time.GetUtcNow().UtcDateTime;
            var brought = 0;
            foreach (var entry in Load().Values.Where(e => e.RetryAt > now).ToList())
            {
                _entries![entry.ProviderId] = entry with { RetryAt = now };
                brought++;
            }

            if (brought > 0)
            {
                Save();
            }

            return brought;
        }
    }

    public IReadOnlyList<long> Due(Func<long, bool> isActive)
    {
        lock (_sync)
        {
            var now = time.GetUtcNow().UtcDateTime;
            return Load().Values
                .Where(e => e.RetryAt is { } at ? at <= now : !isActive(e.ProviderId))
                .Select(e => e.ProviderId)
                .ToList();
        }
    }

    public IReadOnlyList<Entry> All()
    {
        lock (_sync)
        {
            return Load().Values.OrderBy(e => e.ProviderId).ToList();
        }
    }

    public Entry? Get(long providerId)
    {
        lock (_sync)
        {
            return Load().GetValueOrDefault(providerId);
        }
    }

    private Dictionary<long, Entry> Load()
    {
        if (_entries is not null)
        {
            return _entries;
        }

        try
        {
            // An entry saved under the old one-day window would otherwise sit out the rest of it.
            var latest = time.GetUtcNow().UtcDateTime + RetryAfter;
            _entries = File.Exists(path)
                ? (JsonSerializer.Deserialize<List<Entry>>(File.ReadAllText(path)) ?? [])
                    .Select(e => e.RetryAt > latest ? e with { RetryAt = latest } : e)
                    .ToDictionary(e => e.ProviderId)
                : [];
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            logger?.LogWarning(ex, "Could not read the wanted previews list; starting empty");
            _entries = [];
        }

        return _entries;
    }

    private void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temp = path + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(_entries!.Values.ToList()));
            File.Move(temp, path, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger?.LogWarning(ex, "Could not save the wanted previews list");
        }
    }
}
