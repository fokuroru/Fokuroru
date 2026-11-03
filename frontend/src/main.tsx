import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Notifications, notifications } from '@mantine/notifications'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { useLingui } from '@lingui/react/macro'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
// Bundled rather than linked from a font CDN: a self-hosted instance may have no internet, and
// the theme's font stack named Inter without anything ever loading it.
import '@fontsource/zen-kaku-gothic-new/400.css'
import '@fontsource/zen-kaku-gothic-new/500.css'
import '@fontsource/zen-kaku-gothic-new/700.css'
import '@fontsource/zen-kaku-gothic-new/900.css'
import '@fontsource-variable/martian-mono'
import './theme.css'
import { AppThemeProvider } from './theme-context'
import { AppI18nProvider } from './i18n-context'
import { loadLocale, resolveInitialLocale } from './i18n'
import App from './App.tsx'
import { ApiError, isLocalCatalogueUnavailable } from './api/client'
import { syncSkeletonPulses } from './lib/skeletonSync'

syncSkeletonPulses()

/**
 * One place that reports failures, so no call site can swallow one by forgetting a handler,
 * which is exactly how the series monitor toggle ended up reverting silently. Call sites only
 * need their own `onError` for extra work (resetting local state); the toast is automatic.
 *
 * `meta.errorMessage` overrides the text; `meta.silent` opts out entirely for flows that show
 * failure inline (bulk actions with per-row results). `meta.inlineNotFound` drops only a 404, for
 * pages that render their own not-found state.
 */
function reportError(error: unknown, meta?: Record<string, unknown>) {
  if (meta?.silent) return
  // Pages that need the catalogue explain this inline, with the download's progress.
  if (isLocalCatalogueUnavailable(error)) return
  if (meta?.inlineNotFound && error instanceof ApiError && error.status === 404) return
  notifications.show({
    message:
      typeof meta?.errorMessage === 'string'
        ? meta.errorMessage
        : error instanceof Error
          ? error.message
          : String(error),
    color: 'var(--danger)',
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 404 won't change on a second try; retrying only delays the page's not-found state.
      retry: (failureCount, error) => failureCount < 1 && !(error instanceof ApiError && error.status === 404),
      refetchOnWindowFocus: false,
    },
  },
  // Background refetches fail silently by design: a toast on every poll while the API is down
  // would bury the app. Only surface a query error when there's no data to fall back on.
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.state.data === undefined) reportError(error, query.meta)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => reportError(error, mutation.meta),
  }),
})

// Awaited before the first render rather than loaded in an effect: a catalogue that arrives after
// mount means the app paints once in English and then swaps, which is worse than one chunk fetch on
// a cold cache. Top-level await is fine here, main.tsx is an ES module.
await loadLocale(resolveInitialLocale())

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

/** Mantine's toast close button ships unnamed and Notifications takes no prop for it, so name each as it mounts. */
function ToastHost() {
  const { t } = useLingui()
  const label = t`Close`
  useEffect(() => {
    const name = () =>
      document
        .querySelectorAll('.mantine-Notification-closeButton:not([aria-label])')
        .forEach((b) => b.setAttribute('aria-label', label))
    name()
    const observer = new MutationObserver(name)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [label])
  return <Notifications autoClose={6000} zIndex={2000} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppI18nProvider>
      <AppThemeProvider>
        {/* Above every modal, not Mantine's default 400. The Discover detail modal sits at 1000 and
            the fullscreen "Show more" modal above that, so a toast raised by an action taken inside
            one of them rendered behind it: the action worked, said so, and the reader saw nothing. */}
        <ToastHost />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </AppThemeProvider>
    </AppI18nProvider>
  </StrictMode>,
)
