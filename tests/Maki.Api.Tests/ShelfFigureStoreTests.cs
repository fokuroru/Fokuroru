using System.Buffers.Binary;
using System.Text;
using Maki.Api.Configuration;
using Maki.Api.Services;

namespace Maki.Api.Tests;

public class ShelfFigureStoreTests : IDisposable
{
    private readonly string _configDir = Directory.CreateTempSubdirectory("maki-figures-").FullName;
    private readonly string? _priorEnv = Environment.GetEnvironmentVariable("MAKI_CONFIG_DIR");
    private readonly AppPaths _paths;

    public ShelfFigureStoreTests()
    {
        Environment.SetEnvironmentVariable("MAKI_CONFIG_DIR", _configDir);
        _paths = new AppPaths();
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("MAKI_CONFIG_DIR", _priorEnv);
        Directory.Delete(_configDir, recursive: true);
    }

    private ShelfFigureStore For(int userId) => new(_paths, new TestCurrentUser(userId));

    private static MemoryStream Glb()
    {
        var json = Encoding.UTF8.GetBytes("{\"asset\":{\"version\":\"2.0\"},\"meshes\":[{}]}  ");
        var data = new byte[20 + json.Length];
        BinaryPrimitives.WriteUInt32LittleEndian(data, 0x46546C67);
        BinaryPrimitives.WriteUInt32LittleEndian(data.AsSpan(4), 2);
        BinaryPrimitives.WriteUInt32LittleEndian(data.AsSpan(8), (uint)data.Length);
        BinaryPrimitives.WriteUInt32LittleEndian(data.AsSpan(12), (uint)json.Length);
        BinaryPrimitives.WriteUInt32LittleEndian(data.AsSpan(16), 0x4E4F534A);
        json.CopyTo(data, 20);
        return new MemoryStream(data);
    }

    [Fact]
    public async Task Saves_lists_and_deletes_a_figure()
    {
        var store = For(1);
        var saved = await store.SaveAsync(Glb(), "Crimson Lolita.glb", CancellationToken.None);

        var listed = Assert.Single(store.List());
        Assert.Equal(saved.Id, listed.Id);
        Assert.Equal("Crimson Lolita", listed.Name);
        Assert.False(listed.Textured);
        Assert.False(saved.Textured);
        Assert.NotNull(store.PathOf(saved.Id));

        Assert.True(store.Delete(saved.Id));
        Assert.Empty(store.List());
        Assert.Null(store.PathOf(saved.Id));
    }

    [Fact]
    public async Task One_users_figures_are_not_another_users()
    {
        var saved = await For(1).SaveAsync(Glb(), "mine.glb", CancellationToken.None);

        Assert.Empty(For(2).List());
        Assert.Null(For(2).PathOf(saved.Id));
        Assert.False(For(2).Delete(saved.Id));
    }

    [Fact]
    public void An_id_that_is_a_path_finds_nothing()
    {
        Assert.Null(For(1).PathOf("../../config"));
        Assert.Null(For(1).PathOf("..%2f..%2fconfig"));
        Assert.False(For(1).Delete("../../maki"));
    }

    [Fact]
    public async Task Refuses_a_file_that_is_not_a_glb_and_stores_nothing()
    {
        var ex = await Assert.ThrowsAsync<ShelfFigureException>(() =>
            For(1).SaveAsync(new MemoryStream(Encoding.UTF8.GetBytes("hello hello hello hello hello hello")), "x.glb", CancellationToken.None));
        Assert.Equal("error.figures.notGlb", ex.Key);
        Assert.Empty(For(1).List());
    }

    [Fact]
    public async Task Stops_at_the_limit()
    {
        var store = For(1);
        for (var i = 0; i < ShelfFigureStore.MaxCount; i++)
        {
            await store.SaveAsync(Glb(), $"f{i}.glb", CancellationToken.None);
        }

        var ex = await Assert.ThrowsAsync<ShelfFigureException>(() => store.SaveAsync(Glb(), "one-more.glb", CancellationToken.None));
        Assert.Equal("error.figures.tooMany", ex.Key);
    }
}
