using Maki.Core.Configuration;
using Maki.Core.Sources;
using Maki.Data;
using Maki.Sources.Suwayomi;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Services;

/// <summary>
/// Reads Suwayomi's installed sources into the stored snapshot (<see cref="SettingKeys.SuwayomiSources"/>).
/// Chapter languages already chosen are kept. A source Suwayomi no longer lists is dropped, unless
/// series are linked to it: then it stays, marked missing, so those links keep a name and the health
/// check can say what is wrong.
/// </summary>
public class SuwayomiSnapshotService(
    IAppSettings settings,
    SuwayomiSettings suwayomiSettings,
    SuwayomiClient client,
    SourceRegistry sourceRegistry,
    MakiDbContext db,
    ILogger<SuwayomiSnapshotService> logger)
{
    /// <summary>Serialises the snapshot's read-modify-write between a refresh and a language change.</summary>
    public static readonly SemaphoreSlim Gate = new(1, 1);

    /// <returns>How many sources Suwayomi listed.</returns>
    public async Task<int> RefreshAsync(CancellationToken ct)
    {
        var live = (await client.ListSourcesAsync(ct)).DistinctBy(s => s.Id).ToList();
        var linked = (await db.SourceMappings.IgnoreQueryFilters()
                .Where(m => m.SourceName.StartsWith(SuwayomiSource.NamePrefix))
                .Select(m => m.SourceName)
                .Distinct()
                .ToListAsync(ct))
            .ToHashSet(StringComparer.Ordinal);

        await Gate.WaitAsync(ct);
        try
        {
            var before = await settings.GetAsync(SettingKeys.SuwayomiSources, ct);
            var stored = (await StoredAsync(ct)).DistinctBy(e => e.Id).ToDictionary(e => e.Id, StringComparer.Ordinal);
            var next = live.Select(source => new SuwayomiStoredSource(
                    source.Id, source.Name, source.DisplayName, source.Lang,
                    SuwayomiStoredSource.IsMixedLanguage(source.Lang) ? stored.GetValueOrDefault(source.Id)?.ChapterLanguage : null,
                    source.ContentWarning, source.IsNsfw))
                .ToList();
            var liveIds = live.Select(s => s.Id).ToHashSet(StringComparer.Ordinal);
            next.AddRange(stored.Values
                .Where(e => !liveIds.Contains(e.Id) && linked.Contains(SuwayomiSource.NamePrefix + e.Id))
                .Select(e => e with { Missing = true }));

            var after = next.Count == 0
                ? null
                : SuwayomiSettings.Serialize(next
                    .OrderBy(e => string.IsNullOrWhiteSpace(e.DisplayName) ? e.Name : e.DisplayName, StringComparer.OrdinalIgnoreCase)
                    .ThenBy(e => e.Id, StringComparer.Ordinal));
            if (string.Equals(before, after, StringComparison.Ordinal))
            {
                return live.Count;
            }

            await settings.SetAsync(SettingKeys.SuwayomiSources, after, ct);
        }
        finally
        {
            Gate.Release();
        }

        await sourceRegistry.ReloadAsync(ct);
        return live.Count;
    }

    public async Task<IReadOnlyList<SuwayomiStoredSource>> StoredAsync(CancellationToken ct)
    {
        try
        {
            return await suwayomiSettings.StoredAsync(ct);
        }
        catch (System.Text.Json.JsonException ex)
        {
            logger.LogWarning(ex, "The stored Suwayomi source list is not valid JSON; treating it as empty");
            return [];
        }
    }
}
