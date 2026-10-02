using Maki.Api.Auth;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace Maki.Api.Tests;

public class AppPairingTests
{
    private static (AppPairing Pairing, FakeTimeProvider Clock) Make()
    {
        var clock = new FakeTimeProvider();
        return (new AppPairing(clock), clock);
    }

    [Fact]
    public void ACodeSignsInItsOwnerOnce()
    {
        var (pairing, _) = Make();
        var (code, _) = pairing.Create(7);

        Assert.Equal(7, pairing.Redeem(code));
        Assert.Null(pairing.Redeem(code));
    }

    [Fact]
    public void ACodeExpiresAfterFiveMinutes()
    {
        var (pairing, clock) = Make();
        var (code, _) = pairing.Create(7);

        clock.Advance(AppPairing.Lifetime + TimeSpan.FromSeconds(1));

        Assert.Null(pairing.Redeem(code));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-code")]
    public void UnknownCodesAreRefused(string? code)
    {
        var (pairing, _) = Make();
        pairing.Create(7);

        Assert.Null(pairing.Redeem(code));
    }

    [Fact]
    public void EachCodeIsDifferent()
    {
        var (pairing, _) = Make();

        Assert.NotEqual(pairing.Create(1).Code, pairing.Create(1).Code);
    }
}
