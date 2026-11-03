using Maki.Api.Controllers;
using Maki.Core.Entities;
using Maki.Data.Identity;

namespace Maki.Api.Tests;

/// <summary>When the series page asks the caller to rate a series they finished.</summary>
public sealed class RateFinishedHintTests : IDisposable
{
    private readonly TestDb _db = new();

    public void Dispose() => _db.Dispose();

    private void SeedReader(int userId, int seriesId, bool finished)
    {
        using var db = _db.NewContext();
        db.ReadingStates.Add(new ReadingState
        {
            UserId = userId, SeriesId = seriesId, Title = "Berserk", Finished = finished, MaxChapter = 10,
        });
        db.SaveChanges();
    }

    private void SeedState(int userId, int seriesId, int? rating, DateTime? dismissedAt = null)
    {
        using var db = _db.NewContext();
        db.UserSeriesStates.Add(new UserSeriesState
        {
            UserId = userId, SeriesId = seriesId, Rating = rating, RateHintDismissedAt = dismissedAt,
        });
        db.SaveChanges();
    }

    private async Task<bool> Offered(int userId, int seriesId)
    {
        using var db = _db.NewContext(userId);
        return await SeriesController.RateHintAsync(db, seriesId, default);
    }

    [Fact]
    public async Task Offered_once_the_caller_has_finished_an_unrated_series()
    {
        var alice = _db.SeedUser("alice");
        var seriesId = _db.SeedSeries("Berserk");
        SeedReader(alice, seriesId, finished: true);

        Assert.True(await Offered(alice, seriesId));
    }

    [Fact]
    public async Task Not_offered_before_finishing()
    {
        var alice = _db.SeedUser("alice");
        var seriesId = _db.SeedSeries("Berserk");
        SeedReader(alice, seriesId, finished: false);

        Assert.False(await Offered(alice, seriesId));
    }

    [Fact]
    public async Task Not_offered_once_rated_or_dismissed()
    {
        var alice = _db.SeedUser("alice");
        var bob = _db.SeedUser("bob");
        var seriesId = _db.SeedSeries("Berserk");
        SeedReader(alice, seriesId, finished: true);
        SeedReader(bob, seriesId, finished: true);
        SeedState(alice, seriesId, rating: 9);
        SeedState(bob, seriesId, rating: null, dismissedAt: DateTime.UtcNow);

        Assert.False(await Offered(alice, seriesId));
        Assert.False(await Offered(bob, seriesId));
    }

    [Fact]
    public async Task Offered_when_the_callers_row_exists_without_a_rating()
    {
        var alice = _db.SeedUser("alice");
        var seriesId = _db.SeedSeries("Berserk");
        SeedReader(alice, seriesId, finished: true);
        SeedState(alice, seriesId, rating: null);

        Assert.True(await Offered(alice, seriesId));
    }
}
