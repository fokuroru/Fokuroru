using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Maki.Data.Migrations
{
    /// <inheritdoc />
    public partial class ChapterFilePageHashes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ChapterFilePageHashes",
                columns: table => new
                {
                    ChapterFileId = table.Column<int>(type: "INTEGER", nullable: false),
                    Hashes = table.Column<byte[]>(type: "BLOB", nullable: false),
                    Key = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChapterFilePageHashes", x => x.ChapterFileId);
                    table.ForeignKey(
                        name: "FK_ChapterFilePageHashes_ChapterFiles_ChapterFileId",
                        column: x => x.ChapterFileId,
                        principalTable: "ChapterFiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChapterFilePageHashes");
        }
    }
}
