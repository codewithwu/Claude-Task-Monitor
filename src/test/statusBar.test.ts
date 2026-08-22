import { describe, it, expect, vi } from 'vitest'
import { computeStatusBarContent, formatWaitingTooltip } from '../util/statusBarContent.js'
import type { SessionState } from '../types.js'

// statusBarContent 走 i18n,i18n 内部 import vscode.
// vi.mock 占位让模块解析通过;language 设为 'zh-cn' 跟既有断言对齐 (测试期望中文文案)
vi.mock('vscode', () => ({ env: { language: 'zh-cn' } }))

function s(status: 'idle' | 'running' | 'waiting'): { status: 'idle' | 'running' | 'waiting' } {
  return { status }
}

describe('computeStatusBarContent', () => {
  it('空列表 → "CTM",tooltip 显示 0 个会话 (i18n zh)', () => {
    const c = computeStatusBarContent([])
    expect(c.text).toBe('$(pulse) CTM')
    expect(c.tooltip).toBe('Claude Task Monitor · 0 个会话')
  })

  it('只有 idle/running → "CTM",无 ⚠', () => {
    const c = computeStatusBarContent([s('idle'), s('running'), s('idle')])
    expect(c.text).toBe('$(pulse) CTM')
    expect(c.tooltip).toBe('Claude Task Monitor · 3 个会话')
  })

  it('1 个 waiting → "CTM: 1⚠" + tooltip 占位 (实际由 statusBar.ts 用 formatWaitingTooltip 覆盖)', () => {
    const c = computeStatusBarContent([s('waiting'), s('idle')])
    expect(c.text).toBe('$(pulse) CTM: 1⚠')
    // tooltip 是占位 —— 真实展示由 ui/statusBar.ts 用 formatWaitingTooltip 渲染
    expect(c.tooltip).toBe('1 个等待权限：')
  })

  it('多个 waiting → 数字累加', () => {
    const c = computeStatusBarContent([s('waiting'), s('waiting'), s('waiting'), s('running')])
    expect(c.text).toBe('$(pulse) CTM: 3⚠')
    expect(c.tooltip).toBe('3 个等待权限：')
  })
})

function makeWaiting(id: string, cwd: string, stateChangedAt: number): SessionState {
  return {
    sessionId: id,
    cwd,
    status: 'waiting',
    stateChangedAt,
    lastUserPrompt: '',
    currentTool: null,
    fileOffset: 0
  }
}

describe('formatWaitingTooltip', () => {
  const NOW = 1_000_000

  it('空列表 → 返回空字符串 (caller 判断长度避免拼成空 tooltip)', () => {
    expect(formatWaitingTooltip([], NOW)).toBe('')
  })

  it('1 个 waiting → 单条文案 + 时长', () => {
    const out = formatWaitingTooltip([makeWaiting('a', '/home/me/proj-a', NOW - 60)], NOW)
    expect(out).toBe('1 个等待权限：proj-a 1m')
  })

  it('3 个 waiting → 全部列出', () => {
    const sessions = [
      makeWaiting('a', '/home/me/proj-a', NOW - 30),
      makeWaiting('b', '/home/me/proj-b', NOW - 90),
      makeWaiting('c', '/home/me/proj-c', NOW - 3660)  // 1h 1m
    ]
    const out = formatWaitingTooltip(sessions, NOW)
    expect(out).toBe('3 个等待权限：proj-a 30s, proj-b 1m 30s, proj-c 1h 1m')
  })

  it('4 个 waiting → 列前 3 个 + "等 4 个"', () => {
    const sessions = [
      makeWaiting('a', '/p/a', NOW - 30),
      makeWaiting('b', '/p/b', NOW - 30),
      makeWaiting('c', '/p/c', NOW - 30),
      makeWaiting('d', '/p/d', NOW - 30)
    ]
    const out = formatWaitingTooltip(sessions, NOW)
    expect(out).toBe('4 个等待权限：a 30s, b 30s, c 30s 等 4 个')
  })

  it('cwd 是根路径时 fallback 到 cwd 字符串', () => {
    const out = formatWaitingTooltip([makeWaiting('a', '/', NOW)], NOW)
    expect(out).toContain('/')
  })

  it('自定义 topN=2:3 个 waiting 只列前 2 + "等 3 个"', () => {
    const sessions = [
      makeWaiting('a', '/p/a', NOW - 30),
      makeWaiting('b', '/p/b', NOW - 30),
      makeWaiting('c', '/p/c', NOW - 30)
    ]
    const out = formatWaitingTooltip(sessions, NOW, 2)
    expect(out).toBe('3 个等待权限：a 30s, b 30s 等 3 个')
  })
})