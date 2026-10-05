namespace Maki.Core.Sources;

/// <summary>
/// Lookup over all registered ISource implementations, plus any a <see cref="IDynamicSourceProvider"/>
/// discovers at runtime.
/// </summary>
public class SourceRegistry(IEnumerable<ISource> sources, IEnumerable<IDynamicSourceProvider>? dynamicProviders = null)
{
    private readonly Dictionary<string, ISource> _byName =
        sources.ToDictionary(s => s.Name, StringComparer.OrdinalIgnoreCase);

    private readonly IDynamicSourceProvider[] _providers = dynamicProviders?.ToArray() ?? [];

    public IReadOnlyCollection<ISource> All =>
        _providers.Length == 0
            ? _byName.Values
            : _byName.Values.Concat(_providers.SelectMany(p => p.Sources)).ToList();

    public ISource? Find(string name) =>
        _byName.GetValueOrDefault(name) ?? _providers.Select(p => p.Find(name)).FirstOrDefault(s => s is not null);

    public ISource GetRequired(string name) =>
        Find(name) ?? throw new InvalidOperationException($"Unknown source: {name}");
}
