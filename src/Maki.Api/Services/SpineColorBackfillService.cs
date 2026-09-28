using Maki.Core.Entities;
using Maki.Data;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Services;

/// <summary>
/// Samples a spine colour for every series whose cover was downloaded before
/// <see cref="Series.SpineColor"/> existed. Runs once: from then on every cover download samples
/// its own. A cover with no usable colour stays null, and the client uses the default spine.
/// </summary>
public class SpineColorBackfillService(MakiDbContext db, CoverService covers, ILogger<SpineColorBackfillService> logger)
{
    public const string MarkerKey = "library.spineColorBackfillDone";

    public async Task RunOnceAsync(CancellationToken ct = default)
    {
        if (await db.AppConfig.AnyAsync(c => c.Key == MarkerKey, ct))
        {
            return;
        }

        var series = await db.Series
            .Where(s => s.CoverPath != null && s.SpineColor == null)
            .ToListAsync(ct);

        var sampled = 0;
        foreach (var s in series)
        {
            s.SpineColor = await covers.SampleSpineAsync(s.Id, ct);
            if (s.SpineColor != null)
            {
                sampled++;
            }
        }

        db.AppConfig.Add(new AppConfigEntry { Key = MarkerKey, Value = DateTime.UtcNow.ToString("O") });
        await db.SaveChangesAsync(ct);

        if (series.Count > 0)
        {
            logger.LogInformation("Spine colours: sampled {Sampled} of {Total} existing cover(s)", sampled, series.Count);
        }
    }
}
