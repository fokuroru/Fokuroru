using Maki.Api.Configuration;
using Maki.Core.Configuration;
using Maki.Core.Entities;
using Maki.Core.Notifications;
using System.Security.Cryptography;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using Maki.Core.Imaging;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Maki.Api.Services;

/// <summary>Downloads series cover art and stores a resized poster under MediaCover/{seriesId}/.</summary>
public class CoverService(
    IHttpClientFactory httpClientFactory, AppPaths paths, IAppSettings settings, ILogger<CoverService> logger)
    : INotificationCoverStore
{
    private const int PosterWidth = 400;

    private static readonly DecoderOptions FirstFrameOnly = new() { MaxFrames = 1 };

    public string CoverPathFor(int seriesId) => Path.Combine(paths.MediaCoverDir, seriesId.ToString(), "cover.jpg");

    /// <summary>
    /// Removes a series' whole poster folder. Must run on series delete: SQLite reuses a rowid
    /// once the highest-id row is removed, so a later series can be assigned the same id — and
    /// <see cref="MediaCoverController"/> resolves a cover purely by id, with no check that the
    /// file on disk belongs to the series that still exists. Leaving the folder behind means the
    /// new series serves the deleted one's cover until its own download happens to overwrite it.
    /// </summary>
    public void DeleteCover(int seriesId)
    {
        var dir = Path.GetDirectoryName(CoverPathFor(seriesId))!;
        if (Directory.Exists(dir))
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    /// <summary>
    /// Explicit so the existing <see cref="CoverPathFor"/> keeps its "where it would live" meaning —
    /// notification providers need "is there actually one to upload".
    /// </summary>
    string? INotificationCoverStore.PosterPathFor(int seriesId)
    {
        var path = CoverPathFor(seriesId);
        return File.Exists(path) ? path : null;
    }

    /// <summary>The spine colour of the stored poster, or null when there is none or it has no usable colour.</summary>
    public async Task<string?> SampleSpineAsync(int seriesId, CancellationToken ct = default)
    {
        var path = CoverPathFor(seriesId);
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            using var image = await Image.LoadAsync<Rgb24>(path, ct);
            return SpineColor.Sample(image);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not sample a spine colour for series {SeriesId}", seriesId);
            return null;
        }
    }

    public async Task<string?> DownloadCoverAsync(int seriesId, string coverUrl, CancellationToken ct = default)
    {
        try
        {
            var client = httpClientFactory.CreateClient("covers");
            await using var stream = await client.GetStreamAsync(coverUrl, ct);
            using var image = await Image.LoadAsync(FirstFrameOnly, stream, ct);

            if (image.Width > PosterWidth)
            {
                image.Mutate(x => x.Resize(PosterWidth, 0));
            }

            var target = CoverPathFor(seriesId);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            await image.SaveAsync(target, new JpegEncoder { Quality = 90 }, ct);
            return target;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to download cover for series {SeriesId} from {Url}", seriesId, coverUrl);
            return null;
        }
    }

    /// <summary>
    /// Copies the cached poster into the series' own library folder as "cover.jpg", for readers
    /// (Komga, Kavita) that pick up a poster placed directly next to the series' files rather than
    /// through Maki. Gated on <see cref="SettingKeys.LibraryWriteCoverToFolder"/>, default off. A cover.jpg
    /// the user placed there is left alone; only one Maki wrote is refreshed.
    /// </summary>
    public Task WriteLibraryCoverAsync(Series series, CancellationToken ct = default) =>
        series.RootFolder is null
            ? Task.CompletedTask
            : WriteLibraryCoverAsync(series.Id, Path.Combine(series.RootFolder.Path, series.FolderName), ct);

    /// <summary>
    /// Hash of the last cover.jpg Maki wrote into the series folder. A cover.jpg that matches neither it
    /// nor the current poster was put there by the user and is never overwritten.
    /// </summary>
    private string LibraryCoverRecordFor(int seriesId) =>
        Path.Combine(paths.MediaCoverDir, seriesId.ToString(), "library-cover.sha256");

    private static bool WrittenByMaki(string cover, string record) =>
        File.Exists(record) && File.ReadAllText(record).Trim() == Sha256Of(cover);

    private static bool SameBytes(string a, string b) =>
        new FileInfo(a).Length == new FileInfo(b).Length && Sha256Of(a) == Sha256Of(b);

    private static string Sha256Of(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream));
    }

    /// <inheritdoc cref="WriteLibraryCoverAsync(Series, CancellationToken)"/>
    public async Task WriteLibraryCoverAsync(int seriesId, string seriesFolder, CancellationToken ct = default)
    {
        if (await settings.GetAsync(SettingKeys.LibraryWriteCoverToFolder, ct) != "true")
        {
            return;
        }

        var source = CoverPathFor(seriesId);
        if (!File.Exists(source))
        {
            return;
        }

        try
        {
            var target = Path.Combine(seriesFolder, "cover.jpg");
            var record = LibraryCoverRecordFor(seriesId);
            if (File.Exists(target) && !SameBytes(source, target) && !WrittenByMaki(target, record))
            {
                return;
            }

            Directory.CreateDirectory(seriesFolder);
            File.Copy(source, target, overwrite: true);
            File.WriteAllText(record, Sha256Of(target));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to write library cover for series {SeriesId} to {Folder}", seriesId, seriesFolder);
        }
    }
}
