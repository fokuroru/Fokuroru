using Microsoft.EntityFrameworkCore;

namespace Maki.Data;

/// <summary>
/// Puts back a column a later-applied migration dropped. SQLite rebuilds a table for operations like
/// AddForeignKey from the migration's own target model, so an older-dated migration applied after a
/// newer one that added a column rebuilds the table without it while the history still lists the
/// newer migration as done.
/// </summary>
public static class SchemaRepair
{
    /// <summary>
    /// <c>Series.SpineColor</c> comes from <c>SeriesSpineColor</c> (28 Sep), but upstream's
    /// <c>UpgradeProfiles</c> (27 Sep) adds a foreign key to Series, which rebuilds it without that column on
    /// a database that already had it. Idempotent: does nothing when the column exists.
    /// </summary>
    public static void EnsureSeriesSpineColor(MakiDbContext db)
    {
        var connection = db.Database.GetDbConnection();
        var opened = connection.State != System.Data.ConnectionState.Open;
        if (opened) connection.Open();
        try
        {
            using var check = connection.CreateCommand();
            check.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Series') WHERE name = 'SpineColor'";
            if (Convert.ToInt32(check.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture) > 0) return;

            using var add = connection.CreateCommand();
            add.CommandText = "ALTER TABLE \"Series\" ADD COLUMN \"SpineColor\" TEXT NULL";
            add.ExecuteNonQuery();
        }
        finally
        {
            if (opened) connection.Close();
        }
    }
}
