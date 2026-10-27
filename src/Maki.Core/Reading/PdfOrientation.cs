using System.Numerics;
using PdfSharp.Pdf.IO;
using Maki.Core.Images;

namespace Maki.Core.Reading;

/// <summary>
/// Spots a PDF whose pages run last to first and rewrites it the right way round. A replaced file
/// is the best witness (its cover is the new file's cover), then the document's own text: a
/// copyright page belongs near the front. Anything inconclusive leaves the file alone.
/// </summary>
public static class PdfOrientation
{
    private const int HashWidth = 9;
    private const int HashHeight = 8;
    private const int ThumbEdge = 128;

    // Of 128 hash bits, how much closer the swapped pairing must be before a page order is called wrong.
    private const int MinMargin = 24;
    private const int TextWindow = 6;

    private static readonly string[] FrontMatter = ["copyright", "all rights reserved", "isbn", "table of contents"];

    /// <summary>Whether <paramref name="path"/> reads backwards, judged against what it replaces when that is known.</summary>
    public static bool LooksReversed(string path, string? replaced = null)
    {
        var count = PdfReader.PageCount(path);
        if (count < 2) return false;
        return (replaced is not null ? ReversedAgainst(path, replaced) : null) ?? ReversedByText(path, count) ?? false;
    }

    /// <summary>True when the candidate's first and last pages match the reference's last and first, null when they settle nothing.</summary>
    internal static bool? ReversedAgainst(string candidate, string reference)
    {
        var candidatePages = CbzReader.PageNames(candidate);
        var referencePages = CbzReader.PageNames(reference);
        if (candidatePages.Count < 2 || referencePages.Count < 2) return null;

        var cf = PageHash(candidate, candidatePages[0]);
        var cl = PageHash(candidate, candidatePages[^1]);
        var rf = PageHash(reference, referencePages[0]);
        var rl = PageHash(reference, referencePages[^1]);
        if (cf is null || cl is null || rf is null || rl is null) return null;

        var forward = Distance(cf.Value, rf.Value) + Distance(cl.Value, rl.Value);
        var swapped = Distance(cf.Value, rl.Value) + Distance(cl.Value, rf.Value);
        if (swapped + MinMargin <= forward) return true;
        if (forward + MinMargin <= swapped) return false;
        return null;
    }

    private static bool? ReversedByText(string path, int count)
    {
        var window = Math.Min(TextWindow, count / 2);
        var front = Enumerable.Range(0, window).Any(i => HasFrontMatter(path, i));
        var back = Enumerable.Range(count - window, window).Any(i => HasFrontMatter(path, i));
        return front == back ? null : back;
    }

    private static bool HasFrontMatter(string path, int index)
    {
        var text = PdfReader.PageText(path, index);
        return FrontMatter.Any(k => text.Contains(k, StringComparison.OrdinalIgnoreCase));
    }

    private static int Distance(ulong a, ulong b) => BitOperations.PopCount(a ^ b);

    // Difference hash: brightness of each pixel against its right-hand neighbour on a tiny grayscale copy.
    private static ulong? PageHash(string path, string pageName)
    {
        try
        {
            using var stream = ComicFile.IsPdf(path) && PdfReader.TryParsePageIndex(pageName, out var index)
                ? PdfReader.RenderPage(path, index, ThumbEdge)
                : CbzReader.OpenPage(path, pageName);
            if (stream is null) return null;
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            var grey = ImageCodec.ForcedGrey(buffer.ToArray(), HashWidth, HashHeight);
            ulong hash = 0;
            for (var y = 0; y < HashHeight; y++)
                for (var x = 0; x < HashWidth - 1; x++)
                    hash = hash << 1 | (grey[y * HashWidth + x] < grey[y * HashWidth + x + 1] ? 1UL : 0);
            return hash;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Rewrites the file with its pages in the opposite order. The new bytes land under the same
    /// name as a separate file, so a hardlink to a seeding copy is left untouched, not edited through.
    /// </summary>
    public static void Reverse(string path)
    {
        var temp = path + ".reversing";
        try
        {
            using (var doc = PdfSharp.Pdf.IO.PdfReader.Open(path, PdfDocumentOpenMode.Modify))
            {
                var last = doc.PageCount - 1;
                for (var i = 0; i < last; i++) doc.Pages.MovePage(last, i);
                doc.Save(temp);
            }

            File.Move(temp, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }
}
