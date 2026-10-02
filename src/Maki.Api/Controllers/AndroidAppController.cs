using Maki.Api.Configuration;
using Microsoft.AspNetCore.Mvc;

namespace Maki.Api.Controllers;

/// <summary>
/// The Android app, when the operator has put one in the config folder. Any signed-in person may download it;
/// <c>/initialize.json</c> says whether there is one to offer.
/// </summary>
[ApiController]
[Route("api/v1/android")]
public class AndroidAppController(AppPaths paths) : ControllerBase
{
    [HttpGet("apk")]
    public IActionResult Apk()
    {
        var file = AndroidAppInfo.ApkPath(paths);
        return System.IO.File.Exists(file)
            ? PhysicalFile(file, "application/vnd.android.package-archive", "fokuroru.apk")
            : NotFound();
    }
}
