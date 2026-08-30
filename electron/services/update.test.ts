import { describe, it, expect } from 'vitest'
import { createUpdateService, type UpdaterApi } from './update'

function makeUpdater(
  result: { isUpdateAvailable: boolean; updateInfo?: { version?: string | number } },
  error?: Error
) {
  let quitCalls = 0
  const api: UpdaterApi = {
    currentVersion: '0.1.0',
    checkForUpdates: () => (error ? Promise.reject(error) : Promise.resolve(result)),
    quitAndInstall: () => {
      quitCalls++
    }
  }
  return { api, getQuitCalls: () => quitCalls }
}

describe('createUpdateService', () => {
  it('maps available update to status=available with version', async () => {
    const { api } = makeUpdater({ isUpdateAvailable: true, updateInfo: { version: '0.2.0' } })
    const res = await createUpdateService(api).checkUpdate()
    expect(res.status).toBe('available')
    expect(res.version).toBe('0.2.0')
  })

  it('maps no-update to status=up-to-date', async () => {
    const { api } = makeUpdater({ isUpdateAvailable: false })
    const res = await createUpdateService(api).checkUpdate()
    expect(res.status).toBe('up-to-date')
    expect(res.version).toBeUndefined()
  })

  it('maps check error to status=error with message', async () => {
    const { api } = makeUpdater({ isUpdateAvailable: false }, new Error('network down'))
    const res = await createUpdateService(api).checkUpdate()
    expect(res.status).toBe('error')
    expect(res.error).toContain('network down')
  })

  it('installUpdate triggers quitAndInstall exactly once', () => {
    const { api, getQuitCalls } = makeUpdater({ isUpdateAvailable: false })
    createUpdateService(api).installUpdate()
    expect(getQuitCalls()).toBe(1)
  })

  it('exposes currentVersion from the underlying api', () => {
    const { api } = makeUpdater({ isUpdateAvailable: false })
    expect(createUpdateService(api).currentVersion).toBe('0.1.0')
  })
})
