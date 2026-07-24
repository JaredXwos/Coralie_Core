import type { CreateLiveConnectionManagerOptions } from '../create-live-connection-manager'
import type { CoralieHost } from './coralie-host.interface'
import { BrowserCoralieHost } from './browser-coralie-host'

type WindowWithOptionalCoralie = {
  Coralie?: CoralieHost
}

/**
 * Installs the browser host only when the embedding environment has not
 * already supplied `window.Coralie`.
 *
 * Android injects its native object before page scripts execute. Loading the
 * browser host bundle in Android is therefore a true no-op: the existing
 * object is returned unchanged and is not validated, wrapped, or replaced.
 */
export function installBrowserCoralie(
  options: CreateLiveConnectionManagerOptions = {},
): CoralieHost | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const target = window as unknown as WindowWithOptionalCoralie

  if (target.Coralie !== undefined) {
    return target.Coralie
  }

  const host = new BrowserCoralieHost(options)

  Object.defineProperty(target, 'Coralie', {
    value: host,
    writable: false,
    configurable: false,
    enumerable: true,
  })

  return host
}
