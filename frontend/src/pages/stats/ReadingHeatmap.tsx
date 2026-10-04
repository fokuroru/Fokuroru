import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Group, Text, Title, Tooltip } from '@mantine/core'
import { Trans, Plural, useLingui } from '@lingui/react/macro'
import type { HeatmapDay } from '../../api/hooks'
import { Panel } from '../../components/ui/Panel'
import { formatDate, monthName } from '../../format'

const MAX_WEEKS = 53
const DAYS_IN_WEEK = 7
const CELL = 11
const GAP = 3

/**
 * Five buckets scaled to this reader's own active days. Fixed cut points saturate for anyone who
 * reads in bulk (every day lands in the top bucket and the grid goes solid), so the cuts are the
 * quartiles of the days that had any reading. Too few days to take quartiles of fall back to fixed
 * cuts. Days with no reading are always level 0 and never enter the calculation.
 */
function levelCuts(days: { chapters: number; seconds: number }[]): [number, number, number] {
  const active = days.filter((d) => d.chapters > 0).map((d) => d.chapters).sort((a, b) => a - b)
  if (active.length < 8) return [2, 7, 19]
  const at = (q: number) => active[Math.min(active.length - 1, Math.floor(q * active.length))]
  return [at(0.25), at(0.5), at(0.75)]
}

/** `cuts` are the largest chapter counts of buckets 1 to 3; anything above the last is bucket 4. */
function level(chapters: number, seconds: number, cuts: [number, number, number]): number {
  if (chapters === 0 && seconds === 0) return 0
  if (chapters <= cuts[0]) return 1
  if (chapters <= cuts[1]) return 2
  if (chapters <= cuts[2]) return 3
  return 4
}

const SHADES = [
  'var(--surface-2, rgba(128,128,128,0.14))',
  'color-mix(in srgb, var(--brand) 25%, transparent)',
  'color-mix(in srgb, var(--brand) 45%, transparent)',
  'color-mix(in srgb, var(--brand) 70%, transparent)',
  'var(--brand)',
]

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Cell = { date: string; chapters: number; seconds: number; hidden: boolean }

function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}

/**
 * A GitHub-style grid of reading days. Columns are weeks, rows are weekdays starting Monday, ending
 * on the current week so today sits in the last column. It starts at the week of the first day
 * anything was read, never earlier, and shows as many of the most recent weeks as fit the width, so
 * it never needs a horizontal scroll to reach recent days.
 */
export function ReadingHeatmap({ days }: { days: HeatmapDay[] }) {
  const { i18n } = useLingui()
  const holder = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(MAX_WEEKS)

  useLayoutEffect(() => {
    const node = holder.current
    if (!node) return
    const measure = () => setFit(Math.max(4, Math.floor((node.clientWidth + GAP) / (CELL + GAP))))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const { columns, monthLabels, cuts } = useMemo(() => {
    const active = days.filter((d) => d.chapters > 0 || d.seconds > 0)
    const byDate = new Map(active.map((d) => [d.date.slice(0, 10), d]))
    const firstKey = active.map((d) => d.date.slice(0, 10)).sort()[0] ?? null

    const today = new Date()
    const todayKey = isoDate(today)
    const end = mondayOf(today)
    const firstMonday = firstKey ? mondayOf(new Date(`${firstKey}T00:00:00`)) : end
    const sinceFirst =
      Math.round((end.getTime() - firstMonday.getTime()) / (DAYS_IN_WEEK * 86_400_000)) + 1
    const weeks = Math.max(1, Math.min(MAX_WEEKS, fit, sinceFirst))
    const start = new Date(end)
    start.setDate(start.getDate() - (weeks - 1) * DAYS_IN_WEEK)

    const cols: Cell[][] = []
    const labels: { index: number; label: string }[] = []
    let lastMonth = -1

    for (let w = 0; w < weeks; w++) {
      const column: Cell[] = []
      for (let d = 0; d < DAYS_IN_WEEK; d++) {
        const cell = new Date(start)
        cell.setDate(start.getDate() + w * DAYS_IN_WEEK + d)
        const key = isoDate(cell)
        const found = byDate.get(key)
        // Days before the first reading day and days still to come are not part of the record.
        const hidden = (firstKey !== null && key < firstKey) || key > todayKey
        column.push({ date: key, chapters: found?.chapters ?? 0, seconds: found?.seconds ?? 0, hidden })

        if (d === 0 && cell.getMonth() !== lastMonth) {
          lastMonth = cell.getMonth()
          labels.push({ index: w, label: monthName(cell.getMonth() + 1, 'short') })
        }
      }

      cols.push(column)
    }

    const shown = cols.flat().filter((c) => !c.hidden)
    return { columns: cols, monthLabels: labels, cuts: levelCuts(shown) }
    // monthName is locale-bound: without i18n.locale here, a language switch would leave the
    // previous language's month names cached until days changed too.
  }, [days, fit, i18n.locale])

  return (
    <Panel p="md">
      <Title order={4} mb="xs">
        <Trans>Reading days</Trans>
      </Title>
      <Box ref={holder}>
        <Box style={{ display: 'flex', gap: GAP, marginBottom: 4 }}>
          {columns.map((_, i) => {
            const label = monthLabels.find((m) => m.index === i)
            return (
              <Box key={i} style={{ width: CELL, fontSize: 9, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                {label?.label ?? ''}
              </Box>
            )
          })}
        </Box>
        <Box style={{ display: 'flex', gap: GAP }}>
          {columns.map((column, i) => (
            <Box key={i} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
              {column.map((cell) => {
                if (cell.hidden) return <Box key={cell.date} style={{ width: CELL, height: CELL }} />
                // Appending a local time-of-day avoids the bare "yyyy-MM-dd" being read as UTC
                // midnight, which would shift the printed date back a day west of UTC.
                const cellDate = formatDate(`${cell.date}T00:00:00`)
                const nothingRead = cell.chapters === 0 && cell.seconds === 0
                return (
                  <Tooltip
                    key={cell.date}
                    label={
                      nothingRead ? (
                        <Trans>{cellDate}: nothing read</Trans>
                      ) : (
                        <Trans>
                          {cellDate}: <Plural value={cell.chapters} one="# chapter" other="# chapters" />
                        </Trans>
                      )
                    }
                    withArrow
                  >
                    <Box
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 'var(--radius-2xs)',
                        background: SHADES[level(cell.chapters, cell.seconds, cuts)],
                      }}
                    />
                  </Tooltip>
                )
              })}
            </Box>
          ))}
        </Box>
      </Box>
      <Group justify="flex-end" gap={4} mt="xs">
        <Text size="xs" c="var(--ink-3)">
          <Trans>Less</Trans>
        </Text>
        {SHADES.map((shade) => (
          <Box key={shade} style={{ width: CELL, height: CELL, borderRadius: 'var(--radius-2xs)', background: shade }} />
        ))}
        <Text size="xs" c="var(--ink-3)">
          <Trans>More</Trans>
        </Text>
      </Group>
    </Panel>
  )
}
