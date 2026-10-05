using System.Globalization;
using Maki.Metadata.MangaBaka;
using Microsoft.Data.Sqlite;

namespace Maki.Metadata.Embedding;

/// <summary>
/// Series the dump holds but the vector index does not. The index is built from the embeddings that
/// shipped with, or were derived for, an earlier snapshot of the dump, so anything added since has no
/// vector and no row to test filters against. A search that only returns indexed rows can never show
/// such a series, however exactly the query names it.
/// <para>
/// These helpers vouch for what the dump can: the series exists, is not a novel, and its content
/// rating is one the caller may see. They cannot test tags, genres or a never-show list, so the caller
/// only offers these series when none of those are in play.
/// </para>
/// </summary>
internal static class UnindexedHits
{
    /// <summary>Bounds the id list handed to SQL; these come from our own indexes, never caller text.</summary>
    internal const int MaxCandidates = 300;

    /// <summary>True when the filters ask for something only an indexed row can be tested against.</summary>
    internal static bool NarrowsByPreference(RecommendationFilters? f) =>
        f is not null && (
            f.YearMin is not null || f.YearMax is not null || f.MinRating is not null ||
            f.MinChapters is not null || f.MaxChapters is not null ||
            f.Types is { Count: > 0 } || f.Statuses is { Count: > 0 } || f.Genres is { Count: > 0 } ||
            f.Tags is { Count: > 0 } || f.Rules is { Count: > 0 });

    /// <summary>The ratings the caller may see: their list, or the default ceiling when none was given.</summary>
    internal static IReadOnlyList<string> Ratings(RecommendationFilters? f) =>
        f?.ContentRatings is { Count: > 0 } requested ? requested : ContentRating.Allowed(ContentRating.Default);

    /// <summary>
    /// The candidates the caller may see, in the order given: active, not a novel, and at an allowed
    /// content rating.
    /// </summary>
    internal static async Task<IReadOnlyList<long>> VisibleAsync(
        string dumpPath, IReadOnlyList<long> candidates, IReadOnlyList<string> ratings, CancellationToken ct)
    {
        var ids = candidates.Distinct().Take(MaxCandidates).ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        using var conn = new SqliteConnection($"Data Source={dumpPath};Mode=ReadOnly;Pooling=False");
        await conn.OpenAsync(ct);
        using var cmd = conn.CreateCommand();
        var ratingParams = ratings.Select((r, i) => $"$r{i}").ToList();
        for (var i = 0; i < ratings.Count; i++)
        {
            cmd.Parameters.AddWithValue(ratingParams[i], ratings[i]);
        }

        cmd.CommandText = $"""
            SELECT id FROM series
            WHERE id IN ({string.Join(",", ids.Select(id => id.ToString(CultureInfo.InvariantCulture)))})
              AND state = 'active' AND type != 'novel'
              AND content_rating IN ({string.Join(",", ratingParams)})
            """;

        var visible = new HashSet<long>();
        using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            visible.Add(reader.GetInt64(0));
        }

        return ids.Where(visible.Contains).ToList();
    }

    /// <summary>The ids, most popular first (series with no popularity last), at most <paramref name="limit"/>.</summary>
    internal static async Task<IReadOnlyList<long>> ByPopularityAsync(
        string dumpPath, IReadOnlyCollection<long> ids, int limit, CancellationToken ct)
    {
        if (ids.Count == 0)
        {
            return [];
        }

        using var conn = new SqliteConnection($"Data Source={dumpPath};Mode=ReadOnly;Pooling=False");
        await conn.OpenAsync(ct);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT id FROM series
            WHERE id IN ({string.Join(",", ids.Select(id => id.ToString(CultureInfo.InvariantCulture)))})
            ORDER BY popularity_global_current IS NULL, popularity_global_current, id
            LIMIT $limit
            """;
        cmd.Parameters.AddWithValue("$limit", limit);

        var ordered = new List<long>();
        using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            ordered.Add(reader.GetInt64(0));
        }

        return ordered;
    }
}
