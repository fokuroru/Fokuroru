using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Maki.Data.Migrations
{
    /// <inheritdoc />
    public partial class PageConversion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PageConversion",
                table: "Series",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "CheckedWith",
                table: "ChapterFiles",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ConversionCheckedAtUtc",
                table: "ChapterFiles",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "ConversionSavedBytes",
                table: "ChapterFiles",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<string>(
                name: "OriginalImageFormat",
                table: "ChapterFiles",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PageConversionHistory",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ChapterFileId = table.Column<int>(type: "INTEGER", nullable: false),
                    SeriesId = table.Column<int>(type: "INTEGER", nullable: false),
                    ChapterId = table.Column<int>(type: "INTEGER", nullable: true),
                    PassId = table.Column<string>(type: "TEXT", nullable: true),
                    TrashPath = table.Column<string>(type: "TEXT", nullable: true),
                    TrashBytes = table.Column<long>(type: "INTEGER", nullable: true),
                    Action = table.Column<string>(type: "TEXT", nullable: false),
                    BytesBefore = table.Column<long>(type: "INTEGER", nullable: false),
                    BytesAfter = table.Column<long>(type: "INTEGER", nullable: false),
                    SourceFormat = table.Column<string>(type: "TEXT", nullable: true),
                    ResultFormat = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UndoneAtUtc = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PageConversionHistory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PageConversionHistory_Series_SeriesId",
                        column: x => x.SeriesId,
                        principalTable: "Series",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PageConversionRules",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Order = table.Column<int>(type: "INTEGER", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    ConditionsJson = table.Column<string>(type: "TEXT", nullable: false),
                    Skip = table.Column<bool>(type: "INTEGER", nullable: false),
                    Stop = table.Column<int>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PageConversionRules", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PageConversionHistory_SeriesId_UndoneAtUtc",
                table: "PageConversionHistory",
                columns: new[] { "SeriesId", "UndoneAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PageConversionHistory");

            migrationBuilder.DropTable(
                name: "PageConversionRules");

            migrationBuilder.DropColumn(
                name: "PageConversion",
                table: "Series");

            migrationBuilder.DropColumn(
                name: "CheckedWith",
                table: "ChapterFiles");

            migrationBuilder.DropColumn(
                name: "ConversionCheckedAtUtc",
                table: "ChapterFiles");

            migrationBuilder.DropColumn(
                name: "ConversionSavedBytes",
                table: "ChapterFiles");

            migrationBuilder.DropColumn(
                name: "OriginalImageFormat",
                table: "ChapterFiles");
        }
    }
}
