# <img src="frontend/public/brand/fokuroru-icon-colour-light.svg" width="50" alt=""> Fōkurōru

Fōkurōru is a personal fork of [Maki](https://github.com/OrbitMPGH/Maki) by OrbitMPGH. **Most of
the changes in this fork were written by AI.** It is maintained for my own use
(so it'll probs break for you: no support and no promises).

For the original application's installation, configuration and documentation, see the
[original project](https://github.com/OrbitMPGH/Maki). Problems with Maki itself belong upstream,
not here. The code, folders and container names still say Maki, and the
[GPLv3 licence](LICENSE) carries over unchanged.

## Why the Fork?

So far, Maki has been the closest thing to what I want out of a manga manager, but there were a couple of missing features that'll likely appear down the line. I impatiently decided to move away from my existing setup and commit to Maki instead, but of course, I needed to tweak the product before it eventually gets built into the real deal. Ideally, I'd prefer using someone else's product as I have no appetite in handling my own garbage code. 

Also, I added an Android app and a Suwayomi integration. 

## Comparison baseline

This list covers the code through [`260ae76c`](https://github.com/fokuroru/Fokuroru/commit/260ae76c),
the source exported as `0.31.1-fok.33` on 1 October 2026.

The fork starts from Maki commit
[`95f38c03`](https://github.com/OrbitMPGH/Maki/commit/95f38c03191d06371e2608b38a779aa51183a4e5)
(`fix(reader): order "what's next" over the whole series`). It subsequently merged
[Maki v0.31.1](https://github.com/OrbitMPGH/Maki/commit/091f00ad11d6c3aa4ccac48e8c54a4a2e3ac6055)
and upstream `dev` through
[`56e98365`](https://github.com/OrbitMPGH/Maki/commit/56e98365903cfa6592d76f7cd39f4ba8dd1e161f).

The sections below list Fōkurōru's own changes. The complete commit list follows them, including
intermediate changes that were later replaced. Features that came from Maki, before or after the
fork, are not documented here.

## Fōkurōru changes

### Identity and appearance

- Renamed the application Fōkurōru and added its logo, wordmark, favicon, touch icon and PWA icons.
- Replaced the appearance with the Spine design: warm charcoal and bone, square corners,
  Zen Kaku Gothic New for text and Martian Mono for figures, with matching Stats and Rewind screens.
- Sampled a spine colour from each series' cover for its pages, tiles and reading progress line.
- Kept dark, light and system themes. Upstream's separate background and accent pickers,
  appearance announcement and mascot styling are not used in the current fork.
- Pointed repository links, issue links, update checks and the Docker image workflow at
  `fokuroru/Fokuroru`.
- Replaced the upstream README with fork documentation, removed obsolete screenshots and planning
  documents, and ignored macOS `.DS_Store` files.

### Home bookshelf and chalkboard

- Added a 3D Reading now shelf using Three.js and Matter.js. It displays the last few read series and showcases reader stats. It also has a handful of random surprizes buried in it and seasonal changes. 

### Library and reading status

- Added Last read sorting and separate Reading, Up to date and Completed states.
  Completed requires every main chapter to be read and the series to be ended or on hiatus.
  A running series with every main chapter read is Up to date.
- Applied completion rules to tracker updates and retained reading history when files are removed.
- Fixed mobile and foldable layouts, including the hero panel.
- Added Hide and Delete buttons to every card in the layout editor.
- Merged Automation into System navigation and moved Import there.

### Adding series and chapter actions

- Added source links to read chapter 1 before adding a series, without saving it to the library.
- Added Search on links for Comix and MangaDot to the series page.
- Made Read choose the earliest unread main chapter, even when unavailable locally or when a
  later chapter was read out of order. Unwanted specials and one-shots are skipped.
- Added Download & read to fetch the next chapter when it is not on disk, then open it.
- Added measured page counts and per-chapter file deletion to the chapter table.
- Added Mark previous chapters as read from a chapter's menu.
- Displayed when a read chapter's file is due for automatic deletion.

### Downloads and file retention

- Made Smart Download the default for new series and started its first batch without requiring
  an initial manual read or download. Later batches start after the furthest read chapter.
- Added automatic deletion of read chapters after a configurable number of days, based on their
  completion timestamps. Read history remains, and deleted chapters become not wanted so they
  are not downloaded again.
- Applied the same retained-history and not-wanted behaviour to manual chapter deletion.
- Protected shared files, including files referenced through overlapping root folders; a volume
  file remains while another chapter still needs it.
- Added an optional Keep the last chapter read setting. It protects each reader's most recently
  completed chapter in each series from automatic deletion. It is off by default.

### Reader

- Added vertical navigation and smooth scrolling for long strips.
- Added a zoom slider that works with every fit mode, including narrowing webtoon strips on wide
  screens, and a reading progress line using the series' spine colour.

### Android app

- Added an Android app in `android/`: the web UI in a WebView, plus volume key, Bluetooth clicker,
  headset and stylus page turns, brightness, rotation, immersive and notch controls, and two pages
  on tablets and unfolded foldables.
- Chapters can be saved to the device and read with no network. Progress read offline is queued and
  sent when the connection returns. A background sync refreshes a Reading now widget and the
  Continue reading and Latest chapter shortcuts, saves upcoming chapters and clears out read ones.
  The app opens on a simple view (last read hero, Continue reading, library grid) that can be
  switched to the full interface. See [android/README.md](android/README.md).

### Platform, migrations and account isolation

- Added an installable PWA with a service worker caching the app shell and hashed build assets.
  API requests, SignalR, covers and chapter pages remain network-only; this does not provide
  offline chapter reading. The manifest supports credentialed loading behind browser authentication.
- Made Docker's `/app` files readable by the runtime `PUID` user.
- Added an idempotent startup repair restoring `Series.SpineColor` if an older upstream migration
  rebuilds the Series table without it.
- Cleared account-specific query data after logout, unauthorised responses and account changes.
- Added regression tests for reader selection, reading status, downloads, deletion, page counts,
  schema repair, spine colours and figure uploads, plus `npm run check:shelf-physics`.
- Extracted new interface strings into the existing translation catalogues.

## Complete commit list

The list below includes all 163 non-merge commits reachable from the comparison snapshot but not
from the original fork point. Entries marked **Upstream** are also present in the last merged
upstream `dev` commit; entries marked **Fork** are not. Subjects describe the history, including
fixes to earlier commits and appearance experiments that are no longer active.

The upstream integrations themselves are
[`e153c9e7`](https://github.com/fokuroru/Fokuroru/commit/e153c9e7) (v0.31.1) and
[`a84de908`](https://github.com/fokuroru/Fokuroru/commit/a84de908) (`dev`).

<details>
<summary>Show every change, oldest first</summary>

- **Upstream** [668622b0](https://github.com/fokuroru/Fokuroru/commit/668622b019559dc205fa51d80c1a65d4fe965cd8): feat(quality): record chapter file provenance and page measurements
- **Upstream** [c68a878d](https://github.com/fokuroru/Fokuroru/commit/c68a878d366e5dff1a783cff1e14358de910f1e6): feat(upgrades): quality profiles, formats, scorer and cutoff-unmet list
- **Upstream** [0db728cb](https://github.com/fokuroru/Fokuroru/commit/0db728cb670c604687f4beb4399da4b95ce0b2b1): feat(upgrades): automatic chapter upgrades with probe, trash and revert
- **Upstream** [44cd2433](https://github.com/fokuroru/Fokuroru/commit/44cd243316112a8ff85ab87786ccc79aae29b1c7): feat(upgrades): manual upgrades, scored compare columns and gated re-downloads
- **Fork** [93b69069](https://github.com/fokuroru/Fokuroru/commit/93b6906961801a4f8b2411764e705e4e2f4e78c6): fix: Smart Download starts on its own, auto-delete read chapters, hero panel on foldables
- **Fork** [7c60061b](https://github.com/fokuroru/Fokuroru/commit/7c60061bb98d54349d41c646bfdec9295d43cdd7): feat(monitoring): new series default to Smart Download
- **Fork** [2368e9df](https://github.com/fokuroru/Fokuroru/commit/2368e9df52faf4d3beaac7499aa64ae1f20ff5d3): feat(ui): Maki Spine identity, tokens, type and shape
- **Fork** [066abefb](https://github.com/fokuroru/Fokuroru/commit/066abefb76ad5cedadac55f7f58ce550a548a6fe): feat(series): sample a spine colour from every cover
- **Fork** [7bc33846](https://github.com/fokuroru/Fokuroru/commit/7bc33846536b97962e31ce4ae0dff56e8f892baa): wip(ui): Spine screens (series band, library shelf, home tiles, reader spine line)
- **Fork** [566c171e](https://github.com/fokuroru/Fokuroru/commit/566c171e79e1609fa98192965b7fbe23cf581db3): feat(reader): vertical navigation and smooth scrolling for long strips
- **Fork** [9abd7dd2](https://github.com/fokuroru/Fokuroru/commit/9abd7dd236343233fba47d376956f8c7d6c6879d): feat(ui): finish the Spine screens
- **Fork** [a69c2d70](https://github.com/fokuroru/Fokuroru/commit/a69c2d709422549ff3ce7a081beeb617951aad2b): feat(ui): Spine pass on Stats and Rewind
- **Fork** [7d546e9e](https://github.com/fokuroru/Fokuroru/commit/7d546e9e742edc0deba1143dd32527ff75a3d3bf): feat: Fōkurōru name, spine shelf, up to date vs completed, last read sort
- **Fork** [4db85a13](https://github.com/fokuroru/Fokuroru/commit/4db85a13737d42ee4fe2ea0356d865629e01eecd): feat(reader): zoom slider that works with every fit
- **Fork** [bae57015](https://github.com/fokuroru/Fokuroru/commit/bae570153706ff7de7d3e605dac3c5c5b906bc45): feat(brand): Fōkurōru logo
- **Upstream** [b1a242ad](https://github.com/fokuroru/Fokuroru/commit/b1a242ad27a1a279ea02802729e04790391569c0): feat(release): merge an open dev -> main PR with -Pr instead of merging locally
- **Upstream** [9733d6a8](https://github.com/fokuroru/Fokuroru/commit/9733d6a82061d3127f41e80361f78b1aea9c2a3d): fix(import): use the secure-context-safe randomUUID helper
- **Upstream** [978282dd](https://github.com/fokuroru/Fokuroru/commit/978282ddcf1f3f47cf9c008241aad3d2d3eb350b): docs: note that the SPA runs in a non-secure context on LAN installs
- **Upstream** [f6539f6a](https://github.com/fokuroru/Fokuroru/commit/f6539f6a29c381c876872b2cf11ceb3c811d48f1): ci(frontend): fail the build on secure-context-only browser APIs
- **Upstream** [91c585c3](https://github.com/fokuroru/Fokuroru/commit/91c585c3583307e959a017cadac59b1db48c0d68): feat(sources): name the languages behind source language pills
- **Upstream** [cf730536](https://github.com/fokuroru/Fokuroru/commit/cf7305362f1bdf5a125218a3e48af4001dfc3746): fix(recommendations): stop the settings status waiting on the catalogue count
- **Upstream** [296d1a99](https://github.com/fokuroru/Fokuroru/commit/296d1a995eed282c1bae0671d2549f1937144ee3): fix(health): treat partial analysis as a hint, not a finding
- **Upstream** [c9272744](https://github.com/fokuroru/Fokuroru/commit/c9272744f20cc914629637c9457dc23523664a56): feat(home): offer unadded manga on the "Continue from the anime" rail
- **Upstream** [cd4bc67f](https://github.com/fokuroru/Fokuroru/commit/cd4bc67f02ad4b68c650c2570823da9c8a5c2eee): feat(discover): filter by creator, follow creators, notify on their new series
- **Upstream** [7320009f](https://github.com/fokuroru/Fokuroru/commit/7320009faa2133a280a7f416406651a3a823b86a): feat(series): remember chapter filter and add sort order toggle
- **Upstream** [154893c5](https://github.com/fokuroru/Fokuroru/commit/154893c5184c37b685a0a7e40b60acbccdd5a8ab): fix(settings): copy buttons work over plain HTTP
- **Upstream** [58a8ca32](https://github.com/fokuroru/Fokuroru/commit/58a8ca32e85dbfd77e4bf8ede8330d5ac83727ce): fix(startup): skip the pre-migration backup on a fresh database
- **Upstream** [d783776f](https://github.com/fokuroru/Fokuroru/commit/d783776fb17962b632091f433d3e5479f5be95bc): docs(release): add release checklist and reusable test fixtures
- **Upstream** [d6ad0f16](https://github.com/fokuroru/Fokuroru/commit/d6ad0f16217d38a6626a1981d0bcc523b3d706a4): build(docker): keep release-test fixtures out of the build context
- **Fork** [fba78558](https://github.com/fokuroru/Fokuroru/commit/fba785581125fa603bc72c8fc0233951ffd0cefc): fix: download & read, deleted chapters stay gone, review findings
- **Fork** [f3e453b4](https://github.com/fokuroru/Fokuroru/commit/f3e453b461569e3ca7f8ec2ae0556b484d1673b9): docs: README notes this is a fork of Maki; drop unused files
- **Upstream** [bd725706](https://github.com/fokuroru/Fokuroru/commit/bd725706cd9d70b9692df9bdc835ca443e5fe92a): test(startup): ignore the missing wwwroot warning on first boot
- **Upstream** [9ba275d3](https://github.com/fokuroru/Fokuroru/commit/9ba275d3c494f5c00089ec4a0f8e58b3ab243f5b): fix(follow,anime): close two races flagged in review
- **Upstream** [33c27127](https://github.com/fokuroru/Fokuroru/commit/33c27127bf76c6974331495a222ca0a2f442b9e4): fix(review): address code-review findings on the v0.31.1 PR
- **Upstream** [795a99df](https://github.com/fokuroru/Fokuroru/commit/795a99df919c42c1f342e34d9988aca9402ee4c5): i18n: translate 27 new strings across 10 locales
- **Fork** [2480bd46](https://github.com/fokuroru/Fokuroru/commit/2480bd464c1fb3bf08504aaa86444edc2f231bee): feat(pwa): service worker with offline app shell
- **Fork** [5b02b4d9](https://github.com/fokuroru/Fokuroru/commit/5b02b4d93b5f06864e36a5cf53b42a04e8364d08): fix(series): Read offers the earliest unread chapter, not the latest download
- **Fork** [5918d395](https://github.com/fokuroru/Fokuroru/commit/5918d395020eef834978ad9907354338908fff21): feat(series): page count column and per-chapter file delete
- **Fork** [7ef8c189](https://github.com/fokuroru/Fokuroru/commit/7ef8c189ac99c0bab22f00c78f8d770bce1359bf): fix(docker): make /app world-readable so the PUID user can read it
- **Upstream** [3580d53a](https://github.com/fokuroru/Fokuroru/commit/3580d53a35c990e4060e2990a851de586a964bf1): feat(upgrades): torrent volume releases with span verdicts and proposals
- **Fork** [c92f9ec5](https://github.com/fokuroru/Fokuroru/commit/c92f9ec56c3df6c3e1d25955f11dd239633c542a): fix(series): Read offers the earliest never-read chapter, past a stray read one
- **Upstream** [f802cf50](https://github.com/fokuroru/Fokuroru/commit/f802cf5071b2fdcae458641f63c93b441f4d9865): fix(upgrades): address review findings on the chapter upgrades PR
- **Upstream** [75425e86](https://github.com/fokuroru/Fokuroru/commit/75425e86b143e403cb535ceda6120edfcd87d949): fix(upgrades): address second code-review pass on chapter upgrades
- **Upstream** [2ed6016f](https://github.com/fokuroru/Fokuroru/commit/2ed6016f077712158687c32dc3da2008276132b0): feat(import): import library folders in parallel
- **Upstream** [8536d994](https://github.com/fokuroru/Fokuroru/commit/8536d994f37cd28979faa89dcd15bc7d8dc701fb): feat(ui): centred empty states for empty pages and 404s
- **Upstream** [385efdf1](https://github.com/fokuroru/Fokuroru/commit/385efdf1ed2e086efccc7e29031c5326f377b2e1): fix(ui): keep skeleton pulses in phase when more mount
- **Upstream** [baf812c4](https://github.com/fokuroru/Fokuroru/commit/baf812c48d3cacc876c7f1be7f420e8c445724f6): feat(series): MyAnimeList reviews in a drawer on the series page
- **Upstream** [1372427e](https://github.com/fokuroru/Fokuroru/commit/1372427ef8d30bd0439f810f7bb17b1e38e06ad3): feat(discover): preview the first chapter of a series before adding it
- **Upstream** [b9b5cf8e](https://github.com/fokuroru/Fokuroru/commit/b9b5cf8e18641fe030118135ffe526ad7ef38b90): fix(home): keep watched chapters off the Jump back in rail
- **Upstream** [60132e4f](https://github.com/fokuroru/Fokuroru/commit/60132e4f687351b28d8796120d961bd2a3f3255c): fix(ui): stop toast Undo buttons shrinking under long titles
- **Upstream** [2d9729af](https://github.com/fokuroru/Fokuroru/commit/2d9729afaa1ccf73c683d0037622dfa3ada5543e): fix(home): show every match on the Continue from the anime rail
- **Upstream** [66b90c59](https://github.com/fokuroru/Fokuroru/commit/66b90c59e39ba2e9575a42c81a962b92e5758dfe): feat(upgrades): score copies by measured resolution and compression
- **Upstream** [7b32ec11](https://github.com/fokuroru/Fokuroru/commit/7b32ec11bbe6c2d0e9c439f094f2a1d926860f26): feat(upgrades): remember each source's measured quality per series
- **Upstream** [cdb216eb](https://github.com/fokuroru/Fokuroru/commit/cdb216eb8accf6b42719aeb722183de1c1688637): feat(downloads): order sources by measured quality
- **Upstream** [9c6b3280](https://github.com/fokuroru/Fokuroru/commit/9c6b328057abf5364612ba773352f195192bcbf0): feat(sources): measure a series' sources up front, rate sources, new default order
- **Fork** [379daa96](https://github.com/fokuroru/Fokuroru/commit/379daa966192df8ec6e04d463944a0c524ab9049): fix(series): Read skips unwanted specials and one-shots
- **Upstream** [f4335e93](https://github.com/fokuroru/Fokuroru/commit/f4335e939fec3c9d490bc14b4b8743f9b7b30eb2): feat(upgrades): name and describe the starter profiles by what they do
- **Upstream** [cbe3c39d](https://github.com/fokuroru/Fokuroru/commit/cbe3c39d6af6be0f16e0af769a910afe8c489b4f): feat(ui): re-ground the palette on the mascot and set figures in the display face
- **Upstream** [698b1049](https://github.com/fokuroru/Fokuroru/commit/698b10497ff8d59619846836d3ede9d7b134f032): feat(library): bulk-set and filter by quality profile
- **Upstream** [025c546b](https://github.com/fokuroru/Fokuroru/commit/025c546bd4346351c12e7dc4313e9aab5de8eeb6): feat(ui): ledger panel, quieter section headers, flat nav, mascot empty states, cover chrome
- **Upstream** [8834a4c5](https://github.com/fokuroru/Fokuroru/commit/8834a4c5fee1f5eb9aa954dca786381444d66c0d): feat(series): show source measuring and upgrade scans as they run
- **Upstream** [895893b8](https://github.com/fokuroru/Fokuroru/commit/895893b8bab895a9f853df231f8d7372b58ae605): feat(settings): headings above the panels, Save and Discard only while a section is dirty
- **Fork** [852573f7](https://github.com/fokuroru/Fokuroru/commit/852573f7ad7ab00c318dd721b7f985752b31c474): feat(add): read chapter 1 on the sources before adding a series
- **Upstream** [0dd4d18c](https://github.com/fokuroru/Fokuroru/commit/0dd4d18cfb2ab1db42c51cca0df1cc91628df346): fix(upgrades): a scan asked for by hand tries every chapter, and says why not
- **Upstream** [edb2aef2](https://github.com/fokuroru/Fokuroru/commit/edb2aef211303ae50ba38899ae6277a35dd28593): docs(design-system): brand book for the re-grounded palette; ledger keeps its figures on one row
- **Upstream** [c57601c5](https://github.com/fokuroru/Fokuroru/commit/c57601c5fd1aa8ee8473eedf5ea2e84de1642f41): fix(series): drop the passed-over reasons from the last upgrade scan line
- **Upstream** [938c8acf](https://github.com/fokuroru/Fokuroru/commit/938c8acfcac400929c6ce5c35298a85812a065fe): fix(ui): review pass on the refresh
- **Upstream** [b7c55cdd](https://github.com/fokuroru/Fokuroru/commit/b7c55cdd51cb98b32a9d5a4c29832e7ed5d44800): feat(series): show each source's tier in the Quality column
- **Upstream** [a2a59299](https://github.com/fokuroru/Fokuroru/commit/a2a59299343047ab6f6fea66b044bab31da5c0b2): fix(theme): dark text on the pale blush fill in every Mantine component
- **Upstream** [38d308ba](https://github.com/fokuroru/Fokuroru/commit/38d308baac969b8feaa616e2e02bec1c19e83830): fix(library): size the add cell by the whole library; drop obsolete catalogue entries
- **Upstream** [7b4c3d44](https://github.com/fokuroru/Fokuroru/commit/7b4c3d441abf2a5cf0bbe3e913cfa15c8883fcd4): fix(theme): hotter blush fill, whiter ink, raised panels
- **Upstream** [f62adebc](https://github.com/fokuroru/Fokuroru/commit/f62adebc1a8e1c97367f7895835f48930c971607): feat(ui): use the accent-edge grammar across the app
- **Fork** [73cfff60](https://github.com/fokuroru/Fokuroru/commit/73cfff60ba1cb3f1663d5cf1ccee98ea958f1896): feat(library): 3D bookshelf for Reading now
- **Fork** [af3dfed7](https://github.com/fokuroru/Fokuroru/commit/af3dfed710419323c2f0ed1a60153b83b8c6d99d): fix(library): heavier, freer, messier 3D shelf
- **Fork** [9ba7d5f3](https://github.com/fokuroru/Fokuroru/commit/9ba7d5f3fc1c3017f0c16aa2b9c369fdd30a9bc0): fix(library): shelf in reading order, three quarters full at most
- **Fork** [22304982](https://github.com/fokuroru/Fokuroru/commit/2230498211be5982c78d7933214acb45f4422347): fix(library): subtle hover, no dragging books through the shelf
- **Fork** [57339d39](https://github.com/fokuroru/Fokuroru/commit/57339d39046fa59efa796a3089434534c8163d0d): feat(library): shelf spines use the reference's thirty editions
- **Fork** [057a8531](https://github.com/fokuroru/Fokuroru/commit/057a8531dbf49aab6315f1d14fe8e446765dd94a): fix(library): spine band shows only the chapter number
- **Fork** [2c3536ca](https://github.com/fokuroru/Fokuroru/commit/2c3536ca5cdd68df461ad1bde8705ffc7534f1d8): fix(library): shelf waits for covers; back covers blank
- **Fork** [78628894](https://github.com/fokuroru/Fokuroru/commit/78628894061dc0d3caf3d5a2d52308280c16bfe6): feat(library): books fall slightly open while moving
- **Fork** [40794928](https://github.com/fokuroru/Fokuroru/commit/407949280dc060e885ab2485d0d6ce1cbf6c80fa): fix(library): a flapping cover stays out of other books
- **Fork** [24c1e6c7](https://github.com/fokuroru/Fokuroru/commit/24c1e6c7f924168426ce3a1223f39383319ba70f): fix(library): books only fall open when moving fast; neater shelf
- **Fork** [8fafe387](https://github.com/fokuroru/Fokuroru/commit/8fafe387ced94b8252c0a106f5b302bcb940c8e4): feat(library): heavy landings make the shelf shudder
- **Fork** [7a1bf658](https://github.com/fokuroru/Fokuroru/commit/7a1bf65866ce18f3bc16b510f7e21373689029e5): feat(library): potted plant, random free space, part-read first chapters
- **Fork** [39e1d179](https://github.com/fokuroru/Fokuroru/commit/39e1d179d46cd4050d3691d1b7f87659a05c99e5): fix(library): plant leaves bend under books, and books tip off them
- **Fork** [390c818d](https://github.com/fokuroru/Fokuroru/commit/390c818dfcde3c432d7c3067a77560c4a1086382): Shelf plant: rigid body with a pointed leaf column, leaves bend round books visually
- **Fork** [4c9f8733](https://github.com/fokuroru/Fokuroru/commit/4c9f8733a5c942b6dfd8168ec9f613a27060851c): Shelf feels the page scroll: sharp starts and stops jolt the books
- **Upstream** [7f7983ae](https://github.com/fokuroru/Fokuroru/commit/7f7983ae42c7c42a0c5450797062a18bac9ac765): fix(ui): second review pass on the refresh
- **Upstream** [85fcf587](https://github.com/fokuroru/Fokuroru/commit/85fcf5879f7dac897ef645b7fd7f89f3fcdb37f2): perf(hosting): compress responses, cache SPA assets, tune SQLite, add hot-path indexes
- **Upstream** [196a3375](https://github.com/fokuroru/Fokuroru/commit/196a3375ac0bb63baf00d30c808b6c4fa6efe28d): fix(metadata): harden the MangaBaka API fallback, dump indexes and artifact jobs
- **Upstream** [f06ace82](https://github.com/fokuroru/Fokuroru/commit/f06ace82b62bb3631846d22eec9578e9ae60994f): fix(progress): count genuine reads, serialise MAL refresh, batch bulk read state
- **Upstream** [0ed3b053](https://github.com/fokuroru/Fokuroru/commit/0ed3b053b30a8a9d8c3e153ac96296511d18c66d): fix(downloads): harden the download pipeline against wrong scans, retry loops and races
- **Upstream** [de681012](https://github.com/fokuroru/Fokuroru/commit/de681012544791c06de93b779f23583a5cc751a3): fix(library): stop import, rescan and delete from losing library files
- **Upstream** [50f9f18a](https://github.com/fokuroru/Fokuroru/commit/50f9f18abe26ed1f8b7fee1ba85abee555f843f9): fix(auth): close account, 2FA, SSO, CSRF and content-rating gaps
- **Upstream** [4ced7da0](https://github.com/fokuroru/Fokuroru/commit/4ced7da04258923575af4933908707c8febae47e): perf(auth): cache the per-request user snapshot
- **Upstream** [3bfe7ab9](https://github.com/fokuroru/Fokuroru/commit/3bfe7ab92b0ab5be1f0eefd2f79b49c9a301bf0a): perf(api): slimmer query shapes on hot request paths
- **Upstream** [ea1eeadf](https://github.com/fokuroru/Fokuroru/commit/ea1eeadf9ff71679be4eaee8c9a03dfb5bb72c31): fix(review): scrobble completion, Kavita bulk push, cold search filters, embedder cleanup, recovery lockout
- **Upstream** [839d381c](https://github.com/fokuroru/Fokuroru/commit/839d381c56f07793fc1c07a781ccfae2411fc463): fix(review): series lock coverage, delete guard, enqueue keys, collision checks
- **Upstream** [96e66016](https://github.com/fokuroru/Fokuroru/commit/96e660167807e2f1047308420188029499a6491c): chore(review): refresh the queue badge on hub events, note the snapshot cache rule
- **Upstream** [37e55611](https://github.com/fokuroru/Fokuroru/commit/37e55611a28fac0e662a8c10a06730582e56c63d): fix(review): guard torrent imports from delete, title fallback, one-shot completion, delete locks
- **Upstream** [780d1f52](https://github.com/fokuroru/Fokuroru/commit/780d1f52c80ebe8f013dac352ccf66d3394ddab2): chore(review): document series locks, OPDS cache eviction and parked rows in the rule files
- **Upstream** [b5eb3654](https://github.com/fokuroru/Fokuroru/commit/b5eb365402918de50721b6f95556270c702ea629): fix(sources): keep links on empty listings, key unnumbered chapters by label, gate image work
- **Upstream** [1db451de](https://github.com/fokuroru/Fokuroru/commit/1db451de37c5ebbdc0f6e1e0311733dab85e3251): fix(http): check FlareSolverr status, escalate only on real challenges, time out stalled image bodies
- **Upstream** [48f2f411](https://github.com/fokuroru/Fokuroru/commit/48f2f411f3703726f676fd26a12df29542b49f01): chore(ui): structure-only split of the refresh, palette back to dev defaults
- **Upstream** [0749cb32](https://github.com/fokuroru/Fokuroru/commit/0749cb32324893352818fd1893b324668240ac78): feat(discover): fetch the preview chapter in the background while the card stays open
- **Upstream** [d8be8205](https://github.com/fokuroru/Fokuroru/commit/d8be8205ff624082cecf1f67de34962224f28393): feat(sources): reuse a preview's source search when the series is added
- **Upstream** [0a71b648](https://github.com/fokuroru/Fokuroru/commit/0a71b64835ebfe437fa28a0aa79eedc6b6632239): feat(theme): presets can carry a ground; nori, nori and salmon, charcoal candidates
- **Upstream** [527815e6](https://github.com/fokuroru/Fokuroru/commit/527815e6a058741a637aebe7ef81e64ddb84b67e): chore(i18n): extract the ground preset labels
- **Upstream** [555aa0fd](https://github.com/fokuroru/Fokuroru/commit/555aa0fdfdb19073ae550ba92feca9c2d8b97383): feat(theme): moss, lit charcoal and accent-tinted black grounds
- **Upstream** [9cd03a66](https://github.com/fokuroru/Fokuroru/commit/9cd03a6693c6ec94a184bec801a7823ddb9a0143): fix(theme): widen the tinted ground ramp so cards separate from the body
- **Upstream** [03c1fe7e](https://github.com/fokuroru/Fokuroru/commit/03c1fe7e86d3a168229ac8f3b5e14a097ffc87fb): feat(theme): appearance is a background and an accent, chosen separately
- **Upstream** [c1b77e07](https://github.com/fokuroru/Fokuroru/commit/c1b77e07944b8605e5a0f9d3f828d27d5693f053): fix(ui): dev's Home glance row, Library index and Stats figure row back
- **Upstream** [1e660f60](https://github.com/fokuroru/Fokuroru/commit/1e660f609e53c28348ac23634c040f78ac0b33dd): feat(theme): one-time pop-up for the new appearance options
- **Upstream** [e5f2ebb0](https://github.com/fokuroru/Fokuroru/commit/e5f2ebb057598f9e75c807cb1480fd8702c00272): feat(ui): refine shell, cards, section headers and rails after the palette merge
- **Upstream** [6c1fc685](https://github.com/fokuroru/Fokuroru/commit/6c1fc68569d106ebc3ba9120cb800d21fd5c9ad5): fix(ui): rail measurement, Library toolbar gear, Read chip and light accents
- **Upstream** [a6988487](https://github.com/fokuroru/Fokuroru/commit/a69884877f63a1cb7493b422b43a3c81d7ca6051): feat(series): pin chapter toolbar and selection bar while scrolling
- **Upstream** [74ce54dc](https://github.com/fokuroru/Fokuroru/commit/74ce54dc311fe831f157a86c145c885448bf78c8): fix(sources): read the chapter number from the URL when the label is only a title
- **Upstream** [2bb267b6](https://github.com/fokuroru/Fokuroru/commit/2bb267b64d4f3eb9eabd7828748d01f9cf374bee): feat(ui): icon-only status chip on cover cards, drop the missing-chapters chip
- **Upstream** [1f8c85f3](https://github.com/fokuroru/Fokuroru/commit/1f8c85f3a51b5caf473fb3b435923498ba9fb4d7): fix(ui): status chip takes the cover card's corner, monitor eye moves inward
- **Upstream** [81ea14e5](https://github.com/fokuroru/Fokuroru/commit/81ea14e532f8f1476eb31741709a9f4e0a7ac309): fix(i18n): carry translations over to the capitalised figure labels
- **Upstream** [96731d97](https://github.com/fokuroru/Fokuroru/commit/96731d97b44693a11183d3c83907272370696de3): fix(tests): drive the page stall timeout through TimeProvider
- **Upstream** [56e98365](https://github.com/fokuroru/Fokuroru/commit/56e98365903cfa6592d76f7cd39f4ba8dd1e161f): fix(ui): restore uppercase labels, colour the status chip, chapter pill top-left
- **Fork** [5432f33f](https://github.com/fokuroru/Fokuroru/commit/5432f33f02f3e73254ecf13ffb4a1519c391b975): chore: point repo links, update check and image at fokuroru/Fokuroru
- **Fork** [d4487f55](https://github.com/fokuroru/Fokuroru/commit/d4487f55d63e963abbc09ac0adcbe97d73007de6): Revise README for clarity on AI changes
- **Fork** [888683bc](https://github.com/fokuroru/Fokuroru/commit/888683bc62f96935cee6261e606a78df99b74993): fix(data): re-add Series.SpineColor when an older upstream migration drops it
- **Fork** [364ac3f4](https://github.com/fokuroru/Fokuroru/commit/364ac3f4f1970e03cb8a739f0b132d07fdd50051): feat(layout): Hide and Delete buttons on every card in the layout editor
- **Fork** [9d1f0a21](https://github.com/fokuroru/Fokuroru/commit/9d1f0a2158ea05e1890bd2f837f02d6c027c0720): feat(home): Reading now shelf at the top of Home, with a chalkboard behind the books
- **Fork** [3354dbdf](https://github.com/fokuroru/Fokuroru/commit/3354dbdff664acc1f2ee512acaf6ef7f3ee8e3c3): feat(home): the whole wall behind the shelf is a hand-drawn chalkboard
- **Fork** [00fafa67](https://github.com/fokuroru/Fokuroru/commit/00fafa677ced7fec1575d11a79c547027c78a5b7): feat(home): occasional sticks of chalk on the shelf that move like objects
- **Fork** [b2cf9e6d](https://github.com/fokuroru/Fokuroru/commit/b2cf9e6df073b1ea9812c646efc4ab90e2a473b7): feat(home): everything on the shelf has depth
- **Fork** [a5e972e0](https://github.com/fokuroru/Fokuroru/commit/a5e972e064a1fd18962138f6fa0fce374b7692c9): fix(home): books keep clear of the wall, fall off the front, chalk stops shaking
- **Fork** [b0ecd1a3](https://github.com/fokuroru/Fokuroru/commit/b0ecd1a3fa69271ba3aaaf00b0a88ad8e1f6c762): feat(home): books tip over, Cool S doodles, drawing on the chalkboard
- **Fork** [a350eda5](https://github.com/fokuroru/Fokuroru/commit/a350eda5095d4bf6217d27fa932c18b79b288ded): feat(home): chalkboard doodle lines wobble like a hand drew them
- **Fork** [6ef7302a](https://github.com/fokuroru/Fokuroru/commit/6ef7302a08e343fe0c0d52dd58827a4d309a36e4): feat(home): drop the page header and the chalkboard Reading heading
- **Fork** [ad917bbe](https://github.com/fokuroru/Fokuroru/commit/ad917bbe12a8f5adb2852fd0cfe2a773099ea4a6): fix(home): the books appear first, then the plant and chalk
- **Fork** [620bc130](https://github.com/fokuroru/Fokuroru/commit/620bc130837da1466363c4b978bd91b32b156074): fix(home): chalkboard figures no longer overlap each other or doodles
- **Fork** [92a44aa9](https://github.com/fokuroru/Fokuroru/commit/92a44aa9240a1790419572711a660761cedb09d9): fix(home): the speech bubble doodle's circle stops at its tail
- **Fork** [533696c1](https://github.com/fokuroru/Fokuroru/commit/533696c170653bca7a1da47c65dd975523efcae8): feat(home): books on the shelf take their cover's proportions
- **Fork** [0ec8e4d0](https://github.com/fokuroru/Fokuroru/commit/0ec8e4d0d82add715009a34384675fb23206025b): refactor(nav): merge Automation into System and move Import there
- **Fork** [5b77d4df](https://github.com/fokuroru/Fokuroru/commit/5b77d4dff6fc8609c0650b33f8af9628fd1497ad): feat(downloads): option to keep the last read chapter out of auto-delete
- **Fork** [e72be31a](https://github.com/fokuroru/Fokuroru/commit/e72be31a7ac7e16f0820b45f7641da5126bd23a7): feat(series): show when a read chapter's file will be auto-deleted
- **Fork** [845f9e79](https://github.com/fokuroru/Fokuroru/commit/845f9e79706615803a7f3129ec59ab29a7c58fa9): feat(series): mark previous chapters as read from the chapter list
- **Fork** [1403e06d](https://github.com/fokuroru/Fokuroru/commit/1403e06dea60625347d078c80f868f50220491ab): feat(series): Search on section for Comix and MangaDot
- **Fork** [26b2c4c2](https://github.com/fokuroru/Fokuroru/commit/26b2c4c28550020d174db76b6759ed0347f483cd): chore(i18n): extract the new client strings
- **Fork** [498721e6](https://github.com/fokuroru/Fokuroru/commit/498721e6cf80262a08e020adcbc9ef8abfa107f5): feat(home): book heights vary per load, and a few wide-cover books overhang
- **Fork** [292f59a0](https://github.com/fokuroru/Fokuroru/commit/292f59a02b14116b5b633449f4b8a07a03f66a0e): feat(home): chalk is thrown in from above the view
- **Fork** [6b78dcbc](https://github.com/fokuroru/Fokuroru/commit/6b78dcbc9c7f0baf9ad54cc4d3ed9670702faf6a): fix(home): the plant stands before the books arrive
- **Fork** [6daf3659](https://github.com/fokuroru/Fokuroru/commit/6daf36598b44639b0bdd0e6c388ae7fc9efc7312): feat(home): a collectable figure can stand on the shelf
- **Fork** [e5615a16](https://github.com/fokuroru/Fokuroru/commit/e5615a1612cc9562fae606c7ee6b24aeb13c41b8): feat(home): API for the user's own shelf figures
- **Fork** [8bdce800](https://github.com/fokuroru/Fokuroru/commit/8bdce8003e62434830e2309eb5a2797d3a8d1b9b): feat(home): add your own GLB figures in Settings, and the shelf stands one
- **Fork** [3689dd9b](https://github.com/fokuroru/Fokuroru/commit/3689dd9b3c06f64354f75df393b67b0f0c9f1bc3): feat(home): choose how big the shelf figure is and how often it appears
- **Fork** [60a0ea09](https://github.com/fokuroru/Fokuroru/commit/60a0ea093095df6cecd5d545ac50671450ce137f): chore: ignore .DS_Store
- **Fork** [0f8e861f](https://github.com/fokuroru/Fokuroru/commit/0f8e861f35162130a6d248139c648d8e799223e8): fix(home): shelf figures render with their textures in the built app
- **Fork** [2d4b0f92](https://github.com/fokuroru/Fokuroru/commit/2d4b0f9260c0b9809c5cb7d97591a2fe7bc08404): feat(home): refuse KTX2 textures and warn about models with no textures
- **Fork** [d5a24fa3](https://github.com/fokuroru/Fokuroru/commit/d5a24fa39e501f8afb74670edd7ca7f1b28ee943): fix(home): a clicked book comes straight towards the camera
- **Fork** [a80cc1cf](https://github.com/fokuroru/Fokuroru/commit/a80cc1cf525ce0f4d375bf7f0cf236ddfbae6d42): feat(home): chalk snaps in half after a minute of drawing
- **Fork** [e4718b08](https://github.com/fokuroru/Fokuroru/commit/e4718b085d87751850c84921e6707ec69f10adf5): feat(home): chalk is squashed to dust by something heavy
- **Fork** [d8c398da](https://github.com/fokuroru/Fokuroru/commit/d8c398dae665298371b79d016a462d57a8ed9906): fix(home): no gap left under the shelf
- **Fork** [4f9db65d](https://github.com/fokuroru/Fokuroru/commit/4f9db65d158204f37a922a30915034494c5233ed): feat(home): a chalk duster, finer dust that lands on things, and chalk that bumps into things
- **Fork** [604dc876](https://github.com/fokuroru/Fokuroru/commit/604dc87616f9c5fb85df11c36304d451df3e7583): fix(home): a book placed on top of other items keeps its hold
- **Fork** [458bc675](https://github.com/fokuroru/Fokuroru/commit/458bc6754a9c4a0f0b0e6d3884c452b6e2722efd): fix(home): a book in mid-air is no longer held up by the hover lift
- **Fork** [44ca77eb](https://github.com/fokuroru/Fokuroru/commit/44ca77eb0d5e58b779d6c41297a5115144306f89): feat(home): spines and back covers take colours that go with the cover art
- **Fork** [260ae76c](https://github.com/fokuroru/Fokuroru/commit/260ae76c1081419615ef8c337469ab4f6d36b5b8): fix(figures): reject malformed upload metadata

</details>
