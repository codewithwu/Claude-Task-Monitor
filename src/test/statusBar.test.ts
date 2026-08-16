import { describe, it, expect } from 'vitest'
import { computeStatusBarContent } from '../util/statusBarContent.js'

function s(status: 'idle' | 'running' | 'waiting'): { status: 'idle' | 'running' | 'waiting' } {
  return { status }
}

describe('computeStatusBarContent', () => {
  it('空列表 → "CTM",tooltip 显示 0 sessions', () => {
    const c = computeStatusBarContent([])
    expect(c.text).toBe('$(pulse) CTM')
    expect(c.tooltip).toBe('Claude Task Monitor · 0 sessions active')
  })

  it('只有 idle/running → "CTM",无 ⚠', () => {
    const c = computeStatusBarContent([s('idle'), s('running'), s('idle')])
    expect(c.text).toBe('$(pulse) CTM')
    expect(c.tooltip).toBe('Claude Task Monitor · 3 sessions active')
  })

  it('1 个 waiting → "CTM: 1⚠"', () => {
    const c = computeStatusBarContent([s('waiting'), s('idle')])
    expect(c.text).toBe('$(pulse) CTM: 1⚠')
    expect(c.tooltip).toBe('1 个会话正在等待权限确认')
  })

  it('多个 waiting → 数字累加', () => {
    const c = computeStatusBarContent([s('waiting'), s('waiting'), s('waiting'), s('running')])
    expect(c.text).toBe('$(pulse) CTM: 3⚠')
    expect(c.tooltip).toBe('3 个会话正在等待权限确认')
  })
})