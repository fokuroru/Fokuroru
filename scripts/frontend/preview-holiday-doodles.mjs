import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const ts = require('typescript')
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const base = new URL('../../frontend/src/components/library/shelf3d/', import.meta.url)
const calendar = compile(await readFile(new URL('holidayCalendar.ts', base), 'utf8'))
const calendarUrl = `data:text/javascript;base64,${Buffer.from(calendar).toString('base64')}`
const alternativesCode = compile(await readFile(new URL('holidayDoodleAlternatives.ts', base), 'utf8'))
const alternativesUrl = `data:text/javascript;base64,${Buffer.from(alternativesCode).toString('base64')}`
const compiled = compile(await readFile(new URL('holidayDoodles.ts', base), 'utf8')).replace('./holidayCalendar', calendarUrl).replace('./holidayDoodleAlternatives', alternativesUrl)
const { HOLIDAY_DOODLES, HOLIDAY_COLORS } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const labels = {
  halloween: ['Halloween', '10–31 October'], christmas: ['Christmas', '1–26 December'],
  newYear: ['New Year', '27 December–1 January'], easter: ['Easter', '3 weeks before Easter Sunday, through Easter Monday'],
  valentine: ["Valentine’s Day", '7–14 February'], lunarNewYear: ['Lunar New Year', '2 weeks before, through the Lantern Festival'],
  stPatrick: ["St Patrick’s Day", '10–17 March'], diwali: ['Diwali', '1 week before, through 2 days after'],
  hanukkah: ['Hanukkah', '1 week before the first evening, through the final day'],
}
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const width = 1400, rowHeight = 185, height = 130 + 9 * rowHeight + 60
const elements = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  '<rect width="100%" height="100%" fill="#252c28"/>',
  '<rect x="12" y="12" width="1376" height="1831" rx="8" fill="none" stroke="#68543c" stroke-width="12"/>',
  '<text x="45" y="66" fill="#ece4d2" font-family="sans-serif" font-size="32">Holiday chalk doodles</text>',
  `<text x="46" y="101" fill="#b8beb4" font-family="sans-serif" font-size="17">${Object.values(HOLIDAY_DOODLES).reduce((n, icons) => n + Object.keys(icons).length, 0)} drawings · exact board paths and colours · one random doodle per visit</text>`]
let row = 0
for (const [theme, icons] of Object.entries(HOLIDAY_DOODLES)) {
  const y = 135 + row++ * rowHeight
  const [title, schedule] = labels[theme]
  elements.push(`<path d="M 44 ${y - 5} H 1354" stroke="#526056" stroke-width="0.7"/>`)
  elements.push(`<text x="45" y="${y + 35}" fill="${HOLIDAY_COLORS[theme]}" font-family="sans-serif" font-size="24">${escape(title)}</text>`)
  // Wrap schedule at word boundaries to leave a generous margin before the icons.
  const words = schedule.split(' '), lines = []
  let line = ''
  for (const word of words) {
    if ((line + ' ' + word).length > 31) { lines.push(line); line = word }
    else line += (line ? ' ' : '') + word
  }
  if (line) lines.push(line)
  lines.forEach((line, i) => elements.push(`<text x="46" y="${y + 67 + i * 23}" fill="#bec5bc" font-family="sans-serif" font-size="16">${escape(line)}</text>`))
  Object.entries(icons).forEach(([name, icon], i) => {
    const x = 390 + i * 190
    const color = theme === 'halloween' && name !== 'pumpkin' ? '#e9e2ce' : HOLIDAY_COLORS[theme]
    elements.push(`<g transform="translate(${x},${y + 9}) scale(1.22)" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">`)
    for (const [index, path] of icon.paths.entries()) {
      elements.push(`<path d="${path}" stroke="${icon.colors?.[index] ?? color}" opacity=".3" transform="translate(.65,.45)"/><path d="${path}" stroke="${icon.colors?.[index] ?? color}" opacity=".85"/>`)
    }
    elements.push('</g>')
    elements.push(`<text x="${x + 61}" y="${y + 153}" text-anchor="middle" fill="#bfc7bc" font-family="sans-serif" font-size="15">${escape(icon.label)}</text>`)
  })
}
elements.push(`<text x="45" y="${height - 33}" fill="#a6b2a4" font-family="sans-serif" font-size="15">Overlapping holidays share the random selection. Placement stays clear of the board’s figures.</text></svg>`)
const output = process.argv[2] ?? '/tmp/maki-holiday-doodles'
await mkdir(output, { recursive: true })
await writeFile(join(output, 'holiday-doodles.svg'), elements.join('\n'))
console.log(join(output, 'holiday-doodles.svg'))

const { DOODLE_ALTERNATIVES } = await import(`data:text/javascript;base64,${Buffer.from(alternativesCode).toString('base64')}`)
const alternateElements = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="1150" height="1540" viewBox="0 0 1150 1540">',
  '<rect width="100%" height="100%" fill="#252c28"/>',
  '<rect x="10" y="10" width="1130" height="1520" rx="8" fill="none" stroke="#68543c" stroke-width="10"/>',
  '<text x="40" y="65" fill="#ece4d2" font-family="sans-serif" font-size="32">Choose your chalk doodles</text>',
  '<text x="40" y="103" fill="#b8beb4" font-family="sans-serif" font-size="18">Three alternatives each. Reply with codes, for example P1, S2, L3, D1.</text>',
]
const names = { pumpkin: 'Pumpkin', stocking: 'Stocking', letter: 'Love letter', dreidel: 'Dreidel' }
const render = (icon, x, y, scale) => {
  alternateElements.push(`<g transform="translate(${x},${y}) scale(${scale})" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">`)
  for (const [i, path] of icon.paths.entries()) {
    const color = icon.colors?.[i] ?? '#e9e2ce'
    alternateElements.push(`<path d="${path}" stroke="${color}" opacity=".3" transform="translate(.65,.45)"/><path d="${path}" stroke="${color}" opacity=".85"/>`)
  }
  alternateElements.push('</g>')
}
let alternativeRow = 0
for (const [kind, icons] of Object.entries(DOODLE_ALTERNATIVES)) {
  const y = 145 + alternativeRow++ * 280
  alternateElements.push(`<path d="M 40 ${y - 8} H 1110" stroke="#526056" stroke-width=".7"/>`)
  alternateElements.push(`<text x="40" y="${y + 32}" fill="#ece4d2" font-family="sans-serif" font-size="24">${names[kind]}</text>`)
  icons.forEach((icon, i) => {
    const x = 235 + i * 295
    render(icon, x, y + 32, 1.8)
    alternateElements.push(`<text x="${x + 90}" y="${y + 249}" text-anchor="middle" fill="#c8cfc1" font-family="sans-serif" font-size="17">${escape(icon.label)}</text>`)
  })
}
const y = 1275
alternateElements.push(`<path d="M 40 ${y - 8} H 1110" stroke="#526056" stroke-width=".7"/><text x="40" y="${y + 32}" fill="#ece4d2" font-family="sans-serif" font-size="24">Applied updates</text>`)
render(HOLIDAY_DOODLES.stPatrick.rainbow, 315, y + 32, 1.6)
render(HOLIDAY_DOODLES.newYear.fireworksPair, 740, y + 32, 1.6)
alternateElements.push(`<text x="395" y="${y + 227}" text-anchor="middle" fill="#c8cfc1" font-family="sans-serif" font-size="17">Multicolour rainbow</text><text x="820" y="${y + 227}" text-anchor="middle" fill="#c8cfc1" font-family="sans-serif" font-size="17">Second firework doodle</text></svg>`)
await writeFile(join(output, 'holiday-alternatives.svg'), alternateElements.join('\n'))
console.log(join(output, 'holiday-alternatives.svg'))

alternateElements.length = 0
alternateElements.push('<svg xmlns="http://www.w3.org/2000/svg" width="1150" height="960" viewBox="0 0 1150 960">',
  '<rect width="100%" height="100%" fill="#252c28"/>',
  '<rect x="10" y="10" width="1130" height="940" rx="8" fill="none" stroke="#68543c" stroke-width="10"/>',
  '<text x="40" y="63" fill="#ece4d2" font-family="sans-serif" font-size="31">Updated chalk doodles</text>',
  '<text x="40" y="101" fill="#b8beb4" font-family="sans-serif" font-size="18">Pumpkin fixed · S3 selected · all love letters added · choose a new dreidel below</text>')
const revisionRows = [
  ['Applied', [HOLIDAY_DOODLES.halloween.pumpkin, HOLIDAY_DOODLES.christmas.stocking]],
  ['Love letters', DOODLE_ALTERNATIVES.letter],
  ['New dreidels', DOODLE_ALTERNATIVES.dreidel],
]
revisionRows.forEach(([heading, icons], row) => {
  const y = 140 + row * 260
  alternateElements.push(`<path d="M 40 ${y - 8} H 1110" stroke="#526056" stroke-width=".7"/><text x="40" y="${y + 32}" fill="#ece4d2" font-family="sans-serif" font-size="23">${heading}</text>`)
  icons.forEach((icon, i) => {
    const x = icons.length === 2 ? 310 + i * 400 : 245 + i * 290
    render(icon, x, y + 28, 1.6)
    alternateElements.push(`<text x="${x + 80}" y="${y + 223}" text-anchor="middle" fill="#c8cfc1" font-family="sans-serif" font-size="16">${escape(icon.label)}</text>`)
  })
})
alternateElements.push('<text x="40" y="931" fill="#b8beb4" font-family="sans-serif" font-size="17">Reply D1, D2 or D3. These use the exact chalk paths and colours drawn on the board.</text></svg>')
await writeFile(join(output, 'holiday-revisions.svg'), alternateElements.join('\n'))
console.log(join(output, 'holiday-revisions.svg'))
