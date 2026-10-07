const api = typeof browser !== 'undefined' ? browser : chrome
const $ = (id) => document.getElementById(id)

function say(text, bad) {
  $('status').textContent = text
  $('status').className = bad ? 'bad' : ''
}

async function load() {
  const { serverUrl = '', apiKey = '' } = await api.storage.local.get(['serverUrl', 'apiKey'])
  $('serverUrl').value = serverUrl
  $('apiKey').value = apiKey
}

async function save() {
  let origin
  try {
    origin = new URL($('serverUrl').value.trim()).origin
  } catch {
    say('Enter the server address, for example http://192.168.1.50:8990', true)
    return false
  }
  // The permission prompt must come straight from the click, before any other await.
  const granted = await api.permissions.request({ origins: [`${origin}/*`] })
  if (!granted) {
    say('The extension needs permission to reach that address.', true)
    return false
  }
  await api.storage.local.set({ serverUrl: origin, apiKey: $('apiKey').value.trim() })
  $('serverUrl').value = origin
  say('Saved.')
  return true
}

$('save').addEventListener('click', () => void save())
$('test').addEventListener('click', async () => {
  if (!(await save())) return
  say('Testing...')
  const result = await api.runtime.sendMessage({ type: 'test' })
  say(result.message, !result.ok)
})

void load()
