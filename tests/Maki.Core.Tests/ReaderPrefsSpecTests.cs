using Maki.Core.Reading;

namespace Maki.Core.Tests;

public class ReaderPrefsSpecTests
{
    [Fact]
    public void Navigation_and_smooth_scroll_survive_a_round_trip()
    {
        var spec = new ReaderPrefsSpec(Navigation: ReaderPrefsSpec.NavVertical, SmoothScroll: false);

        var back = ReaderPrefsSpec.Parse(ReaderPrefsSpec.Serialize(spec));

        Assert.Equal(ReaderPrefsSpec.NavVertical, back.Navigation);
        Assert.False(back.SmoothScroll);
    }

    [Fact]
    public void An_unknown_navigation_falls_back_to_auto()
    {
        var back = ReaderPrefsSpec.Parse("""{"navigation":"diagonal"}""");

        Assert.Equal(ReaderPrefsSpec.NavAuto, back.Navigation);
    }

    [Fact]
    public void Prefs_stored_before_the_fields_existed_read_as_auto_and_smooth()
    {
        var back = ReaderPrefsSpec.Parse("""{"mode":"vertical","fit":"width"}""");

        Assert.Equal(ReaderPrefsSpec.NavAuto, back.Navigation);
        Assert.True(back.SmoothScroll);
    }
}
