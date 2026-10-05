import { useEffect, useId, useRef } from 'react'

/**
 * Makes the browser's back button (and the Android back gesture) close a full-screen overlay
 * instead of leaving the page underneath it. An overlay is not a route, so without this "back"
 * pops the previous page and the reader's origin is lost.
 *
 * Mounting pushes one history entry that carries the current router state, so the location does
 * not change. Back pops it and closes the overlay; closing it any other way pops it quietly.
 * The pop on unmount is deferred a tick so StrictMode's mount, unmount, mount reuses the entry
 * instead of popping straight into a close.
 */
export function useBackClosesOverlay(onClose: () => void) {
  const id = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const pendingBack = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.clearTimeout(pendingBack.current)
    if (window.history.state?.overlay !== id) {
      window.history.pushState({ ...window.history.state, overlay: id }, '')
    }

    let poppedByUser = false
    const onPop = () => {
      poppedByUser = true
      closeRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (poppedByUser) return
      pendingBack.current = window.setTimeout(() => {
        if (window.history.state?.overlay === id) window.history.back()
      }, 0)
    }
  }, [id])
}
