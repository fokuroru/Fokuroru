using System.Buffers.Binary;
using NetVips;
using VipsImage = NetVips.Image;

namespace Maki.Core.Images;

public enum ImageFormat
{
    Jpeg,
    Png,
    Webp,
    Gif,
    Avif,
    Bmp,
}

/// <summary>What a header says, read without decoding any pixels.</summary>
public readonly record struct ImageHeader(int Width, int Height, ImageFormat? Format);

/// <summary>
/// Every libvips call in Maki goes through here or <see cref="Raster"/>, so the process-wide setup in
/// the static constructor is guaranteed to run before the first image is opened.
/// </summary>
public static class ImageCodec
{
    /// <summary>
    /// The only loaders allowed to touch input. Pages and covers come from scraped sites and user
    /// uploads, so every other libvips loader (TIFF, SVG, PDF, FITS, matrix, ...) stays blocked:
    /// a format Maki never needed is attack surface and nothing else.
    /// </summary>
    private static readonly string[] AllowedLoaders =
    [
        "VipsForeignLoadJpeg",
        "VipsForeignLoadPng",
        "VipsForeignLoadWebp",
        "VipsForeignLoadNsgif",
        "VipsForeignLoadHeif",
    ];

    static ImageCodec()
    {
        // The operation cache keeps recent inputs alive, buffers and open files alike. Maki never
        // repeats an operation on the same input, and a file handle held past dispose blocks
        // File.Move on Windows.
        Cache.Max = 0;
        Cache.MaxMem = 0;
        Cache.MaxFiles = 0;

        global::NetVips.NetVips.BlockUntrusted = true;
        Operation.Block("VipsForeignLoad", true);
        foreach (var loader in AllowedLoaders)
        {
            Operation.Block(loader, false);
        }
    }

    /// <summary>Reads width, height and format from the header. Throws when the bytes are not an image a permitted loader accepts.</summary>
    public static ImageHeader Identify(byte[] bytes)
    {
        if (TryBmp(bytes, out var bmp)) return bmp;
        using var image = VipsImage.NewFromBuffer(bytes, access: Enums.Access.Sequential);
        return Header(image, bytes);
    }

    /// <inheritdoc cref="Identify(byte[])"/>
    public static ImageHeader Identify(ReadOnlySpan<byte> bytes) => Identify(bytes.ToArray());

    /// <inheritdoc cref="Identify(byte[])"/>
    public static ImageHeader IdentifyFile(string path)
    {
        var start = new byte[BmpHeaderBytes];
        using (var stream = File.OpenRead(path))
        {
            var read = stream.ReadAtLeast(start, start.Length, throwOnEndOfStream: false);
            if (TryBmp(start.AsSpan(0, read), out var bmp)) return bmp;
        }

        using var image = VipsImage.NewFromFile(path, access: Enums.Access.Sequential);
        return Header(image, null);
    }

    public static ImageHeader? TryIdentify(byte[] bytes)
    {
        try
        {
            return Identify(bytes);
        }
        catch (VipsException)
        {
            return null;
        }
    }

    private const int BmpHeaderBytes = 26;

    /// <summary>
    /// libvips reads BMP only through ImageMagick, which this build leaves out. Maki still accepts
    /// .bmp pages (the reader serves their bytes as they are), so the header is read here to keep a
    /// BMP page from looking damaged to the health scan and the quality measure.
    /// </summary>
    private static bool TryBmp(ReadOnlySpan<byte> bytes, out ImageHeader header)
    {
        header = default;
        if (bytes.Length < BmpHeaderBytes || bytes[0] != 'B' || bytes[1] != 'M') return false;
        var dibSize = BinaryPrimitives.ReadUInt32LittleEndian(bytes[14..]);
        int width, height;
        if (dibSize == 12)
        {
            width = BinaryPrimitives.ReadUInt16LittleEndian(bytes[18..]);
            height = BinaryPrimitives.ReadUInt16LittleEndian(bytes[20..]);
        }
        else if (dibSize >= 40)
        {
            width = BinaryPrimitives.ReadInt32LittleEndian(bytes[18..]);
            // Negative means rows are stored top-down; the size is the same.
            height = Math.Abs(BinaryPrimitives.ReadInt32LittleEndian(bytes[22..]));
        }
        else return false;

        if (width <= 0 || height <= 0) return false;
        header = new ImageHeader(width, height, ImageFormat.Bmp);
        return true;
    }

    /// <summary>The format a permitted loader recognises from the signature, or null.</summary>
    public static ImageFormat? DetectFormat(ReadOnlySpan<byte> bytes)
    {
        if (TryBmp(bytes, out _)) return ImageFormat.Bmp;
        var loader = VipsImage.FindLoadBuffer(bytes.ToArray());
        return loader is null ? null : FormatOf(loader, bytes);
    }

    /// <summary>
    /// A JPEG at most <paramref name="width"/> wide, shrunk while decoding where the format allows
    /// it (a JPEG scales in the DCT, so a 2000x3000 scan never exists as full-size pixels). Only the
    /// first frame of an animation is used, EXIF orientation is applied, colour is converted to
    /// sRGB, transparency lands on white and every metadata block is dropped.
    /// <paramref name="enlarge"/> also scales a narrower image up to the width.
    /// </summary>
    public static byte[] JpegThumbnail(byte[] source, int width, int quality, bool enlarge)
    {
        using var thumb = VipsImage.ThumbnailBuffer(source, width, height: 10_000_000,
            size: enlarge ? Enums.Size.Both : Enums.Size.Down, outputProfile: "srgb");
        return SaveJpeg(thumb, quality);
    }

    /// <summary>
    /// Saves 4:2:0 regardless of quality. libvips' own default drops chroma subsampling at 90 and
    /// above, which makes a cover about a third larger than Maki ever wrote it.
    /// </summary>
    internal static byte[] SaveJpeg(VipsImage image, int quality)
    {
        if (image.HasAlpha())
        {
            using var flat = image.Flatten(background: [255, 255, 255]);
            return flat.JpegsaveBuffer(q: quality, subsampleMode: Enums.ForeignSubsample.On, keep: Enums.ForeignKeep.None);
        }

        return image.JpegsaveBuffer(q: quality, subsampleMode: Enums.ForeignSubsample.On, keep: Enums.ForeignKeep.None);
    }

    /// <summary>
    /// The whole image squeezed to <paramref name="width"/> x <paramref name="height"/> whatever its shape, as interleaved
    /// 8-bit sRGB (3 bands): orientation applied, transparency on white. For measuring colour, not for showing.
    /// </summary>
    internal static byte[] ForcedRgb(byte[] source, int width, int height)
    {
        using var thumb = VipsImage.ThumbnailBuffer(source, width, height: height, size: Enums.Size.Force, outputProfile: "srgb");
        using var flat = thumb.HasAlpha() ? thumb.Flatten(background: [255, 255, 255]) : thumb.Copy();
        using var srgb = flat.Colourspace(Enums.Interpretation.Srgb);
        using var rgb = srgb.Bands > 3 ? srgb.ExtractBand(0, n: 3) : srgb.Copy();
        return rgb.WriteToMemory<byte>();
    }

    /// <summary>
    /// The image as a <paramref name="width"/> by <paramref name="height"/> grid of brightness bytes: squeezed to
    /// eight by nine times that, then each cell averaged (a box filter, which is what keeps a hash built from it
    /// steady across encodings and sizes), Rec. 709 weights on the stored values.
    /// </summary>
    internal static byte[] ForcedGrey(byte[] source, int width, int height)
    {
        const int cellWidth = 8;
        const int cellHeight = 9;
        var rgb = ForcedRgb(source, width * cellWidth, height * cellHeight);
        var stride = width * cellWidth;
        var grey = new byte[width * height];
        for (var cy = 0; cy < height; cy++)
        for (var cx = 0; cx < width; cx++)
        {
            double sum = 0;
            for (var y = 0; y < cellHeight; y++)
            for (var x = 0; x < cellWidth; x++)
            {
                var i = ((cy * cellHeight + y) * stride + cx * cellWidth + x) * 3;
                sum += 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
            }

            grey[cy * width + cx] = (byte)Math.Clamp((int)Math.Round(sum / (cellWidth * cellHeight)), 0, 255);
        }

        return grey;
    }

    internal static VipsImage Open(byte[] bytes) => VipsImage.NewFromBuffer(bytes, access: Enums.Access.Sequential);

    internal static VipsImage ThumbnailFile(string path, int width, int height) =>
        VipsImage.Thumbnail(path, width, height: height, size: Enums.Size.Force, noRotate: true);

    internal static VipsImage FromMemory(byte[] pixels, int width, int height, int bands) =>
        VipsImage.NewFromMemory(pixels, width, height, bands, Enums.BandFormat.Uchar);

    private static ImageHeader Header(VipsImage image, byte[]? bytes)
    {
        var loader = image.Contains("vips-loader") ? image.Get("vips-loader") as string : null;
        return new ImageHeader(image.Width, image.Height, loader is null ? null : FormatOf(loader, bytes));
    }

    /// <summary>
    /// A loaded image names its loader by nickname (<c>webpload_buffer</c>), the loader search by
    /// class (<c>VipsForeignLoadWebpBuffer</c>), so both spellings are matched.
    /// </summary>
    private static ImageFormat? FormatOf(string loader, ReadOnlySpan<byte> bytes)
    {
        var name = loader.ToLowerInvariant();
        if (name.Contains("jpeg")) return ImageFormat.Jpeg;
        if (name.Contains("png")) return ImageFormat.Png;
        if (name.Contains("webp")) return ImageFormat.Webp;
        if (name.Contains("gif")) return ImageFormat.Gif;
        // The HEIF loader also opens HEIC, which is not a format Maki serves; the brand tells them
        // apart. From a file there are no bytes to check, and Maki writes no HEIF files of its own.
        if (name.Contains("heif") &&
            (bytes.IsEmpty || Download.ImageValidator.SniffMediaType(bytes) == "image/avif"))
            return ImageFormat.Avif;
        return null;
    }
}
