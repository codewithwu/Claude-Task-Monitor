// LangStore 单测 (08-23 ui-lang-toggle):
//   - 覆盖 cycle/set/sync/currentLang 全部公开方法
//   - vi.mock('vscode', ...) 提供 workspace.getConfiguration stub,
//     记录 update 调用 + 返回预置的 get 值
//   - 沿用 i18n.test.ts 的 mock 模式 (见 [[testing]])

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 桩 vscode 模块:LangStore 只依赖 workspace.getConfiguration().update() / .get()
// + env.language (供 currentLang() 在 auto 模式下解析)。
// 暴露 updateCalls 让测试断言写入行为。
const updateCalls: Array<{ key: string; value: unknown }> = []
let mockConfigValue: unknown = 'auto'

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      update: (key: string, value: unknown) => {
        updateCalls.push({ key, value })
        mockConfigValue = value
        return Promise.resolve()
      },
      get: <T>(_key: string, dflt: T): T => mockConfigValue as T
    })
  },
  env: { language: 'en' },
  // LangStore.set() 显式传入 ConfigurationTarget.Global,数值与 @types/vscode 一致
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }
}))

// 必须在 vi.mock 之后 import (即使 vi.mock 自动 hoist,显式 import 也保证运行顺序)
import { LangStore, isLangPref, nextPref, type LangPref } from '../util/langStore.js'
import { setLangOverride } from '../i18n/index.js'

describe('LangStore cycle', () => {
  beforeEach(() => {
    updateCalls.length = 0
    mockConfigValue = 'auto'
  })

  it('auto → zh', async () => {
    const s = new LangStore('auto')
    const next = await s.cycle()
    expect(next).toBe('zh')
    expect(s.get()).toBe('zh')
    expect(updateCalls).toEqual([{ key: 'language', value: 'zh' }])
  })

  it('zh → en', async () => {
    const s = new LangStore('zh')
    const next = await s.cycle()
    expect(next).toBe('en')
    expect(s.get()).toBe('en')
  })

  it('en → auto (回到隐式跟随)', async () => {
    const s = new LangStore('en')
    const next = await s.cycle()
    expect(next).toBe('auto')
    expect(s.get()).toBe('auto')
  })

  it('三次 cycle 回到起点 (loop 闭合)', async () => {
    const s = new LangStore('auto')
    await s.cycle()
    await s.cycle()
    await s.cycle()
    expect(s.get()).toBe('auto')
  })
})

describe('LangStore.set 幂等', () => {
  beforeEach(() => {
    updateCalls.length = 0
    mockConfigValue = 'auto'
  })

  it('同 pref 重复 set 不写 config', async () => {
    const s = new LangStore('zh')
    await s.set('zh')
    expect(updateCalls).toEqual([])
  })

  it('不同 pref 写 config 一次', async () => {
    const s = new LangStore('auto')
    await s.set('en')
    expect(updateCalls).toEqual([{ key: 'language', value: 'en' }])
    expect(s.get()).toBe('en')
  })
})

describe('LangStore.currentLang', () => {
  it('auto + env=en → en', () => {
    expect(new LangStore('auto').currentLang()).toBe('en')
  })

  it('zh → zh (显式覆盖)', () => {
    expect(new LangStore('zh').currentLang()).toBe('zh')
  })

  it('en → en (显式覆盖)', () => {
    expect(new LangStore('en').currentLang()).toBe('en')
  })
})

describe('LangStore.syncFromConfig', () => {
  beforeEach(() => {
    updateCalls.length = 0
    mockConfigValue = 'auto'
  })

  it('读 config 当前值更新内部 state', () => {
    const s = new LangStore('auto')
    mockConfigValue = 'en'
    s.syncFromConfig()
    expect(s.get()).toBe('en')
  })

  it('默认值 fallback 到 auto (config 无 language 字段时)', () => {
    mockConfigValue = 'auto'
    const s = new LangStore('zh')  // 内部状态是 zh,但 config 是 auto
    expect(s.syncFromConfig()).toBe('auto')
    expect(s.get()).toBe('auto')
  })
})

describe('nextPref 纯函数', () => {
  it.each([
    ['auto', 'zh'],
    ['zh', 'en'],
    ['en', 'auto']
  ] as Array<[LangPref, LangPref]>)('%s → %s', (input, expected) => {
    expect(nextPref(input)).toBe(expected)
  })
})

describe('LangStore.currentLang 与 module override 隔离 (08-25)', () => {
  // env 默认是 'en' (mock);setLangOverride 让 override 模块级共享变量受控。
  beforeEach(() => {
    setLangOverride(undefined)
  })
  afterEach(() => {
    setLangOverride(undefined)
  })

  it('auto 不读 module override —— env=en 但 override=zh 仍跟随 env', () => {
    setLangOverride('zh')
    expect(new LangStore('auto').currentLang()).toBe('en')
  })

  it('auto → zh → en → auto: 回到 env (en)', async () => {
    const s = new LangStore('auto')
    await s.set('zh')
    await s.set('en')
    await s.set('auto')
    expect(s.currentLang()).toBe('en')
  })
})

describe('LangStore defensive fallback (08-25)', () => {
  it('构造器收到非法 pref 回落到 auto + warn 一次', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = new LangStore('fr' as unknown as LangPref)
    expect(s.get()).toBe('auto')
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('构造器收到 null/undefined 也回落', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(new LangStore(null as unknown as LangPref).get()).toBe('auto')
    expect(new LangStore(undefined as unknown as LangPref).get()).toBe('auto')
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('syncFromConfig 读到非法 pref 回落到 auto + warn', () => {
    mockConfigValue = 'fr'
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = new LangStore('zh')
    expect(s.syncFromConfig()).toBe('auto')
    expect(s.get()).toBe('auto')
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

describe('isLangPref (08-25)', () => {
  it.each(['auto', 'zh', 'en'])('接受合法值 %s', (p) => {
    expect(isLangPref(p)).toBe(true)
  })

  it.each(['fr', 'zh-cn', 'en-us', '', 'AUTO', null, undefined, 0, {}, []])(
    '拒绝非法值 %s',
    (p) => {
      expect(isLangPref(p as unknown)).toBe(false)
    }
  )
})
