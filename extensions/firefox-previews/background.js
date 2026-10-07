const api = typeof browser !== 'undefined' ? browser : chrome

async function settings() {
  const { serverUrl = '', apiKey = '' } = await api.storage.local.get(['serverUrl', 'apiKey'])
  return { serverUrl: serverUrl.replace(/\/+$/, ''), apiKey: apiKey.trim() }
}

async function call(path, method) {
  const { serverUrl, apiKey } = await settings()
  if (!serverUrl || !apiKey) {
    return { ok: false, message: 'Set your Fokuroru server address and API key in the extension settings.' }
  }
  let res
  try {
    res = await fetch(`${serverUrl}/api/v1${path}`, { method, headers: { 'X-Api-Key': apiKey, Accept: 'application/json' } })
  } catch {
    return { ok: false, message: `Could not reach ${serverUrl}. Check the address and that the extension may access it.` }
  }
  let body = null
  try {
    body = await res.json()
  } catch {
    // no body
  }
  return { ok: res.ok, status: res.status, body }
}

function failure(result) {
  const detail = result.body && (result.body.message || result.body.error || result.body.title)
  switch (result.status) {
    case 401:
      return 'Fokuroru rejected the API key. Create a new one in Fokuroru settings.'
    case 403:
      return detail || 'Your Fokuroru account is not allowed to preview this series.'
    case 404:
      return 'Fokuroru has no previewable series for this page (novels cannot be previewed).'
    default:
      return detail || `Fokuroru answered ${result.status}.`
  }
}

async function preview(providerId) {
  const started = await call(`/preview/${encodeURIComponent(providerId)}`, 'POST')
  if (started.message) return { ok: false, message: started.message }
  if (!started.ok) return { ok: false, message: failure(started) }
  // The request is held by the server from here on; drop the viewer this call registered.
  void call(`/preview/${encodeURIComponent(providerId)}`, 'DELETE')
  const status = started.body && started.body.status
  const text = {
    ready: 'Preview is ready in Fokuroru.',
    queued: 'Queued in Fokuroru. It starts when a slot frees.',
    searching: 'Fokuroru is looking for a source.',
    fetching: 'Fokuroru is downloading the first chapter.',
  }[status]
  return { ok: true, message: text || 'Preview requested in Fokuroru.' }
}

async function test() {
  const result = await call('/preview/pending', 'GET')
  if (result.message) return { ok: false, message: result.message }
  return result.ok ? { ok: true, message: 'Connected to Fokuroru.' } : { ok: false, message: failure(result) }
}

api.runtime.onMessage.addListener((message) => {
  if (message.type === 'preview') return preview(message.providerId)
  if (message.type === 'test') return test()
  return undefined
})

api.action.onClicked.addListener(() => api.runtime.openOptionsPage())
