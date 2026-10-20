using System.Collections.Concurrent;
using Maki.Api.Services;
using Xunit;

namespace Maki.Api.Tests;

public class DownloadClaimOrderTests
{
    private static DownloadQueueService.ClaimCandidate C(int id, int series, int sort, decimal? chapter) =>
        new(id, series, sort, chapter, null);

    [Fact]
    public void Alternates_between_series_and_keeps_chapter_order_within_each()
    {
        // Series 1 was queued first, in a shuffled order; series 2 came later.
        var window = new List<DownloadQueueService.ClaimCandidate>
        {
            C(1, 1, 1, 3), C(2, 1, 2, 1), C(3, 1, 3, 2), C(4, 2, 4, 10), C(5, 2, 5, 11),
        };
        var lastClaim = new ConcurrentDictionary<int, long>();
        var order = new List<int>();
        while (window.Count > 0)
        {
            var next = DownloadQueueService.PickFairly(window, lastClaim)!;
            order.Add(next.Id);
            window.Remove(next);
            lastClaim[next.SeriesId] = order.Count;
        }

        Assert.Equal([2, 4, 3, 5, 1], order);
    }

    [Fact]
    public void Empty_window_picks_nothing() =>
        Assert.Null(DownloadQueueService.PickFairly([], new ConcurrentDictionary<int, long>()));
}
