using Maki.Api.Auth;
using Microsoft.Extensions.Time.Testing;

namespace Maki.Api.Tests;

public class DevicePairingTests
{
    [Fact]
    public void A_device_gets_its_token_once_after_approval()
    {
        var pairing = new DevicePairing(new FakeTimeProvider());
        var request = pairing.Start("Kindle")!;

        Assert.Equal((true, null), pairing.Poll(request.Secret));
        Assert.True(pairing.Complete(request.Id, "tok"));
        Assert.Equal((true, "tok"), pairing.Poll(request.Secret));
        Assert.False(pairing.Poll(request.Secret).Known);
    }

    [Fact]
    public void A_request_expires_and_the_waiting_list_is_capped()
    {
        var clock = new FakeTimeProvider();
        var pairing = new DevicePairing(clock);
        var first = pairing.Start("a")!;
        for (var i = 0; i < 9; i++) Assert.NotNull(pairing.Start("x"));
        Assert.Null(pairing.Start("overflow"));

        clock.Advance(DevicePairing.Lifetime + TimeSpan.FromSeconds(1));

        Assert.False(pairing.Poll(first.Secret).Known);
        Assert.Empty(pairing.Waiting());
        Assert.NotNull(pairing.Start("again"));
    }

    [Fact]
    public void A_denied_request_cannot_be_approved()
    {
        var pairing = new DevicePairing(new FakeTimeProvider());
        var request = pairing.Start(null)!;

        Assert.True(pairing.Deny(request.Id));
        Assert.Null(pairing.Find(request.Id));
        Assert.False(pairing.Complete(request.Id, "tok"));
    }
}
