import { ActionIcon, Alert, Button, Group, Modal, NumberInput, SegmentedControl, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { IconArrowBarToUp, IconPlus, IconTrash } from '@tabler/icons-react'
import { useLingui } from '@lingui/react/macro'
import { Trans } from '@lingui/react/macro'
import { useEffect, useMemo, useRef, useState } from 'react'
import { tapClient, useSaveTapZones, useTapZones } from '../../api/tapZones'
import { randomUUID } from '../../lib/uuid'
import {
  ACTION_COLOURS,
  actionAt,
  builtInPresets,
  clampZone,
  defaultZones,
  EMPTY_DOCUMENT,
  MAX_PRESETS,
  MAX_ZONES,
  type BuiltInKey,
  type ReadingDirection,
  type TapAction,
  type TapOrientation,
  type TapZone,
  type TapZoneDocument,
} from '../../lib/tapZones'

type Corner = 'nw' | 'ne' | 'sw' | 'se'
type Drag = { index: number; mode: 'move' | Corner; startX: number; startY: number; zone: TapZone }

const snap = (n: number) => Math.round(n * 100) / 100

/**
 * Where the reader's tap areas are, for this app or this browser. Drag a zone on the page to move it,
 * pull a corner to resize it, pick what it does, and save the result as a preset to come back to.
 * Nothing is kept until Save.
 */
export default function TapZoneEditor({
  opened,
  onClose,
  direction,
  zIndex,
}: {
  opened: boolean
  onClose: () => void
  direction: ReadingDirection
  zIndex?: number
}) {
  const { t } = useLingui()
  const client = tapClient()
  const other = client === 'app' ? 'web' : 'app'
  const { data: saved } = useTapZones(client, opened)
  const otherDocument = useTapZones(other, false)
  const save = useSaveTapZones(client)

  const [draft, setDraft] = useState<TapZoneDocument>(EMPTY_DOCUMENT)
  const [orientation, setOrientation] = useState<TapOrientation>('horizontal')
  const [selected, setSelected] = useState<number | null>(null)
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [trying, setTrying] = useState(false)
  const [tried, setTried] = useState<TapAction | null>(null)
  const loaded = useRef(false)

  // Take the saved copy once per opening, so a refetch landing mid-edit cannot undo the edit.
  useEffect(() => {
    if (!opened) {
      loaded.current = false
      return
    }
    if (saved && !loaded.current) {
      loaded.current = true
      setDraft(saved)
      setSelected(null)
      setActivePreset(null)
      setNaming(null)
      setTrying(false)
      setTried(null)
    }
  }, [opened, saved])

  const zones = useMemo(() => draft[orientation] ?? defaultZones(orientation, direction), [draft, orientation, direction])
  const builtIns = useMemo(() => builtInPresets(orientation, direction), [orientation, direction])
  const mine = draft.presets.filter((preset) => preset.orientation === orientation)

  const builtInLabels: Record<BuiltInKey, string> = {
    edges: t`Edges`,
    narrow: t`Narrow edges`,
    wide: t`Half and half`,
    kindle: t`Mostly forward`,
    menuOnly: t`Menu only`,
    halves: t`Top and bottom`,
  }
  const actionLabels: Record<TapAction, string> = {
    next: t`Next page`,
    prev: t`Previous page`,
    menu: t`Show or hide the menu`,
    nextChapter: t`Next chapter`,
    prevChapter: t`Previous chapter`,
    bookmark: t`Bookmark this page`,
    none: t`Nothing`,
  }

  const setZones = (next: TapZone[], keepPreset = false) => {
    setDraft((current) => ({ ...current, [orientation]: next }))
    if (!keepPreset) setActivePreset(null)
  }
  const edit = (index: number, change: Partial<TapZone>) =>
    setZones(zones.map((zone, i) => (i === index ? clampZone({ ...zone, ...change }) : zone)))

  const apply = (id: string | null) => {
    if (!id) return
    const builtIn = builtIns.find((preset) => preset.id === id)
    const own = draft.presets.find((preset) => preset.id === id)
    const next = builtIn?.zones ?? own?.zones
    if (!next) return
    setZones(next.map((zone) => ({ ...zone })), true)
    setActivePreset(id)
    setSelected(null)
  }

  const savePreset = () => {
    const name = (naming ?? '').trim()
    if (!name || draft.presets.length >= MAX_PRESETS) return
    const id = randomUUID().replace(/-/g, '')
    setDraft((current) => ({ ...current, presets: [...current.presets, { id, name, orientation, zones: zones.map((z) => ({ ...z })) }] }))
    setActivePreset(id)
    setNaming(null)
  }

  const deletePreset = () => {
    if (!activePreset) return
    setDraft((current) => ({ ...current, presets: current.presets.filter((preset) => preset.id !== activePreset) }))
    setActivePreset(null)
  }

  const copyFromOther = async () => {
    const result = await otherDocument.refetch()
    if (result.data) {
      setDraft((current) => ({ ...current, horizontal: result.data.horizontal, vertical: result.data.vertical }))
      setActivePreset(null)
      setSelected(null)
    }
  }

  // ---- dragging on the preview ----
  const preview = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)

  const fractionOf = (event: React.PointerEvent) => {
    const rect = preview.current!.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  const begin = (event: React.PointerEvent, index: number, mode: Drag['mode']) => {
    if (trying) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = fractionOf(event)
    drag.current = { index, mode, startX: at.x, startY: at.y, zone: zones[index] }
    setSelected(index)
  }

  const move = (event: React.PointerEvent) => {
    const current = drag.current
    if (!current) return
    const at = fractionOf(event)
    const dx = at.x - current.startX
    const dy = at.y - current.startY
    const { zone } = current
    let { x, y, w, h } = zone
    if (current.mode === 'move') {
      x = Math.min(Math.max(zone.x + dx, 0), 1 - zone.w)
      y = Math.min(Math.max(zone.y + dy, 0), 1 - zone.h)
    } else {
      const right = zone.x + zone.w
      const bottom = zone.y + zone.h
      if (current.mode.includes('w')) {
        x = Math.min(Math.max(zone.x + dx, 0), right - 0.02)
        w = right - x
      } else {
        w = Math.min(Math.max(zone.w + dx, 0.02), 1 - zone.x)
      }
      if (current.mode.includes('n')) {
        y = Math.min(Math.max(zone.y + dy, 0), bottom - 0.02)
        h = bottom - y
      } else {
        h = Math.min(Math.max(zone.h + dy, 0.02), 1 - zone.y)
      }
    }
    edit(current.index, { x: snap(x), y: snap(y), w: snap(w), h: snap(h) })
  }

  const end = () => {
    drag.current = null
  }

  const addZone = () => {
    if (zones.length >= MAX_ZONES) return
    const fresh: TapZone = { x: 0.3, y: 0.3, w: 0.4, h: 0.4, action: 'next' }
    // In front, because the first zone under a tap wins and a new one is meant to be reachable.
    setZones([fresh, ...zones])
    setSelected(0)
  }

  const bringToFront = (index: number) => {
    setZones([zones[index], ...zones.filter((_, i) => i !== index)])
    setSelected(0)
  }

  const current = selected != null ? zones[selected] : null
  const actionData = (Object.keys(actionLabels) as TapAction[]).map((value) => ({ value, label: actionLabels[value] }))
  const presetData = [
    { group: t`Built in`, items: builtIns.map((preset) => ({ value: preset.id, label: builtInLabels[preset.key] })) },
    ...(mine.length > 0 ? [{ group: t`Yours`, items: mine.map((preset) => ({ value: preset.id, label: preset.name })) }] : []),
  ]
  const ownActive = activePreset != null && draft.presets.some((preset) => preset.id === activePreset)

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={client === 'app' ? t`Tap zones for this app` : t`Tap zones for this browser`}
      size="lg"
      fullScreen={typeof window !== 'undefined' && window.innerWidth < 640}
      zIndex={zIndex}
      keepMounted={false}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          <Trans>
            Drag a zone to move it and pull a corner to resize it. A tap outside every zone shows or hides the
            menu. Where zones overlap, the one nearest the top of the list wins. These are kept for you, and
            separately for the app and for browsers.
          </Trans>
        </Text>

        <SegmentedControl
          fullWidth
          value={orientation}
          onChange={(value) => {
            setOrientation(value as TapOrientation)
            setSelected(null)
            setActivePreset(null)
          }}
          data={[
            { value: 'horizontal', label: t`Paged` },
            { value: 'vertical', label: t`Scrolling` },
          ]}
          aria-label={t`Which reading layout to edit`}
        />

        <Group align="flex-end" wrap="wrap">
          <Select
            label={t`Preset`}
            placeholder={t`Pick a layout`}
            data={presetData}
            value={activePreset}
            onChange={apply}
            allowDeselect={false}
            style={{ flex: '1 1 180px' }}
            comboboxProps={{ zIndex: (zIndex ?? 200) + 10 }}
          />
          {ownActive && (
            <Button variant="default" color="red" leftSection={<IconTrash size={15} />} onClick={deletePreset}>
              <Trans>Delete preset</Trans>
            </Button>
          )}
          <Button variant="default" onClick={() => setZones(defaultZones(orientation, direction))}>
            <Trans>Reset</Trans>
          </Button>
        </Group>

        <div className="tapzone-stage">
          <div
            ref={preview}
            className="tapzone-preview"
            data-trying={trying}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onClick={(event) => {
              if (!trying) {
                if (event.target === event.currentTarget) setSelected(null)
                return
              }
              const rect = event.currentTarget.getBoundingClientRect()
              setTried(actionAt(zones, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height))
            }}
          >
            <div className="tapzone-page" aria-hidden />
            {zones.map((zone, index) => (
              <div
                key={`${index}-${zone.action}`}
                className="tapzone-zone"
                data-selected={selected === index}
                style={{
                  left: `${zone.x * 100}%`,
                  top: `${zone.y * 100}%`,
                  width: `${zone.w * 100}%`,
                  height: `${zone.h * 100}%`,
                  background: `color-mix(in srgb, ${ACTION_COLOURS[zone.action]} 38%, transparent)`,
                  borderColor: ACTION_COLOURS[zone.action],
                  zIndex: zones.length - index,
                }}
                onPointerDown={(event) => begin(event, index, 'move')}
              >
                <span className="tapzone-label">{actionLabels[zone.action]}</span>
                {selected === index &&
                  !trying &&
                  (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                    <span
                      key={corner}
                      className="tapzone-handle"
                      data-corner={corner}
                      onPointerDown={(event) => begin(event, index, corner)}
                    />
                  ))}
              </div>
            ))}
          </div>
          <Text size="xs" c="dimmed" ta="center" mt={6}>
            {trying ? (
              tried ? actionLabels[tried] : <Trans>Tap the page to see what a tap does.</Trans>
            ) : (
              <Trans>The page is shown as it would be held.</Trans>
            )}
          </Text>
        </div>

        <Switch
          label={t`Try it: tapping the page shows what it would do`}
          checked={trying}
          onChange={(event) => {
            setTrying(event.currentTarget.checked)
            setTried(null)
          }}
        />

        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={600} size="sm">
              <Trans>Zones</Trans>
            </Text>
            <Button size="compact-sm" variant="default" leftSection={<IconPlus size={14} />} onClick={addZone} disabled={zones.length >= MAX_ZONES}>
              <Trans>Add a zone</Trans>
            </Button>
          </Group>
          {zones.length === 0 && (
            <Text size="sm" c="dimmed">
              <Trans>No zones, so a tap anywhere shows or hides the menu.</Trans>
            </Text>
          )}
          {zones.map((zone, index) => (
            <Group
              key={`${index}-${zone.action}-row`}
              gap="xs"
              wrap="nowrap"
              className="tapzone-row"
              data-selected={selected === index}
              onClick={() => setSelected(index)}
            >
              <span className="tapzone-swatch" style={{ background: ACTION_COLOURS[zone.action] }} aria-hidden />
              <Select
                size="xs"
                data={actionData}
                value={zone.action}
                allowDeselect={false}
                onChange={(value) => value && edit(index, { action: value as TapAction })}
                aria-label={t`What zone ${index + 1} does`}
                style={{ flex: 1 }}
                comboboxProps={{ zIndex: (zIndex ?? 200) + 10 }}
              />
              <ActionIcon variant="subtle" color="gray" onClick={() => bringToFront(index)} disabled={index === 0} aria-label={t`Bring zone ${index + 1} to the top of the list`}>
                <IconArrowBarToUp size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="red"
                onClick={() => {
                  setZones(zones.filter((_, i) => i !== index))
                  setSelected(null)
                }}
                aria-label={t`Delete zone ${index + 1}`}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          ))}
          {current && selected != null && (
            <Group gap="xs" grow>
              {(['x', 'y', 'w', 'h'] as const).map((field) => (
                <NumberInput
                  key={field}
                  size="xs"
                  label={{ x: t`Left`, y: t`Top`, w: t`Width`, h: t`Height` }[field]}
                  suffix="%"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(current[field] * 100)}
                  onChange={(value) => typeof value === 'number' && edit(selected, { [field]: value / 100 })}
                />
              ))}
            </Group>
          )}
        </Stack>

        {naming == null ? (
          <Group gap="xs">
            <Button variant="default" onClick={() => setNaming('')} disabled={draft.presets.length >= MAX_PRESETS}>
              <Trans>Save as a preset</Trans>
            </Button>
            <Button
              variant="subtle"
              loading={otherDocument.isFetching}
              onClick={copyFromOther}
            >
              {client === 'app' ? <Trans>Copy layouts from my browser</Trans> : <Trans>Copy layouts from my app</Trans>}
            </Button>
          </Group>
        ) : (
          <Group gap="xs" align="flex-end">
            <TextInput
              label={t`Preset name`}
              value={naming}
              onChange={(event) => setNaming(event.currentTarget.value)}
              maxLength={40}
              data-autofocus
              style={{ flex: 1 }}
              onKeyDown={(event) => event.key === 'Enter' && savePreset()}
            />
            <Button onClick={savePreset} disabled={!naming.trim()}>
              <Trans>Add preset</Trans>
            </Button>
            <Button variant="subtle" color="gray" onClick={() => setNaming(null)}>
              <Trans>Cancel</Trans>
            </Button>
          </Group>
        )}

        {save.isError && (
          <Alert color="red" variant="light">
            <Trans>Couldn't save the tap zones. Try again.</Trans>
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => save.mutate(draft, { onSuccess: onClose })}
          >
            <Trans>Save</Trans>
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
