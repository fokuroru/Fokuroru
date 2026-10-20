using System.Text;
using Maki.Core.Download;

namespace Maki.Core.Tests;

public class TorrentFileTests
{
    private static byte[] Bytes(string s) => Encoding.ASCII.GetBytes(s);

    [Fact]
    public void The_info_hash_is_the_sha1_of_the_info_dictionary_as_it_appears_in_the_file()
    {
        var torrent = Bytes("d8:announce3:foo4:infod6:lengthi3e4:name1:a12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaaee");

        Assert.True(TorrentFile.TryInfoHash(torrent, out var hash));
        Assert.Equal("f57885ddc30a153b9f534bc8c8b5d3744ca9b535", hash);
    }

    [Fact]
    public void Keys_before_info_with_nested_values_are_skipped_over()
    {
        var torrent = Bytes("d13:announce-listll3:fooel3:baree7:comment1:x4:infod6:lengthi3e4:name1:a12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaaee");

        Assert.True(TorrentFile.TryInfoHash(torrent, out var hash));
        Assert.Equal("f57885ddc30a153b9f534bc8c8b5d3744ca9b535", hash);
    }

    [Theory]
    [InlineData("")]
    [InlineData("<html>not a torrent</html>")]
    [InlineData("d4:name1:ae")]
    [InlineData("d4:infod6:lengthi3e")]
    [InlineData("d99:truncated")]
    public void Anything_else_has_no_hash(string text) => Assert.False(TorrentFile.TryInfoHash(Bytes(text), out _));

    [Fact]
    public void Hostile_nesting_is_refused_rather_than_overflowing_the_stack()
    {
        var deep = "d4:info" + new string('l', 5000) + new string('e', 5000) + "e";

        Assert.False(TorrentFile.TryInfoHash(Bytes(deep), out _));
    }
}
