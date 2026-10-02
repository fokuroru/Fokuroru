using Xunit;

namespace Maki.Api.Tests;

public class AndroidAppInfoTests
{
    [Fact]
    public void Parse_ReadsCodeAndName()
    {
        var build = AndroidAppInfo.Parse("versionCode=5\nversionName=0.1.4\nserverVersion=0.31.1-fok.69\n");

        Assert.Equal(new AndroidAppInfo.Build(5, "0.1.4"), build);
    }

    [Fact]
    public void Parse_ReturnsNullWhenIncomplete()
    {
        Assert.Null(AndroidAppInfo.Parse("versionName=0.1.4"));
    }

    [Fact]
    public void Current_IsEmbedded()
    {
        Assert.NotNull(AndroidAppInfo.Current);
    }
}
