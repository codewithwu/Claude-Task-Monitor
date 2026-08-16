import { describe, it, expect, beforeEach } from 'vitest'
import { hasSeenOnboarding, markOnboardingShown, resetOnboarding } from '../util/onboardingState.js'
import type { ExtensionContext } from 'vscode'

function makeContext(initial: Record<string, unknown> = {}): ExtensionContext {
  const store = new Map<string, unknown>(Object.entries(initial))
  return {
    globalState: {
      get: <T>(key: string, defaultValue?: T) => (store.has(key) ? (store.get(key) as T) : defaultValue),
      update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve() }
    }
  } as unknown as ExtensionContext
}

describe('onboardingState', () => {
  let ctx: ExtensionContext

  beforeEach(() => {
    ctx = makeContext()
  })

  it('首次:hasSeenOnboarding 返回 false', () => {
    expect(hasSeenOnboarding(ctx)).toBe(false)
  })

  it('markOnboardingShown 后 hasSeenOnboarding 返回 true', async () => {
    await markOnboardingShown(ctx)
    expect(hasSeenOnboarding(ctx)).toBe(true)
  })

  it('resetOnboarding 后重新返回 false', async () => {
    await markOnboardingShown(ctx)
    expect(hasSeenOnboarding(ctx)).toBe(true)
    await resetOnboarding(ctx)
    expect(hasSeenOnboarding(ctx)).toBe(false)
  })

  it('幂等:多次 mark 不会覆盖成 false', async () => {
    await markOnboardingShown(ctx)
    await markOnboardingShown(ctx)
    expect(hasSeenOnboarding(ctx)).toBe(true)
  })
})