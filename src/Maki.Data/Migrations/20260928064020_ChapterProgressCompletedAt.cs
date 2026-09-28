using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Maki.Data.Migrations
{
    /// <inheritdoc />
    public partial class ChapterProgressCompletedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "CompletedAt",
                table: "ChapterProgress",
                type: "TEXT",
                nullable: true);

            // Nothing recorded when these were read, so their countdown starts now. Dating them from
            // UpdatedAt instead would let the first auto-delete run clear a whole back catalogue.
            migrationBuilder.Sql(
                "UPDATE ChapterProgress SET CompletedAt = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE Completed = 1;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CompletedAt",
                table: "ChapterProgress");
        }
    }
}
