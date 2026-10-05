using Maki.Metadata.Embedding;
using Maki.Metadata.MangaBaka;

namespace Maki.Metadata.Tests;

public class UnindexedHitsTests
{
    private static DumpDbBuilder Dump() => new DumpDbBuilder()
        .AddSeries(1, "Safe Series", contentRating: "safe", popularity: 50)
        .AddSeries(2, "Erotica Series", contentRating: "erotica", popularity: 10)
        .AddSeries(3, "Pornographic Series", contentRating: "pornographic", popularity: 5)
        .AddSeries(4, "A Light Novel", type: "novel", contentRating: "safe", popularity: 1)
        .AddSeries(5, "Deleted Series", state: "merged", contentRating: "safe", popularity: 2)
        .AddSeries(6, "Unranked Series", contentRating: "safe");

    [Fact]
    public async Task Visible_keeps_active_non_novel_series_at_an_allowed_rating_in_the_order_given()
    {
        using var dump = Dump();

        var visible = await UnindexedHits.VisibleAsync(
            dump.Path, [6L, 3L, 2L, 4L, 5L, 1L, 99L], ["safe", "suggestive", "erotica"], CancellationToken.None);

        // 3 is above the ceiling, 4 is a novel, 5 is not active, 99 does not exist.
        Assert.Equal([6L, 2L, 1L], visible);
    }

    [Fact]
    public async Task Visible_honours_a_rating_list_that_is_not_a_prefix()
    {
        using var dump = Dump();

        var visible = await UnindexedHits.VisibleAsync(dump.Path, [1L, 2L, 3L], ["erotica"], CancellationToken.None);

        Assert.Equal([2L], visible);
    }

    [Fact]
    public async Task Visible_of_nothing_is_nothing()
    {
        using var dump = Dump();

        Assert.Empty(await UnindexedHits.VisibleAsync(dump.Path, [], ["safe"], CancellationToken.None));
    }

    [Fact]
    public async Task ByPopularity_orders_the_most_popular_first_and_unranked_last()
    {
        using var dump = Dump();

        var ordered = await UnindexedHits.ByPopularityAsync(dump.Path, [1L, 2L, 3L, 6L], 3, CancellationToken.None);

        Assert.Equal([3L, 2L, 1L], ordered);
    }

    [Fact]
    public void Ratings_default_to_the_ceiling_that_excludes_only_pornographic()
    {
        Assert.Equal(["safe", "suggestive", "erotica"], UnindexedHits.Ratings(null));
        Assert.Equal(["safe", "suggestive", "erotica"], UnindexedHits.Ratings(RecommendationFilters.None));
        Assert.Equal(["erotica"], UnindexedHits.Ratings(new RecommendationFilters(ContentRatings: ["erotica"])));
    }

    [Fact]
    public void Only_preference_filters_count_as_narrowing()
    {
        Assert.False(UnindexedHits.NarrowsByPreference(null));
        Assert.False(UnindexedHits.NarrowsByPreference(RecommendationFilters.None));
        Assert.False(UnindexedHits.NarrowsByPreference(new RecommendationFilters(ContentRatings: ["safe"])));
        Assert.True(UnindexedHits.NarrowsByPreference(new RecommendationFilters(YearMin: 2020)));
        Assert.True(UnindexedHits.NarrowsByPreference(new RecommendationFilters(Genres: ["Action"])));
    }
}
