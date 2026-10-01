using Maki.Api.Localization;
using Maki.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Maki.Api.Controllers;

/// <summary>
/// The user's own GLB figures for the Home shelf. Everything is scoped to the signed-in user through
/// <see cref="ShelfFigureStore"/>, so there is nothing to authorize beyond being signed in.
/// </summary>
[ApiController]
[Route("api/v1/shelf-figures")]
public class ShelfFiguresController(ShelfFigureStore store, ILocalizer localizer) : ControllerBase
{
    private static object Shape(ShelfFigure f) =>
        new { f.Id, f.Name, f.Size, f.AddedAt, f.Textured, Url = $"/api/v1/shelf-figures/{f.Id}/file" };

    [HttpGet]
    public IActionResult List() => Ok(new
    {
        maxCount = ShelfFigureStore.MaxCount,
        maxMegabytes = ShelfFigureStore.MaxBytes / (1024 * 1024),
        figures = store.List().Select(Shape),
    });

    [HttpPost]
    // Room above the real limit, so an oversized file reaches the check below and gets a readable message
    // instead of the framework's generic 400.
    [RequestSizeLimit(64L * 1024 * 1024)]
    public async Task<IActionResult> Upload(IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
        {
            return this.Fail(localizer, "error.figures.noFile");
        }

        if (file.Length > ShelfFigureStore.MaxBytes)
        {
            return this.Fail(localizer, "error.figures.tooLarge", new { max = ShelfFigureStore.MaxBytes / (1024 * 1024) });
        }

        try
        {
            await using var stream = file.OpenReadStream();
            return Ok(Shape(await store.SaveAsync(stream, file.FileName, ct)));
        }
        catch (ShelfFigureException ex)
        {
            return this.Fail(localizer, ex.Key, ex.Args);
        }
    }

    [HttpGet("{id}/file")]
    public IActionResult File(string id)
    {
        var path = store.PathOf(id);
        if (path is null)
        {
            return NotFound();
        }

        // The id is a fresh guid per upload, so the bytes behind a URL never change.
        Response.Headers.CacheControl = "private, max-age=31536000, immutable";
        return PhysicalFile(path, "model/gltf-binary");
    }

    [HttpDelete("{id}")]
    public IActionResult Delete(string id) => store.Delete(id) ? NoContent() : NotFound();
}
