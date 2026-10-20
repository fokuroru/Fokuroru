using Maki.Core.Reading;

namespace Maki.Core.Tests;

public class DuplicatePlannerTests
{
    // Pages are 64-bit hashes; distinct random values are far apart, a flipped bit or two is the same page.
    private static ulong[] Pages(int seed, int from, int count)
    {
        var all = new ulong[from + count];
        var rng = new Random(seed);
        for (var i = 0; i < all.Length; i++)
        {
            var bytes = new byte[8];
            rng.NextBytes(bytes);
            all[i] = BitConverter.ToUInt64(bytes);
        }

        return all[from..];
    }

    private static ulong[] Noisy(ulong[] pages) => pages.Select(p => p ^ 0b101UL).ToArray();

    private static PlanFile F(int id, FileClass cls, ulong[] pages, int tier = 0) => new(id, cls, tier, pages.Length, pages);

    private static List<int> Removed(params PlanFile[] files) => DuplicatePlanner.Plan(files).Select(r => r.FileId).Order().ToList();

    [Fact]
    public void A_site_copy_of_a_volume_and_whole_volume_dumps_go_and_the_marked_volume_stays()
    {
        var volume = Pages(1, 0, 60);
        var removed = Removed(
            F(1, FileClass.MarkedVolume, volume, tier: 5),
            F(2, FileClass.Volume, Noisy(volume), tier: 2),
            F(3, FileClass.Dump, Noisy(volume)),
            F(4, FileClass.Dump, Noisy(volume)));

        Assert.Equal([2, 3, 4], removed);
    }

    [Fact]
    public void Loose_chapters_inside_a_volume_go_and_one_outside_stays()
    {
        var volume = Pages(2, 0, 40);
        var removed = Removed(
            F(1, FileClass.MarkedVolume, volume),
            F(2, FileClass.Loose, volume[0..5]),
            F(3, FileClass.Loose, volume[10..15]),
            F(4, FileClass.Loose, Pages(99, 0, 5)));

        Assert.Equal([2, 3], removed);
    }

    [Fact]
    public void A_dump_never_stands_in_for_the_chapters_it_contains()
    {
        var chapters = Pages(3, 0, 40);
        // Only half of the dump's pages exist as loose chapters, so the dump is not redundant, and the
        // loose chapters must not be thrown away for it.
        var dump = F(1, FileClass.Dump, chapters);
        var loose = new[] { F(2, FileClass.Loose, chapters[0..5]), F(3, FileClass.Loose, chapters[5..10]) };

        Assert.Empty(Removed([dump, .. loose]));
    }

    [Fact]
    public void A_dump_whose_pages_are_all_there_as_loose_chapters_goes()
    {
        var chapters = Pages(4, 0, 12);
        var removed = Removed(
            F(1, FileClass.Dump, chapters),
            F(2, FileClass.Loose, chapters[0..4]),
            F(3, FileClass.Loose, chapters[4..8]),
            F(4, FileClass.Loose, chapters[8..12]));

        Assert.Equal([1], removed);
    }

    [Fact]
    public void Of_two_equal_volumes_the_better_tier_then_the_bigger_then_the_older_survives()
    {
        var volume = Pages(5, 0, 30);

        Assert.Equal([1], Removed(F(1, FileClass.Volume, volume, tier: 1), F(2, FileClass.Volume, volume, tier: 4)));
        Assert.Equal([3], Removed(F(2, FileClass.Volume, volume, tier: 4), F(3, FileClass.Volume, volume, tier: 4)));
    }

    [Fact]
    public void A_pinned_file_stays_and_flat_or_short_files_are_not_judged()
    {
        var volume = Pages(6, 0, 30);
        var pinned = new HashSet<int> { 2 };
        var removed = DuplicatePlanner.Plan(
            [F(1, FileClass.MarkedVolume, volume), F(2, FileClass.Dump, volume), F(3, FileClass.Loose, volume[0..2])],
            pinned);

        Assert.Empty(removed);
    }

    [Fact]
    public void A_removal_that_loses_its_stand_in_is_kept()
    {
        // L is covered by the site volume S, but S is only 92% of the torrent volume T: once S goes (T covers
        // it), L's pages that T lacks would be gone too, so L has to stay.
        var all = Pages(7, 0, 100);
        var torrent = all[0..92];
        var site = all[0..100];
        var loose = all[93..98];

        var removed = DuplicatePlanner.Plan(
            [F(1, FileClass.MarkedVolume, torrent), F(2, FileClass.Volume, site), F(3, FileClass.Loose, loose)]);

        Assert.DoesNotContain(removed, r => r.FileId == 3);
        Assert.Contains(removed, r => r.FileId == 2);
    }
}
