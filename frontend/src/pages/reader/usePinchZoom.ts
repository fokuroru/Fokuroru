import { useEffect, useRef, type RefObject } from 'react'

const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

/**
 * Two-finger pinch on a touch screen. The value at the start of the gesture is scaled by how far
 * the fingers have moved apart or together, so the page follows the fingers instead of stepping.
 *
 * `get` and `set` are read through a ref, so callers can pass inline closures without the
 * listeners being re-attached on every render. Returns a ref that is true for a moment after a
 * pinch ends, so the surface's click handler can ignore the tap a lifted finger sometimes leaves.
 */
export function usePinchZoom(
  target: RefObject<HTMLElement | null>,
  get: () => number,
  set: (value: number) => void,
  min: number,
  max: number,
  enabled = true,
): RefObject<boolean> {
  const latest = useRef({ get, set, min, max })
  latest.current = { get, set, min, max }
  const justPinched = useRef(false)

  useEffect(() => {
    const el = target.current
    if (!el || !enabled) return

    let startDistance = 0
    let startValue = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      startDistance = distance(event.touches[0]!, event.touches[1]!)
      startValue = latest.current.get()
    }
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || startDistance === 0) return
      // Without this the browser zooms the whole page as well as the reader.
      event.preventDefault()
      const { set, min, max } = latest.current
      const ratio = distance(event.touches[0]!, event.touches[1]!) / startDistance
      set(Math.min(max, Math.max(min, startValue * ratio)))
    }
    const onEnd = (event: TouchEvent) => {
      if (startDistance === 0) return
      if (event.touches.length < 2) {
        startDistance = 0
        justPinched.current = true
        clearTimeout(timer)
        timer = setTimeout(() => (justPinched.current = false), 300)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      clearTimeout(timer)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [target, enabled])

  return justPinched
}
