import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const ts = require('typescript')
const source = await readFile(new URL('../../frontend/src/components/library/shelf3d/holidayDoodles.ts', import.meta.url), 'utf8')
let compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const calendarSource = await readFile(new URL('../../frontend/src/components/library/shelf3d/holidayCalendar.ts', import.meta.url), 'utf8')
const calendarCode = ts.transpileModule(calendarSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const calendarUrl = `data:text/javascript;base64,${Buffer.from(calendarCode).toString('base64')}`
const alternativesSource = await readFile(new URL('../../frontend/src/components/library/shelf3d/holidayDoodleAlternatives.ts', import.meta.url), 'utf8')
const alternativesCode = ts.transpileModule(alternativesSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const alternativesUrl = `data:text/javascript;base64,${Buffer.from(alternativesCode).toString('base64')}`
compiled = compiled.replace('./holidayCalendar', calendarUrl).replace('./holidayDoodleAlternatives', alternativesUrl)
const { activeHolidays, easterDay, hanukkahDay } = await import(calendarUrl)
const { halloweenDoodle, HALLOWEEN_DOODLES, drawHalloweenDoodle, HOLIDAY_DOODLES, drawHolidayDoodle, holidayDoodle } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
assert.equal(halloweenDoodle(new Date(2026, 9, 9)), null)
assert.equal(halloweenDoodle(new Date(2026, 9, 10), () => 0), 'pumpkin')
assert.equal(halloweenDoodle(new Date(2026, 9, 31, 23, 59), () => 0.999), 'spider')
assert.equal(halloweenDoodle(new Date(2026, 10, 1)), null)
assert.equal(halloweenDoodle(new Date(2027, 9, 10), () => 0), 'pumpkin', 'returns every year')
globalThis.Path2D = class { constructor(path) { assert.ok(path.startsWith('M ')) } }
let strokes = 0
const context = { save() {}, restore() {}, translate() {}, scale() {}, stroke() { strokes++ } }
for (let i = 0; i < HALLOWEEN_DOODLES.length; i++) {
  const doodle = halloweenDoodle(new Date(2026, 9, 20), () => i / HALLOWEEN_DOODLES.length)
  assert.equal(doodle, HALLOWEEN_DOODLES[i])
  drawHalloweenDoodle(context, doodle, 0, 0, 90)
}
assert.ok(strokes >= HALLOWEEN_DOODLES.length * 2)
console.log('Holiday doodle window, annual recurrence and drawing checks passed')

const at = (date, theme) => assert.ok(activeHolidays(new Date(`${date}T12:00:00`)).includes(theme), `${theme} active ${date}`)
const off = (date, theme) => assert.ok(!activeHolidays(new Date(`${date}T12:00:00`)).includes(theme), `${theme} inactive ${date}`)
for (const [theme, start, end, before, after] of [
  ['christmas', '2026-12-01', '2026-12-26', '2026-11-30', '2026-12-27'],
  ['newYear', '2026-12-27', '2027-01-01', '2026-12-26', '2027-01-02'],
  ['valentine', '2027-02-07', '2027-02-14', '2027-02-06', '2027-02-15'],
  ['stPatrick', '2027-03-10', '2027-03-17', '2027-03-09', '2027-03-18'],
  ['easter', '2027-03-07', '2027-03-29', '2027-03-06', '2027-03-30'],
  ['lunarNewYear', '2027-01-23', '2027-02-20', '2027-01-22', '2027-02-21'],
  ['diwali', '2026-11-01', '2026-11-10', '2026-10-31', '2026-11-11'],
  ['hanukkah', '2026-11-27', '2026-12-12', '2026-11-26', '2026-12-13'],
]) { at(start, theme); at(end, theme); off(before, theme); off(after, theme) }
assert.equal(new Date(easterDay(2026) * 86400000).toISOString().slice(0, 10), '2026-04-05')
assert.equal(new Date(hanukkahDay(2027) * 86400000).toISOString().slice(0, 10), '2027-12-24')
at('2028-01-01', 'hanukkah')
assert.equal(holidayDoodle(new Date(2026, 7, 1)), null)
assert.equal(holidayDoodle(new Date(2026, 11, 5), () => 0).theme, 'christmas')
assert.equal(holidayDoodle(new Date(2026, 11, 5), () => 0.999).theme, 'hanukkah', 'overlap retains both holidays')
for (const [theme, icons] of Object.entries(HOLIDAY_DOODLES)) for (const doodle of Object.keys(icons)) {
  drawHolidayDoodle(context, { theme, doodle }, 0, 0, 90)
}
assert.equal(Object.values(HOLIDAY_DOODLES).reduce((n, icons) => n + Object.keys(icons).length, 0), 30)
console.log('All 30 doodles and nine holiday windows passed')

assert.ok(!('midnight' in HOLIDAY_DOODLES.newYear))
assert.ok(!('chick' in HOLIDAY_DOODLES.easter))
assert.equal(HOLIDAY_DOODLES.stPatrick.rainbow.colors.length, 8)
const candidateSource = await readFile(new URL('../../frontend/src/components/library/shelf3d/holidayDoodleAlternatives.ts', import.meta.url), 'utf8')
const candidateCode = ts.transpileModule(candidateSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { DOODLE_ALTERNATIVES } = await import(`data:text/javascript;base64,${Buffer.from(candidateCode).toString('base64')}`)
const { drawChalkDoodle } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
for (const icons of Object.values(DOODLE_ALTERNATIVES)) {
  assert.equal(icons.length, 3)
  for (const icon of icons) {
    assert.equal(icon.colors.length, icon.paths.length)
    drawChalkDoodle(context, icon, '#e9e2ce', 0, 0, 90)
  }
}
console.log('All 12 alternatives and multicolour drawing checks passed')

assert.equal(HOLIDAY_DOODLES.christmas.stocking.label, 'Fluffy stocking')
assert.equal(Object.keys(HOLIDAY_DOODLES.valentine).filter(k => k.startsWith('letter')).length, 3)
assert.ok(!HOLIDAY_DOODLES.valentine.letterFloating.paths.join(' ').includes('M 19 78'))
