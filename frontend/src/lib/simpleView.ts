import { nativeApp } from './nativeApp'

const KEY = 'maki.simpleView'

/**
 * Whether "/" should open the simple view. The Android app defaults to it and a browser to the full
 * interface; either way an explicit choice wins, and is remembered on this device.
 */
export function simpleViewPreferred(): boolean {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'on') return true
    if (stored === 'off') return false
  } catch {
    // Storage can be blocked; the default below still applies.
  }
  return nativeApp() !== undefined
}

export function setSimpleViewPreferred(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Not remembered, which only costs a repeat of the choice.
  }
}
