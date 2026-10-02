import { useRef, type PointerEvent, type MouseEvent } from 'react'

const HOLD_MS = 450
const SLOP = 10

/**
 * Touch-and-hold on an element that is also a link. The hold opens something instead of the link, so the
 * click that follows the finger lifting is swallowed, and the browser's own press menu is kept away.
 */
export function useLongPress(onHold: () => void) {
  const timer = useRef<number | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const cancel = () => {
    window.clearTimeout(timer.current)
    start.current = null
  }

  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        fired.current = true
        start.current = null
        navigator.vibrate?.(15)
        onHold()
      }, HOLD_MS)
    },
    onPointerMove: (e: PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > SLOP) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    onClickCapture: (e: MouseEvent) => {
      if (fired.current) {
        e.preventDefault()
        e.stopPropagation()
        fired.current = false
      }
    },
  }
}
