import { Button, Group, MultiSelect, SegmentedControl, Select, Slider, Stack, Switch, Text } from '@mantine/core'
import { Trans, useLingui } from '@lingui/react/macro'
import type { EnhanceServer } from '../../api/reader'
import type { QualityTierName } from '../../api/upgrades'
import { useLabel } from '../../i18n-context'
import { wakeLockSupported } from '../../lib/wakeLock'
import {
  BROWSER_ENHANCE_METHODS,
  ENHANCE_FALLBACKS,
  ENHANCE_LEVELS,
  ENHANCE_SKIP_TIERS,
  SERVER_ENHANCE_METHODS,
  enhanceMethodInfo,
  isServerMethod,
  serverModelId,
} from './enhanceMethods'
import { useEnhanceEngine } from './enhanceRuntime'
import { BACKGROUNDS, enhanceFor, scaleMax, type ReaderPrefs } from './prefs'

/**
 * The reader renders above Mantine's popover layer, so anything that portals to <body> has to
 * be lifted past it explicitly, otherwise it paints underneath the page and looks like the
 * control simply doesn't work.
 */
export const OVERLAY_Z = 500

// Inside the settings popover, a portalled list counts as outside it: the first touch on the list
// closed both, so it could never be scrolled. Rendered in place, fixed so the popover does not clip it.
export const NESTED_COMBOBOX = { zIndex: OVERLAY_Z + 1, withinPortal: false, floatingStrategy: 'fixed' } as const

/** Which of the reader's options a host can honour. The preview reader writes nothing and has no chapter. */
export interface ReaderSettingsFeatures {
  wideSplit: boolean
  webtoon: boolean
  /** Chapter banner and auto-advance. */
  chapter: boolean
  wakeLock: boolean
}

/**
 * The display options both readers offer in their settings popover. Hosts append their own
 * (incognito and the reading profile in the library reader) as children.
 */
export function ReaderSettingsControls({
  prefs,
  onPrefs,
  autoLayout = false,
  tier,
  enhanceModels,
  features,
  onEditTapZones,
  children,
}: {
  prefs: ReaderPrefs
  onPrefs: (patch: Partial<ReaderPrefs>) => void
  /** The layout on screen was picked by webtoon detection, not by any setting. */
  autoLayout?: boolean
  /** The quality tier of the chapter's file, for "Off for this chapter because of its quality". */
  tier?: QualityTierName
  /** The server's upscale models; absent when the host cannot use the server tier. */
  enhanceModels?: EnhanceServer['models']
  features: ReaderSettingsFeatures
  onEditTapZones: () => void
  children?: React.ReactNode
}) {
  const { t } = useLingui()
  const renderLabel = useLabel()
  const { scale } = prefs
  const browserUnsupported = useEnhanceEngine(prefs.enhance !== 'off').status === 'unsupported'
  const enhanceOptions = [
    ...BROWSER_ENHANCE_METHODS.map((m) => ({ value: m.id, label: renderLabel(m.label), disabled: browserUnsupported })),
    ...SERVER_ENHANCE_METHODS.flatMap((m) => {
      if (!enhanceModels) return []
      const model = enhanceModels.find((entry) => entry.id === serverModelId(m.id))
      if (!model && m.id !== prefs.enhanceMethod) return []
      return [{ value: m.id, label: renderLabel(m.label), disabled: !model || !model.ready }]
    }),
  ]
  const enhanceNote = (value: string): string | undefined => {
    const model = enhanceModels?.find((entry) => entry.id === serverModelId(value))
    if (serverModelId(value) !== null) {
      if (!model) return t`Not available`
      if (!model.ready) return t`Downloading`
    } else if (browserUnsupported) {
      return t`Not supported on this device`
    }
    const info = enhanceMethodInfo(value)
    return info ? renderLabel(info.hint) : undefined
  }

  return (
    <Stack gap="sm">
      <div>
        <Text fz="xs" c="var(--ink-3)" mb={4}>
          <Trans>Layout</Trans>
        </Text>
        <SegmentedControl
          aria-label={t`Layout`}
          fullWidth
          size="xs"
          value={prefs.mode}
          onChange={(value) => onPrefs({ mode: value as ReaderPrefs['mode'] })}
          data={[
            { label: t`Auto`, value: 'auto' },
            { label: t`Single`, value: 'paged' },
            { label: t`Double`, value: 'double' },
            { label: t`Continuous`, value: 'vertical' },
          ]}
        />
        {autoLayout && (
          <Text fz="xs" c="var(--ink-3)" mt={4}>
            <Trans>Continuous, because this chapter's pages are very tall.</Trans>
          </Text>
        )}
      </div>
      {features.wideSplit && prefs.mode === 'paged' && (
        <div>
          <Text fz="xs" c="var(--ink-3)" mb={4}>
            <Trans>Wide pages</Trans>
          </Text>
          <SegmentedControl
            aria-label={t`Wide pages`}
            fullWidth
            size="xs"
            value={prefs.splitWide}
            onChange={(value) => onPrefs({ splitWide: value as ReaderPrefs['splitWide'] })}
            data={[
              { label: t`Whole`, value: 'off' },
              { label: t`Split`, value: 'split' },
              { label: t`Rotate`, value: 'rotate' },
            ]}
          />
        </div>
      )}
      <div>
        <Text fz="xs" c="var(--ink-3)" mb={4}>
          <Trans>Direction</Trans>
        </Text>
        <SegmentedControl
          aria-label={t`Direction`}
          fullWidth
          size="xs"
          value={prefs.direction}
          onChange={(value) => onPrefs({ direction: value as ReaderPrefs['direction'] })}
          data={[
            { label: t`Left to right`, value: 'ltr' },
            { label: t`Right to left`, value: 'rtl' },
          ]}
        />
      </div>
      <div>
        <Text fz="xs" c="var(--ink-3)" mb={4}>
          <Trans>Fit</Trans>
        </Text>
        <SegmentedControl
          aria-label={t`Fit`}
          fullWidth
          size="xs"
          value={prefs.fit}
          // A zoom tuned for one fit means something else under another, so switching starts again at 100%.
          onChange={(value) => onPrefs({ fit: value as ReaderPrefs['fit'], scale: 100 })}
          data={[
            { label: t`Width`, value: 'width' },
            { label: t`Height`, value: 'height' },
            { label: t`Screen`, value: 'screen' },
            { label: '1:1', value: 'original' },
          ]}
        />
      </div>
      <div>
        <Text fz="xs" c="var(--ink-3)" mb={4}>
          <Trans>Navigation</Trans>
        </Text>
        <SegmentedControl
          fullWidth
          size="xs"
          value={prefs.navigation}
          onChange={(value) => onPrefs({ navigation: value as ReaderPrefs['navigation'] })}
          data={[
            { label: t`Auto`, value: 'auto' },
            { label: t`Horizontal`, value: 'horizontal' },
            { label: t`Vertical`, value: 'vertical' },
          ]}
        />
      </div>
      <div>
        <Group justify="space-between" mb={4} wrap="nowrap">
          <Text fz="xs" c="var(--ink-3)">
            <Trans>Zoom ({scale}%)</Trans>
          </Text>
          {scale !== 100 && (
            <Button size="compact-xs" variant="subtle" onClick={() => onPrefs({ scale: 100 })}>
              <Trans>Reset</Trans>
            </Button>
          )}
        </Group>
        <Slider
          size="xs"
          min={25}
          max={scaleMax(prefs.fit)}
          step={5}
          value={prefs.scale}
          onChange={(value) => onPrefs({ scale: value })}
          marks={[{ value: 100 }]}
          label={(value) => `${value}%`}
        />
        <Text fz="xs" c="var(--ink-4)" mt={6}>
          <Trans>Shrinks or enlarges pages within the fit. For webtoons, fit to width and zoom out until the strip reads comfortably.</Trans>
        </Text>
      </div>
      <div>
        <Text fz="xs" c="var(--ink-3)" mb={4}>
          <Trans>Background</Trans>
        </Text>
        <SegmentedControl
          aria-label={t`Background`}
          fullWidth
          size="xs"
          value={prefs.background === BACKGROUNDS.oled ? 'oled' : 'dark'}
          onChange={(value) =>
            onPrefs({ background: value === 'oled' ? BACKGROUNDS.oled : BACKGROUNDS.dark })
          }
          data={[
            { label: t`Dark`, value: 'dark' },
            { label: t`OLED black`, value: 'oled' },
          ]}
        />
      </div>
      <div>
        <Text fz="xs" c="var(--ink-3)" mb={4}>
          <Trans>Dim ({prefs.dim}%)</Trans>
        </Text>
        <Slider
          thumbLabel={t`Dim`}
          size="xs"
          min={0}
          max={80}
          step={5}
          label={null}
          value={prefs.dim}
          onChange={(value) => onPrefs({ dim: value })}
        />
      </div>
      <div>
        <Text fz="xs" c="var(--ink-3)" mb={4}>
          <Trans>Colour filter</Trans>
        </Text>
        <SegmentedControl
          aria-label={t`Colour filter`}
          fullWidth
          size="xs"
          value={prefs.filter}
          onChange={(value) => onPrefs({ filter: value as ReaderPrefs['filter'] })}
          data={[
            { label: t`None`, value: 'none' },
            { label: t`Gray`, value: 'grayscale' },
            { label: t`Sepia`, value: 'sepia' },
            { label: t`Invert`, value: 'invert' },
          ]}
        />
      </div>
      <div>
        <Text fz="xs" c="var(--ink-3)" mb={4}>
          <Trans>Enhance</Trans>
        </Text>
        <SegmentedControl
          aria-label={t`Enhance`}
          fullWidth
          size="xs"
          value={prefs.enhance}
          onChange={(value) => onPrefs({ enhance: value as ReaderPrefs['enhance'] })}
          data={ENHANCE_LEVELS.map((level) => ({ label: renderLabel(level.label), value: level.value }))}
        />
        {prefs.enhance !== 'off' && enhanceFor(prefs, tier) === 'off' && (
          <Text fz="xs" c="var(--ink-3)" mt={4}>
            <Trans>Off for this chapter because of its quality.</Trans>
          </Text>
        )}
      </div>
      {prefs.enhance !== 'off' && (
        <div>
          <Text fz="xs" c="var(--ink-3)" mb={4}>
            <Trans>Method</Trans>
          </Text>
          <Select
            aria-label={t`Method`}
            size="xs"
            comboboxProps={NESTED_COMBOBOX}
            allowDeselect={false}
            value={prefs.enhanceMethod}
            onChange={(value) => value && onPrefs({ enhanceMethod: value as ReaderPrefs['enhanceMethod'] })}
            data={enhanceOptions}
            renderOption={({ option }) => (
              <div>
                <Text fz="xs">{option.label}</Text>
                <Text fz="xs" c="var(--ink-3)">
                  {enhanceNote(option.value)}
                </Text>
              </div>
            )}
          />
        </div>
      )}
      {prefs.enhance !== 'off' && (
        <div>
          <Text fz="xs" c="var(--ink-3)" mb={4}>
            <Trans>Don't enhance</Trans>
          </Text>
          <MultiSelect
            aria-label={t`Don't enhance`}
            size="xs"
            comboboxProps={NESTED_COMBOBOX}
            placeholder={t`Every quality is enhanced`}
            value={prefs.enhanceSkipTiers}
            onChange={(value) => onPrefs({ enhanceSkipTiers: value as ReaderPrefs['enhanceSkipTiers'] })}
            data={ENHANCE_SKIP_TIERS.map((skip) => ({ value: skip.value, label: renderLabel(skip.label) }))}
          />
        </div>
      )}
      {prefs.enhance !== 'off' && enhanceModels && isServerMethod(prefs.enhanceMethod) && (
        <div>
          <Text fz="xs" c="var(--ink-3)" mb={4}>
            <Trans>While the server works</Trans>
          </Text>
          <SegmentedControl
            aria-label={t`While the server works`}
            fullWidth
            size="xs"
            value={prefs.enhanceFallback}
            onChange={(value) => onPrefs({ enhanceFallback: value as ReaderPrefs['enhanceFallback'] })}
            data={ENHANCE_FALLBACKS.map((f) => ({
              label: renderLabel(f.label),
              value: f.value,
              disabled: browserUnsupported && f.value !== 'off',
            }))}
          />
        </div>
      )}
      <Switch
        size="xs"
        label={t`Crop borders`}
        checked={prefs.cropBorders}
        onChange={(event) => onPrefs({ cropBorders: event.currentTarget.checked })}
      />
      {features.webtoon && (
        <Switch
          size="xs"
          label={t`Scroll webtoon chapters`}
          checked={prefs.autoWebtoon}
          onChange={(event) => onPrefs({ autoWebtoon: event.currentTarget.checked })}
        />
      )}
      <Switch
        size="xs"
        label={t`Tap zones`}
        checked={prefs.tapZones}
        onChange={(event) => onPrefs({ tapZones: event.currentTarget.checked })}
      />
      {prefs.tapZones && (
        <Button size="compact-xs" variant="default" onClick={onEditTapZones}>
          <Trans>Edit tap zones</Trans>
        </Button>
      )}
      <Switch
        size="xs"
        label={t`Show page number`}
        checked={prefs.showPageNumber}
        onChange={(event) => onPrefs({ showPageNumber: event.currentTarget.checked })}
      />
      {features.chapter && (
        <Switch
          size="xs"
          label={t`Flash chapter name on chapter change`}
          checked={prefs.chapterBanner}
          onChange={(event) => onPrefs({ chapterBanner: event.currentTarget.checked })}
        />
      )}
      <Switch
        size="xs"
        label={t`Smooth scrolling`}
        checked={prefs.smoothScroll}
        onChange={(event) => onPrefs({ smoothScroll: event.currentTarget.checked })}
      />
      {features.chapter && (
        <Switch
          size="xs"
          label={t`Auto-advance to next chapter`}
          checked={prefs.autoNextChapter}
          onChange={(event) => onPrefs({ autoNextChapter: event.currentTarget.checked })}
        />
      )}
      {features.wakeLock && wakeLockSupported() && (
        <Switch
          size="xs"
          label={t`Keep the screen awake`}
          checked={prefs.keepAwake}
          onChange={(event) => onPrefs({ keepAwake: event.currentTarget.checked })}
        />
      )}
      {children}
    </Stack>
  )
}
