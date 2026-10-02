import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Center, Loader, Modal, Stack, Text } from '@mantine/core'
import { Trans, useLingui } from '@lingui/react/macro'
import qrcode from 'qrcode-generator'
import { api } from '../../api/client'

interface Pairing {
  code: string
  expiresAt: string
}

/** The address the Android app scans: the server, and a one-time code that signs it in as this account. */
export function pairingLink(origin: string, code: string): string {
  return `fokuroru://pair?s=${encodeURIComponent(origin)}&t=${encodeURIComponent(code)}`
}

function QrCode({ text }: { text: string }) {
  const { t } = useLingui()
  const src = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    return qr.createDataURL(8, 4)
  }, [text])
  return (
    <img
      src={src}
      alt={t`QR code for pairing the Android app`}
      width={280}
      height={280}
      style={{ width: 'min(100%, 280px)', height: 'auto', background: '#fff', borderRadius: 8, imageRendering: 'pixelated' }}
    />
  )
}

/**
 * Shows a QR code the Android app scans to add this server and sign in as the current account. The code
 * works once and for five minutes, so it is made when the window opens and again on request.
 */
export default function PairAppModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const make = useCallback(() => {
    setPairing(null)
    setFailed(false)
    api<Pairing>('/auth/pairing', { method: 'POST' }).then(setPairing, () => setFailed(true))
  }, [])

  useEffect(() => {
    if (opened) make()
    else setPairing(null)
  }, [opened, make])

  useEffect(() => {
    if (!opened) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [opened])

  const left = pairing ? Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - now) / 1000)) : 0
  const expired = pairing !== null && left === 0

  return (
    <Modal opened={opened} onClose={onClose} title={<Trans>Pair the Android app</Trans>} centered>
      <Stack align="center" gap="sm">
        <Text size="sm" ta="center">
          <Trans>
            In the app, choose Scan QR code on the first screen or in Servers and accounts, then point it at this
            code. The app is signed in as you.
          </Trans>
        </Text>
        {failed ? (
          <Text c="red" size="sm">
            <Trans>Could not make a code. Try again.</Trans>
          </Text>
        ) : !pairing ? (
          <Center h={200}>
            <Loader />
          </Center>
        ) : (
          <div style={{ opacity: expired ? 0.2 : 1 }}>
            <QrCode text={pairingLink(window.location.origin, pairing.code)} />
          </div>
        )}
        {pairing && (
          <Text size="xs" c="dimmed" className="tnum">
            {expired ? (
              <Trans>This code has expired.</Trans>
            ) : (
              <Trans>
                Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more.
              </Trans>
            )}
          </Text>
        )}
        <Button variant="default" onClick={make}>
          <Trans>Make a new code</Trans>
        </Button>
      </Stack>
    </Modal>
  )
}
