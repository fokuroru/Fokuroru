using System.Buffers.Binary;
using System.Text;
using Maki.Api.Services;

namespace Maki.Api.Tests;

public class GlbInspectorTests
{
    private static byte[] Glb(string json, uint version = 2)
    {
        var body = Encoding.UTF8.GetBytes(json);
        var padded = new byte[(body.Length + 3) / 4 * 4];
        Array.Fill(padded, (byte)' ');
        body.CopyTo(padded, 0);
        var data = new byte[20 + padded.Length];
        BinaryPrimitives.WriteUInt32LittleEndian(data, 0x46546C67);
        BinaryPrimitives.WriteUInt32LittleEndian(data.AsSpan(4), version);
        BinaryPrimitives.WriteUInt32LittleEndian(data.AsSpan(8), (uint)data.Length);
        BinaryPrimitives.WriteUInt32LittleEndian(data.AsSpan(12), (uint)padded.Length);
        BinaryPrimitives.WriteUInt32LittleEndian(data.AsSpan(16), 0x4E4F534A);
        padded.CopyTo(data, 20);
        return data;
    }

    private const string Plain = "{\"asset\":{\"version\":\"2.0\"},\"meshes\":[{\"primitives\":[]}]}";

    [Fact]
    public void Accepts_a_plain_glb() => Assert.Null(GlbInspector.Check(Glb(Plain)));

    [Fact]
    public void Accepts_quantized_webp_models() =>
        Assert.Null(GlbInspector.Check(Glb(
            "{\"asset\":{\"version\":\"2.0\"},\"meshes\":[{}],\"extensionsRequired\":[\"KHR_mesh_quantization\",\"EXT_texture_webp\"]}")));

    [Fact]
    public void Rejects_text_and_truncated_files()
    {
        Assert.Equal("error.figures.notGlb", GlbInspector.Check(Encoding.UTF8.GetBytes("not a model at all, just text here")));
        Assert.Equal("error.figures.notGlb", GlbInspector.Check(Glb(Plain)[..30]));
    }

    [Fact]
    public void Rejects_a_wrong_version_or_missing_meshes()
    {
        Assert.Equal("error.figures.notGlb", GlbInspector.Check(Glb(Plain, version: 1)));
        Assert.Equal("error.figures.notGlb", GlbInspector.Check(Glb("{\"asset\":{\"version\":\"2.0\"}}")));
    }

    [Fact]
    public void Rejects_files_that_reach_outside_themselves() =>
        Assert.Equal("error.figures.external", GlbInspector.Check(Glb(
            "{\"asset\":{\"version\":\"2.0\"},\"meshes\":[{}],\"images\":[{\"uri\":\"https://example.com/a.png\"}]}")));

    [Fact]
    public void Allows_embedded_data_uris() =>
        Assert.Null(GlbInspector.Check(Glb(
            "{\"asset\":{\"version\":\"2.0\"},\"meshes\":[{}],\"images\":[{\"uri\":\"data:image/png;base64,AAAA\"}]}")));

    [Fact]
    public void Rejects_basis_compressed_textures_the_shelf_cannot_read() =>
        Assert.Equal("error.figures.unsupported", GlbInspector.Check(Glb(
            "{\"asset\":{\"version\":\"2.0\"},\"meshes\":[{}],\"extensionsRequired\":[\"KHR_texture_basisu\"]}")));

    [Fact]
    public void Says_whether_a_model_has_any_colour_data()
    {
        Assert.False(GlbInspector.Inspect(Glb(Plain)).Textured);
        Assert.True(GlbInspector.Inspect(Glb(
            "{\"asset\":{\"version\":\"2.0\"},\"meshes\":[{}],\"images\":[{\"bufferView\":0,\"mimeType\":\"image/png\"}]}")).Textured);
        Assert.True(GlbInspector.Inspect(Glb(
            "{\"asset\":{\"version\":\"2.0\"},\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0,\"COLOR_0\":1}}]}]}")).Textured);
    }

    [Fact]
    public void Rejects_compression_the_shelf_cannot_decode() =>
        Assert.Equal("error.figures.unsupported", GlbInspector.Check(Glb(
            "{\"asset\":{\"version\":\"2.0\"},\"meshes\":[{}],\"extensionsRequired\":[\"KHR_draco_mesh_compression\"]}")));
}
