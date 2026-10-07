const api = typeof browser !== 'undefined' ? browser : chrome

const SERIES = /^\/(manga|manhwa|manhua|oel|other|novel)\/(\d+)(?:\/|$)/
const MARK = 'data-fokuroru-preview'

const STYLE = `
  :host { all: initial; }
  button {
    font: 600 13px/1 system-ui, sans-serif; cursor: pointer; border: 0; border-radius: 8px;
    padding: 8px 12px; color: #fff; background: #7a4fd6; box-shadow: 0 1px 4px #0005;
  }
  button:hover { background: #6a3fc6; }
  button[disabled] { opacity: .7; cursor: default; }
  button.small { padding: 5px 8px; font-size: 12px; }
  .toast {
    position: fixed; right: 16px; bottom: 16px; max-width: 320px; padding: 10px 14px; border-radius: 8px;
    font: 14px/1.35 system-ui, sans-serif; color: #fff; background: #2b2433; box-shadow: 0 2px 10px #0007; z-index: 2147483647;
  }
  .toast.bad { background: #a32b3b; }
`

let toastTimer
function toast(text, bad) {
  let host = document.getElementById('fokuroru-toast')
  if (!host) {
    host = document.createElement('div')
    host.id = 'fokuroru-toast'
    host.attachShadow({ mode: 'open' }).innerHTML = `<style>${STYLE}</style><div class="toast"></div>`
    document.documentElement.append(host)
  }
  const box = host.shadowRoot.querySelector('.toast')
  box.textContent = text
  box.classList.toggle('bad', Boolean(bad))
  host.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (host.hidden = true), 5000)
}

function makeButton(providerId, small) {
  const host = document.createElement('span')
  host.setAttribute(MARK, providerId)
  host.attachShadow({ mode: 'open' }).innerHTML =
    `<style>${STYLE}</style><button type="button" class="${small ? 'small' : ''}" title="Download chapter 1 into Fokuroru">Preview</button>`
  const button = host.shadowRoot.querySelector('button')
  button.addEventListener('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()
    button.disabled = true
    button.textContent = '...'
    try {
      const result = await api.runtime.sendMessage({ type: 'preview', providerId })
      toast(result.message, !result.ok)
      button.textContent = result.ok ? 'Requested' : 'Preview'
      button.disabled = result.ok
    } catch {
      toast('The extension could not reach its background page. Reload the tab.', true)
      button.textContent = 'Preview'
      button.disabled = false
    }
  })
  return host
}

function seriesFromPath(path) {
  const match = SERIES.exec(path)
  return match && match[1] !== 'novel' ? match[2] : null
}

function addPageButton() {
  const id = seriesFromPath(location.pathname)
  const existing = document.querySelector(`[${MARK}="page"]`)
  if (!id) {
    existing?.remove()
    return
  }
  const h1 = document.querySelector('h1')
  if (!h1) return
  if (existing && existing.dataset.id === id && existing.isConnected) return
  existing?.remove()
  const host = makeButton(id, false)
  host.setAttribute(MARK, 'page')
  host.dataset.id = id
  host.style.marginLeft = '12px'
  host.style.alignSelf = 'center'
  h1.append(host)
}

function addCardButtons() {
  for (const link of document.querySelectorAll('a[href]')) {
    if (link.hasAttribute('data-fokuroru-seen')) continue
    let path
    try {
      path = new URL(link.href).pathname
    } catch {
      continue
    }
    const id = seriesFromPath(path)
    if (!id || !link.querySelector('img')) continue
    link.setAttribute('data-fokuroru-seen', '')
    if (getComputedStyle(link).position === 'static') link.style.position = 'relative'
    const host = makeButton(id, true)
    host.style.cssText = 'position:absolute;top:6px;right:6px;z-index:5;opacity:0;transition:opacity .15s'
    link.addEventListener('mouseenter', () => (host.style.opacity = '1'))
    link.addEventListener('mouseleave', () => (host.style.opacity = '0'))
    link.addEventListener('focusin', () => (host.style.opacity = '1'))
    link.append(host)
  }
}

let scheduled = false
function refresh() {
  if (scheduled) return
  scheduled = true
  setTimeout(() => {
    scheduled = false
    addPageButton()
    addCardButtons()
  }, 150)
}

new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true })
refresh()
