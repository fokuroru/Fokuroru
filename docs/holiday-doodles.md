# Holiday chalkboard doodles

One themed drawing is selected per shelf load. Selection stays fixed through metadata refreshes and
layout changes. When windows overlap, each active holiday has an equal chance before its drawing is
chosen. The reserved upper-right area keeps drawings clear of board figures.
Each drawing can specify a different chalk colour per path. The rainbow uses seven coloured bands
and cream clouds. The second firework uses gold, purple and pink chalk; the clock and chick are removed.
The pumpkin has no ridges crossing its face. S3 is the selected stocking, and all three love letters
join the Valentine rotation. D1, with its rounded wooden handle, is the selected dreidel.

| Theme | Display window |
| --- | --- |
| Halloween | 10–31 October |
| Christmas | 1–26 December |
| New Year | 27 December–1 January |
| Easter | 21 days before Western Easter Sunday through Easter Monday |
| Valentine’s Day | 7–14 February |
| Lunar New Year | 14 days before through 14 days after, including the Lantern Festival |
| St Patrick’s Day | 10–17 March |
| Diwali | 7 days before through 2 days after the main festival date |
| Hanukkah | 7 days before the first evening through the final day |

Windows use the viewer’s local calendar date. Easter is computed with Gregorian computus. Hanukkah
uses the browser’s Hebrew calendar, with the first evening on the civil day before 25 Kislev.
The date window covers that entire civil day rather than estimating local sunset.

Lunar New Year follows the Chinese calendar’s civil date. Lunar New Year and Diwali dates are checked
tables for 2026–2031. Extend the tables before 2032; unknown years omit these themes rather than guess.
Diwali traditions can differ by region; the table uses the main Indian Diwali date.

Date references:

- [Lunar New Year dates and Lantern Festival](https://www.timeanddate.com/holidays/china/spring-festival)
- [Diwali dates](https://www.timeanddate.com/holidays/india/diwali)
- [Hanukkah dates and eight-day observance](https://www.hebcal.com/holidays/chanukah-2026)
- [Gregorian Easter dates](https://www.rmg.co.uk/stories/time/when-easter)

Run `node scripts/frontend/check-holiday-doodles.mjs` for calendar and drawing checks.
Run `node scripts/frontend/preview-holiday-doodles.mjs <output-directory>` to render a SVG preview
sheet directly from the production drawing paths and colours.
