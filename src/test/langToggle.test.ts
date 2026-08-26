import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest'

// 桩 vscode 模块:LangToggle 只用到 vscode.window.createStatusBarItem + StatusBarAlignment。
// language 设为 'en' —— 测试期望英文 tooltip ('UI language: ...' 模板)。
// createStatusBarItem 模拟真实 API 行为:把 alignment + priority 写入返回对象,
// 让测试可以校验 item.priority (符合 vscode 真实语义)。
vi.mock('vscode', () => ({
  env: { language: 'en' },
  window: {
    createStatusBarItem: vi.fn()
  },
  StatusBarAlignment: { Left: 0, Right: 1 }
}))

import * as vscode from 'vscode'
import { LangToggle } from '../ui/langToggle.js'
import { type LangPref } from '../util/langStore.js'

// Mock StatusBarItem
const mockItem = () => ({
  text: '',
  tooltip: undefined as string | undefined,
  command: undefined as string | undefined,
  name: undefined as string | undefined,
  alignment: 0,
  priority: 0,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
})

describe('LangToggle (08-26)', () => {
  let item: ReturnType<typeof mockItem>
  let createSpy: MockInstance

  beforeEach(() => {
    item = mockItem()
    const createMock = vi.mocked(vscode.window.createStatusBarItem)
    createMock.mockReset()
    createMock.mockImplementation((alignment?: unknown, priority?: number) => {
      item.alignment = alignment as number
      item.priority = priority ?? 0
      return item as unknown as vscode.StatusBarItem
    })
    createSpy = createMock
  })

  it('renders auto: text = $(globe) A, show() called', () => {
    new LangToggle(() => 'auto')
    expect(item.text).toBe('$(globe) A')
    expect(item.tooltip).toContain('UI language')
    expect(item.show).toHaveBeenCalledTimes(1)
  })

  it('renders zh: text = $(globe) 中, tooltip mentions next = en', () => {
    new LangToggle(() => 'zh')
    expect(item.text).toBe('$(globe) 中')
    // nextPref(zh) = 'en' → tooltip should mention English state
    expect(item.tooltip).toMatch(/English|英文/)
  })

  it('renders en: text = $(globe) EN, tooltip mentions next = auto', () => {
    new LangToggle(() => 'en')
    expect(item.text).toBe('$(globe) EN')
    // nextPref(en) = 'auto' → tooltip should mention Auto state
    expect(item.tooltip).toMatch(/Auto|自动/)
  })

  it('render() reflects getter change (no internal caching)', () => {
    let pref: LangPref = 'auto'
    const t = new LangToggle(() => pref)
    expect(item.text).toBe('$(globe) A')

    pref = 'zh'
    t.render()
    expect(item.text).toBe('$(globe) 中')

    pref = 'en'
    t.render()
    expect(item.text).toBe('$(globe) EN')
  })

  it('dispose() disposes the underlying StatusBarItem', () => {
    const t = new LangToggle(() => 'auto')
    t.dispose()
    expect(item.dispose).toHaveBeenCalledTimes(1)
  })

  it('constructor throws if getPref returns invalid value (defense shift, R1)', () => {
    expect(() =>
      new LangToggle(() => 'fr' as unknown as LangPref)
    ).toThrow(/LangToggle/)
  })

  it('command is set to claudeTaskMonitor.toggleLanguage', () => {
    new LangToggle(() => 'auto')
    expect(item.command).toBe('claudeTaskMonitor.toggleLanguage')
  })

  it('priority is 99 (sibling to CTM at 100)', () => {
    new LangToggle(() => 'auto')
    expect(item.priority).toBe(99)
  })
})
