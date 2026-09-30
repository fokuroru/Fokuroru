import { UnstyledButton } from '@mantine/core'
import { useLingui } from '@lingui/react/macro'
import { useLabel } from '../i18n-context'
import { useThemeChoice } from '../theme-context'

/** The theme swatches: dark, light or the OS setting. Shared by Settings and the setup wizard. */
export function AppearancePicker() {
  const { t } = useLingui()
  const renderLabel = useLabel()
  const { themeId, setThemeId, presets } = useThemeChoice()

  return (
    <div className="setup-swatches" role="radiogroup" aria-label={t`Appearance`}>
      {presets.map((p) => {
        const active = p.id === themeId
        return (
          <UnstyledButton
            key={p.id}
            role="radio"
            aria-checked={active}
            className="setup-swatch"
            data-active={active || undefined}
            onClick={() => setThemeId(p.id)}
          >
            <span className="setup-swatch-dot" style={{ background: p.swatch }} />
            <span>{renderLabel(p.label)}</span>
          </UnstyledButton>
        )
      })}
    </div>
  )
}
