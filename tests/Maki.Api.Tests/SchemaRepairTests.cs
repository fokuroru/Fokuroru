using Maki.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Maki.Api.Tests;

public class SchemaRepairTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly DbContextOptions<MakiDbContext> _options;

    public SchemaRepairTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        _options = new DbContextOptionsBuilder<MakiDbContext>().UseSqlite(_connection).Options;
        using var db = new MakiDbContext(_options);
        db.Database.Migrate();
    }

    public void Dispose() => _connection.Dispose();

    private bool HasSpineColor()
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Series') WHERE name = 'SpineColor'";
        return Convert.ToInt32(cmd.ExecuteScalar()) > 0;
    }

    [Fact]
    public void Puts_back_a_spine_colour_column_a_table_rebuild_dropped()
    {
        using (var cmd = _connection.CreateCommand())
        {
            cmd.CommandText = "ALTER TABLE \"Series\" DROP COLUMN \"SpineColor\"";
            cmd.ExecuteNonQuery();
        }
        Assert.False(HasSpineColor());

        using var db = new MakiDbContext(_options);
        SchemaRepair.EnsureSeriesSpineColor(db);

        Assert.True(HasSpineColor());
    }

    [Fact]
    public void Leaves_an_intact_schema_alone()
    {
        Assert.True(HasSpineColor());

        using var db = new MakiDbContext(_options);
        SchemaRepair.EnsureSeriesSpineColor(db);
        SchemaRepair.EnsureSeriesSpineColor(db);

        Assert.True(HasSpineColor());
    }
}
