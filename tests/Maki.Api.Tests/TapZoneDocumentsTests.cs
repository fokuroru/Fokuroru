using Maki.Api.Services;
using Xunit;

namespace Maki.Api.Tests;

public class TapZoneDocumentsTests
{
    private static TapZoneDocument Doc(List<TapZone>? horizontal = null, List<TapZonePreset>? presets = null) =>
        new(horizontal, null, presets ?? []);

    [Fact]
    public void An_untouched_document_stays_untouched()
    {
        var tidied = TapZoneDocuments.Tidy(TapZoneDocuments.Empty);
        Assert.NotNull(tidied);
        Assert.Null(tidied.Horizontal);
        Assert.Null(tidied.Vertical);
        Assert.Empty(tidied.Presets!);
    }

    [Fact]
    public void Zones_are_clamped_onto_the_page_and_rounded()
    {
        var tidied = TapZoneDocuments.Tidy(Doc([new TapZone(-0.4, 0.9, 2, 0.5, "next"), new TapZone(0.123456, 0.2, 0.3, 0.4, "menu")]));
        var first = tidied!.Horizontal![0];
        Assert.Equal(0, first.X);
        Assert.Equal(1, first.W);
        Assert.Equal(0.9, first.Y);
        Assert.Equal(0.1, first.H, 3);
        Assert.Equal(0.123, tidied.Horizontal![1].X);
    }

    [Fact]
    public void A_zone_never_shrinks_below_something_tappable()
    {
        var zone = TapZoneDocuments.Tidy(Doc([new TapZone(0.2, 0.2, 0, 0, "next")]))!.Horizontal![0];
        Assert.Equal(TapZoneDocuments.MinSide, zone.W);
        Assert.Equal(TapZoneDocuments.MinSide, zone.H);
    }

    [Theory]
    [InlineData("delete everything")]
    [InlineData("")]
    [InlineData("NEXT")]
    public void An_unknown_action_is_refused(string action)
    {
        Assert.Null(TapZoneDocuments.Tidy(Doc([new TapZone(0, 0, 0.5, 0.5, action)])));
    }

    [Fact]
    public void Not_a_number_is_refused()
    {
        Assert.Null(TapZoneDocuments.Tidy(Doc([new TapZone(double.NaN, 0, 0.5, 0.5, "next")])));
        Assert.Null(TapZoneDocuments.Tidy(Doc([new TapZone(0, 0, double.PositiveInfinity, 0.5, "next")])));
    }

    [Fact]
    public void Too_many_zones_are_refused()
    {
        var zones = Enumerable.Range(0, TapZoneDocuments.MaxZones + 1).Select(_ => new TapZone(0, 0, 0.1, 0.1, "menu")).ToList();
        Assert.Null(TapZoneDocuments.Tidy(Doc(zones)));
        Assert.NotNull(TapZoneDocuments.Tidy(Doc(zones.Take(TapZoneDocuments.MaxZones).ToList())));
    }

    [Fact]
    public void Presets_need_a_name_an_orientation_and_a_unique_id()
    {
        var ok = new TapZonePreset("a1", "  Wide edges  ", "horizontal", [new TapZone(0, 0, 0.2, 1, "prev")]);
        Assert.Equal("Wide edges", TapZoneDocuments.Tidy(Doc(presets: [ok]))!.Presets![0].Name);

        Assert.Null(TapZoneDocuments.Tidy(Doc(presets: [ok with { Name = "   " }])));
        Assert.Null(TapZoneDocuments.Tidy(Doc(presets: [ok with { Name = new string('x', 41) }])));
        Assert.Null(TapZoneDocuments.Tidy(Doc(presets: [ok with { Orientation = "diagonal" }])));
        Assert.Null(TapZoneDocuments.Tidy(Doc(presets: [ok with { Id = "has space" }])));
        Assert.Null(TapZoneDocuments.Tidy(Doc(presets: [ok, ok with { Name = "Other" }])));
    }

    [Fact]
    public void Too_many_presets_are_refused()
    {
        var presets = Enumerable.Range(0, TapZoneDocuments.MaxPresets + 1)
            .Select(i => new TapZonePreset($"p{i}", $"Preset {i}", "horizontal", []))
            .ToList();
        Assert.Null(TapZoneDocuments.Tidy(Doc(presets: presets)));
    }

    [Fact]
    public void A_stored_document_round_trips_in_camel_case()
    {
        var doc = Doc([new TapZone(0, 0, 0.3, 1, "prev")], [new TapZonePreset("p1", "Mine", "vertical", [])]);
        var json = TapZoneDocuments.Serialize(doc);
        Assert.Contains("\"horizontal\"", json);
        Assert.Contains("\"action\":\"prev\"", json);
        var parsed = TapZoneDocuments.Parse(json);
        Assert.Equal("Mine", parsed.Presets![0].Name);
        Assert.Equal("prev", parsed.Horizontal![0].Action);
    }

    [Fact]
    public void A_damaged_stored_value_reads_as_nothing_saved()
    {
        Assert.Null(TapZoneDocuments.Parse("{not json").Horizontal);
        Assert.Null(TapZoneDocuments.Parse(null).Horizontal);
        Assert.Empty(TapZoneDocuments.Parse("").Presets!);
    }
}
