using Maki.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;

namespace Maki.Api.Tests;

public class RenameDownloadClientSettingsMigrationTests
{
    private const string PreMigration = "20261020095945_ChapterPlacement";

    private static void Exec(SqliteConnection connection, string sql)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    [Fact]
    public void Stored_qbittorrent_settings_move_to_the_download_client_keys()
    {
        using var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<MakiDbContext>().UseSqlite(connection).Options;

        using (var before = new MakiDbContext(options))
        {
            before.Database.GetInfrastructure().GetRequiredService<IMigrator>().Migrate(PreMigration);
        }

        Exec(connection, """
            INSERT INTO AppConfig ("Key", "Value") VALUES
              ('qbittorrent.url', 'http://qbt:8080'), ('qbittorrent.username', 'admin'),
              ('qbittorrent.password', 'secret'), ('qbittorrent.category', 'manga'),
              ('qbittorrent.pathmapfrom', '/downloads'), ('qbittorrent.pathmapto', 'Z:\downloads')
            """);

        using var after = new MakiDbContext(options);
        after.Database.Migrate();

        var config = after.AppConfig.AsNoTracking().ToDictionary(c => c.Key, c => c.Value);
        Assert.Equal("http://qbt:8080", config["downloadclient.url"]);
        Assert.Equal("admin", config["downloadclient.username"]);
        Assert.Equal("secret", config["downloadclient.password"]);
        Assert.Equal("manga", config["downloadclient.label"]);
        Assert.Equal("/downloads", config["downloadclient.pathmapfrom"]);
        Assert.Equal("Z:\\downloads", config["downloadclient.pathmapto"]);
        Assert.DoesNotContain(config.Keys, k => k.StartsWith("qbittorrent.", StringComparison.Ordinal));
        Assert.DoesNotContain("downloadclient.kind", config.Keys);
    }
}
