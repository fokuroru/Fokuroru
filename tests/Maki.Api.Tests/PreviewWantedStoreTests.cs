using Maki.Api.Services;
using Microsoft.Extensions.Time.Testing;

namespace Maki.Api.Tests;

/// <summary>A preview that fails is not dropped: it is tried again a day later and survives a restart.</summary>
public class PreviewWantedStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "maki-wanted-tests", Guid.NewGuid().ToString("N"));
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 10, 7, 3, 0, 0, TimeSpan.Zero));

    public void Dispose()
    {
        try
        {
            Directory.Delete(_dir, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private PreviewWantedStore Store() => new(Path.Combine(_dir, "wanted.json"), _time);

    [Fact]
    public void Failed_preview_is_due_a_day_later_and_not_before()
    {
        var store = Store();
        store.Want(42);
        store.Failed(42);

        Assert.Empty(store.Due(_ => false));
        _time.Advance(TimeSpan.FromHours(23));
        Assert.Empty(store.Due(_ => false));
        _time.Advance(TimeSpan.FromHours(2));
        Assert.Equal([42L], store.Due(_ => false));
    }

    [Fact]
    public void Failing_again_counts_the_attempt_and_waits_another_day()
    {
        var store = Store();
        store.Want(42);
        store.Failed(42);
        _time.Advance(TimeSpan.FromDays(1));
        store.Want(42);
        store.Failed(42);

        Assert.Equal(2, store.Get(42)!.Attempts);
        Assert.Empty(store.Due(_ => false));
    }

    [Fact]
    public void Entry_survives_a_restart_and_an_unfinished_one_is_due_when_nothing_runs_for_it()
    {
        Store().Want(7);

        var restarted = Store();
        Assert.Equal([7L], restarted.Due(_ => false));
        Assert.Empty(restarted.Due(_ => true));
    }

    [Fact]
    public void Removed_or_unknown_previews_are_not_retried()
    {
        var store = Store();
        store.Want(1);
        store.Remove(1);
        store.Failed(1);
        store.Failed(2);

        Assert.Empty(store.Due(_ => false));
        Assert.Null(Store().Get(1));
    }
}
