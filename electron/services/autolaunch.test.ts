import { describe, it, expect } from 'vitest'
import { createAutoLaunchService, type LoginItemApi } from './autolaunch'

function makeApi(initial = false): LoginItemApi {
  let openAtLogin = initial
  return {
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings: (s) => {
      openAtLogin = s.openAtLogin
    }
  }
}

describe('createAutoLaunchService', () => {
  it('reads initial state', () => {
    expect(createAutoLaunchService(makeApi(true)).get()).toBe(true)
    expect(createAutoLaunchService(makeApi(false)).get()).toBe(false)
  })

  it('enables auto-launch and persists it', () => {
    const api = makeApi(false)
    const svc = createAutoLaunchService(api)
    expect(svc.set(true)).toBe(true)
    expect(api.getLoginItemSettings().openAtLogin).toBe(true)
  })

  it('disables auto-launch and persists it', () => {
    const api = makeApi(true)
    const svc = createAutoLaunchService(api)
    expect(svc.set(false)).toBe(false)
    expect(api.getLoginItemSettings().openAtLogin).toBe(false)
  })
})
