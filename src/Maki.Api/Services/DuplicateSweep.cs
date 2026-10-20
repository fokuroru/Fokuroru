using System.Collections.Concurrent;

namespace Maki.Api.Services;

/// <summary>
/// Series waiting for a duplicate check, plus where the slow walk over the whole library has got to. An import
/// asks for its series to be looked at; <c>DuplicateSweepJob</c> works through the requests, and the walk
/// covers everything else a few series at a time so no run hashes more than a couple of volumes.
/// </summary>
public sealed class DuplicateSweep
{
    private readonly ConcurrentDictionary<int, byte> _requested = new();

    /// <summary>The last series the walk examined; it wraps to the start after the last one.</summary>
    public int Cursor { get; set; }

    public void Request(int seriesId) => _requested[seriesId] = 0;

    public List<int> Take(int max)
    {
        var ids = _requested.Keys.Take(max).ToList();
        foreach (var id in ids)
        {
            _requested.TryRemove(id, out _);
        }

        return ids;
    }
}
