# <img src="frontend/public/brand/fokuroru-icon-colour-light.svg" width="50" alt=""> Fōkurōru

Fōkurōru is a personal fork of [Maki](https://github.com/OrbitMPGH/Maki) by OrbitMPGH. **All of
the changes in this fork were written by AI. It is maintained for my
own use (so it'll probs break for you - no support and no promises).

For what the application is, how to install it, configuration, features and documentation, see the
[original project](https://github.com/OrbitMPGH/Maki). Problems with Maki itself belong upstream,
not here. The code, folders and container names still say Maki, and the
[GPLv3 licence](LICENSE) carries over unchanged.

Based on Maki v0.31.1, with upstream's `dev` branch merged in on top.

## Differences from Maki

### Look and name

- Renamed Fōkurōru, with its own logo, wordmark and PWA icons.
- The "Spine" design replaces Maki's look: warm charcoal and bone, square corners, no gradients,
  Zen Kaku Gothic New for text and Martian Mono for figures.
- Every series gets a spine colour sampled from its cover, and its pages and tiles are tinted with
  it. There is no accent picker; the accent comes from the series.
- Stats and Rewind are restyled to match.
- Maki's newer appearance options (separate background and accent pickers, the mascot) are not
  used.

### Library

- **3D "Reading now" shelf.** Series in progress stand on a physics-driven bookshelf made of
  Three.js books over Matter.js bodies. Books take one of thirty spine editions at random on each
  page load, show the title, author and next chapter, and use the real cover on the front board.
  You can pick books up, drag them and knock them over. Heavy landings shake the shelf, fast-moving
  books swing their covers open, and a potted plant sometimes turns up in the free space.
  Clicking a book opens its next chapter. A flat spine row is the fallback without WebGL.
- A series counts as reading as soon as a chapter is open part-way through.
- "Last read" sort.
- Series are marked **up to date** or **completed** separately. Completed needs every main chapter
  read and the series ended or on hiatus; caught up on a running series reads as up to date, in the
  library and on trackers.
- Mobile and foldable layout fixes, including the hero panel.

### Adding series

- **Read before adding.** The add dialog can search every enabled source for a title and link to
  each match's first chapter, without saving anything.

### Downloads

- New series default to Smart Download, and Smart Download starts on its own: the first batch is
  queued without anyone reading or downloading a chapter first. Batches start after the furthest
  read chapter.
- **Auto-delete read chapters** after a number of days you set. Read history is kept and the
  chapter is marked not wanted, so it is not downloaded again. Deleting chapters by hand behaves the
  same way, and a file shared by another chapter or an overlapping root folder is never removed.

### Series page

- Page count column and per-chapter file delete.
- **Read** offers the earliest unread chapter, skipping unwanted specials and one-shots, and a
  stray chapter read out of order does not hide earlier unread ones.
- **Download & read** fetches the next chapter when it is not on disk yet, then opens it.

### Reader

- Vertical navigation and smooth scrolling for long strips.
- A zoom slider that works with every fit, so a webtoon strip can be narrowed on a wide screen.
- Spine-colour reading progress line.

### Platform

- Progressive web app with a service worker and an offline app shell.
- Docker image makes `/app` world-readable so the `PUID` user can read it.
