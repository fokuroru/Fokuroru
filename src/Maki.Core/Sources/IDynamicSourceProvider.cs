namespace Maki.Core.Sources;

/// <summary>
/// A set of sources discovered while the app runs rather than registered at startup, such as the
/// extensions installed in a Suwayomi server. <see cref="SourceRegistry"/> serves them next to the
/// fixed ones, so everything that looks a source up by name or lists them all treats them alike.
/// <para>
/// <see cref="Sources"/> is a snapshot that may change between reads; callers hold the sources they
/// are handed, not the collection.
/// </para>
/// </summary>
public interface IDynamicSourceProvider
{
    IReadOnlyCollection<ISource> Sources { get; }

    /// <summary>
    /// A source by persisted name, or null when this provider does not own the name. May answer for a
    /// name missing from <see cref="Sources"/> (not discovered yet, or its server is down) so a mapping
    /// that already exists keeps working.
    /// </summary>
    ISource? Find(string name);
}
