import type { CoralieStorage } from './coralie-host.interface'

type StorageBackend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function resolveLocalStorage(): StorageBackend | null {
  if (typeof window === 'undefined') return null

  try {
    const storage = window.localStorage
    if (!storage) return null

    const probeKey = '__coralie_storage_probe__'
    storage.setItem(probeKey, '1')
    storage.removeItem(probeKey)

    return storage
  } catch {
    return null
  }
}

/**
 * Browser implementation of the portable asynchronous storage API.
 *
 * Values are persisted in `window.localStorage` when it is usable. An in-memory
 * fallback prevents callers from crashing in restricted browser contexts where
 * local storage is absent or becomes unavailable.
 */
export class BrowserCoralieStorage implements CoralieStorage {
  private backend: StorageBackend | null
  private readonly memoryFallback = new Map<string, string>()

  constructor(backend: StorageBackend | null = resolveLocalStorage()) {
    this.backend = backend
  }

  async getItem(key: string): Promise<string | null> {
    const normalisedKey = String(key)

    if (this.backend) {
      try {
        return this.backend.getItem(normalisedKey)
      } catch {
        this.backend = null
      }
    }

    return this.memoryFallback.get(normalisedKey) ?? null
  }

  async setItem(key: string, value: string): Promise<void> {
    const normalisedKey = String(key)
    const normalisedValue = String(value)

    if (this.backend) {
      try {
        this.backend.setItem(normalisedKey, normalisedValue)
        return
      } catch {
        this.backend = null
      }
    }

    this.memoryFallback.set(normalisedKey, normalisedValue)
  }

  async removeItem(key: string): Promise<void> {
    const normalisedKey = String(key)

    if (this.backend) {
      try {
        this.backend.removeItem(normalisedKey)
        return
      } catch {
        this.backend = null
      }
    }

    this.memoryFallback.delete(normalisedKey)
  }
}
