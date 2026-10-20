using System.Security.Cryptography;

namespace Maki.Core.Download;

/// <summary>
/// Reads the one thing Maki needs out of a .torrent file: its info-hash, the SHA-1 of the bencoded <c>info</c>
/// dictionary exactly as it appears in the file. It is what qBittorrent calls the torrent's hash, so knowing it lets the
/// completed-download job find the torrent directly instead of guessing "the newest one in the category".
/// </summary>
public static class TorrentFile
{
    private const int MaxDepth = 32;

    public static bool TryInfoHash(ReadOnlySpan<byte> data, out string hash)
    {
        hash = string.Empty;
        if (data.Length < 2 || data[0] != (byte)'d')
        {
            return false;
        }

        try
        {
            var pos = 1;
            while (pos < data.Length && data[pos] != (byte)'e')
            {
                var key = ReadString(data, ref pos);
                var start = pos;
                Skip(data, ref pos, 0);
                if (key.SequenceEqual("info"u8))
                {
                    hash = Convert.ToHexString(SHA1.HashData(data[start..pos])).ToLowerInvariant();
                    return true;
                }
            }
        }
        catch (Exception ex) when (ex is FormatException or ArgumentOutOfRangeException or IndexOutOfRangeException)
        {
            return false;
        }

        return false;
    }

    private static ReadOnlySpan<byte> ReadString(ReadOnlySpan<byte> data, ref int pos)
    {
        var colon = data[pos..].IndexOf((byte)':');
        if (colon <= 0 || !int.TryParse(data.Slice(pos, colon), out var length) || length < 0)
        {
            throw new FormatException("Not a bencoded string");
        }

        var start = pos + colon + 1;
        if (start + length > data.Length)
        {
            throw new FormatException("Truncated string");
        }

        pos = start + length;
        return data.Slice(start, length);
    }

    private static void Skip(ReadOnlySpan<byte> data, ref int pos, int depth)
    {
        if (depth > MaxDepth)
        {
            throw new FormatException("Nested too deeply");
        }

        switch (data[pos])
        {
            case (byte)'i':
                var end = data[pos..].IndexOf((byte)'e');
                if (end < 0)
                {
                    throw new FormatException("Unterminated integer");
                }

                pos += end + 1;
                break;
            case (byte)'l':
                pos++;
                while (data[pos] != (byte)'e')
                {
                    Skip(data, ref pos, depth + 1);
                }

                pos++;
                break;
            case (byte)'d':
                pos++;
                while (data[pos] != (byte)'e')
                {
                    ReadString(data, ref pos);
                    Skip(data, ref pos, depth + 1);
                }

                pos++;
                break;
            default:
                ReadString(data, ref pos);
                break;
        }
    }
}
