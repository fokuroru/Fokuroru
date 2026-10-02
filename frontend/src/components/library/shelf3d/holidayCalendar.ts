export type Holiday = 'halloween' | 'christmas' | 'newYear' | 'easter' | 'valentine' | 'lunarNewYear' | 'stPatrick' | 'diwali' | 'hanukkah'
const DAY = 86_400_000
const day = (year: number, month: number, date: number) => Date.UTC(year, month - 1, date) / DAY

// Verified civil dates, not an approximation from astronomical new moons.
// https://www.timeanddate.com/holidays/china/spring-festival
// https://www.timeanddate.com/holidays/india/diwali
export const LUNAR_NEW_YEAR: Record<number, [number, number]> = {
  2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3], 2031: [1, 23],
}
export const DIWALI: Record<number, [number, number]> = {
  2026: [11, 8], 2027: [10, 29], 2028: [10, 17], 2029: [11, 5], 2030: [10, 26], 2031: [11, 14],
}

/** Gregorian Easter Sunday (Western computus). */
export function easterDay(year: number): number {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const value = h + l - 7 * m + 114
  return day(year, Math.floor(value / 31), value % 31 + 1)
}

const hanukkahDates = new Map<number, number | null>()
/** Starts the civil day before 25 Kislev, covering the first evening. */
export function hanukkahDay(year: number): number | null {
  if (hanukkahDates.has(year)) return hanukkahDates.get(year)!
  let result: number | null = null
  try {
    const formatter = new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: 'UTC', month: 'long', day: 'numeric' })
    if (formatter.resolvedOptions().calendar === 'hebrew') {
      for (let n = day(year, 11, 1); n <= day(year, 12, 31); n++) {
        const parts = formatter.formatToParts(new Date(n * DAY))
        if (parts.some(p => p.type === 'month' && p.value === 'Kislev') &&
            parts.some(p => p.type === 'day' && p.value === '25')) { result = n - 1; break }
      }
    }
  } catch { /* Unsupported calendar: omit this theme rather than guess its dates. */ }
  hanukkahDates.set(year, result)
  return result
}

/** Calendar-day windows, independent of daylight saving and the machine's UTC offset. */
export function activeHolidays(date = new Date()): Holiday[] {
  const year = date.getFullYear()
  const today = day(year, date.getMonth() + 1, date.getDate())
  const active: Holiday[] = []
  const window = (theme: Holiday, start: number, end: number) => {
    if (today >= start && today <= end && !active.includes(theme)) active.push(theme)
  }
  window('halloween', day(year, 10, 10), day(year, 10, 31))
  window('christmas', day(year, 12, 1), day(year, 12, 26))
  window('newYear', day(year, 12, 27), day(year + 1, 1, 1))
  window('newYear', day(year - 1, 12, 27), day(year, 1, 1))
  window('easter', easterDay(year) - 21, easterDay(year) + 1)
  window('valentine', day(year, 2, 7), day(year, 2, 14))
  window('stPatrick', day(year, 3, 10), day(year, 3, 17))
  if (LUNAR_NEW_YEAR[year]) {
    const [month, date] = LUNAR_NEW_YEAR[year]
    const holiday = day(year, month, date)
    window('lunarNewYear', holiday - 14, holiday + 14)
  }
  if (DIWALI[year]) {
    const [month, date] = DIWALI[year]
    const holiday = day(year, month, date)
    window('diwali', holiday - 7, holiday + 2)
  }
  for (const y of [year - 1, year]) {
    const holiday = hanukkahDay(y)
    if (holiday !== null) window('hanukkah', holiday - 7, holiday + 8)
  }
  return active
}
