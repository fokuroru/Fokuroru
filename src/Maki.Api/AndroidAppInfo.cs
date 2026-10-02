using System.Reflection;

namespace Maki.Api;

/// <summary>
/// The newest Android app build this server was released with, read from android/version.properties,
/// so the app can tell its own user when it is behind. Null when the file did not make it into the build.
/// </summary>
public static class AndroidAppInfo
{
    public sealed record Build(int VersionCode, string VersionName);

    public static Build? Current { get; } = Read();

    internal static Build? Parse(string text)
    {
        var values = text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(line => line.Split('=', 2))
            .Where(parts => parts.Length == 2)
            .ToDictionary(parts => parts[0].Trim(), parts => parts[1].Trim());

        return values.TryGetValue("versionCode", out var code) && int.TryParse(code, out var number) &&
               values.TryGetValue("versionName", out var name) && name.Length > 0
            ? new Build(number, name)
            : null;
    }

    private static Build? Read()
    {
        using var stream = typeof(AndroidAppInfo).Assembly.GetManifestResourceStream("Maki.Android.version.properties");
        if (stream is null)
        {
            return null;
        }

        using var reader = new StreamReader(stream);
        return Parse(reader.ReadToEnd());
    }
}
