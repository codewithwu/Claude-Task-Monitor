import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Notifier } from '../notifier.js'

beforeEach(() => {
  vi.useFakeTimers()
})

describe('Notifier', () => {
  it('首次 notify 触发回调 (单条)', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('single', [{ sessionId: 's1', toolName: 'Bash', cwd: '/p' }])
  })

  it('dedupe 窗口内重复 notify 不触发', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    vi.advanceTimersByTime(10_000)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('dedupe 窗口外再次触发', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    vi.advanceTimersByTime(31_000)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('不同 session 的 dedupe 互不影响', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    n.notify('s2', 'Edit', '/q')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('reset 清除指定 session 的 dedup 记录,后续 notify 视为首次', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(1)
    // 不 reset:dedup 窗口内再次 notify 不触发
    vi.advanceTimersByTime(1000)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(1)
    // reset 后:下一条 notify 视为首次
    n.reset('s1')
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('reset 未记录的 sessionId 不抛错', () => {
    const n = new Notifier(30, vi.fn())
    expect(() => n.reset('never-notified')).not.toThrow()
  })

  it('reset 只清目标 session,其他 session 的 dedup 不受影响', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    n.notify('s2', 'Edit', '/q')
    n.reset('s1')
    n.notify('s1', 'Bash', '/p')
    n.notify('s2', 'Edit', '/q')
    expect(spy).toHaveBeenCalledTimes(3)  // s1 首次 + s2 首次 + s1 reset 后首次
  })
})

describe('Notifier aggregate behavior', () => {
  it('单个 session waiting → kind=single', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('single', [{ sessionId: 's1', toolName: 'Bash', cwd: '/p' }])
  })

  it('两个 session 相继 waiting → 第二条 kind=aggregate', () => {
    const spy = vi.fn()
    const n = new Notifier(0, spy)  // dedup=0 避免聚合被窗口拦截
    n.notify('s1', 'Bash', '/p')
    n.notify('s2', 'Edit', '/q')
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenNthCalledWith(1, 'single', [{ sessionId: 's1', toolName: 'Bash', cwd: '/p' }])
    expect(spy).toHaveBeenNthCalledWith(2, 'aggregate', expect.arrayContaining([
      { sessionId: 's1', toolName: 'Bash', cwd: '/p' },
      { sessionId: 's2', toolName: 'Edit', cwd: '/q' }
    ]))
    expect(spy.mock.calls[1][1]).toHaveLength(2)
  })

  it('dedup 拦截时不弹通知,但 currentWaiting 集合仍同步', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(1)
    // dedup 窗口内,s1 + 同 toolName 再次 notify 不弹通知
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(1)
    // 但 currentWaiting 应仍同步(同 session 同 tool 仍记录)
    expect(n.getWaitingSessions()).toHaveLength(1)
    // 关键变更:同 session 不同 toolName 视为新事件,会触发新通知
    // (修复老版本连续 tool 请求只弹第一条的 bug)
    n.notify('s1', 'Edit', '/p')
    expect(spy).toHaveBeenCalledTimes(2)
    expect(n.getWaitingSessions()[0].toolName).toBe('Edit')
  })

  it('exitWaiting 移除 session,下次进 waiting 视作首次 (同 session 不同 tool)', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(1)
    n.exitWaiting('s1')
    expect(n.getWaitingSessions()).toHaveLength(0)
    // 注意:exitWaiting 不清 dedup,但同 session 不同 toolName 是新 dedupe key —— 视作首次
    n.notify('s1', 'Edit', '/p')
    expect(spy).toHaveBeenCalledTimes(2)  // Edit 是新 key,弹通知
    expect(n.getWaitingSessions()).toHaveLength(1)
  })

  it('reset 同时清 dedup 和 waiting 记录', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    n.reset('s1')
    expect(n.getWaitingSessions()).toHaveLength(0)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(2)  // reset 后视作首次
  })

  it('getWaitingCount 反映当前 waiting 数', () => {
    const n = new Notifier(0, vi.fn())
    expect(n.getWaitingCount()).toBe(0)
    n.notify('s1', 'Bash', '/p')
    expect(n.getWaitingCount()).toBe(1)
    n.notify('s2', 'Edit', '/q')
    expect(n.getWaitingCount()).toBe(2)
    n.exitWaiting('s1')
    expect(n.getWaitingCount()).toBe(1)
  })

  it('muted=true 时跳过弹通知,但 currentWaiting 仍同步 (status bar/badge 不丢)', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p', true)  // muted
    expect(spy).toHaveBeenCalledTimes(0)
    expect(n.getWaitingSessions()).toHaveLength(1)
    expect(n.getWaitingCount()).toBe(1)
  })

  it('muted=true 不阻止后续 unmute session 的弹通知 (muted 是 session 维度)', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p', true)  // muted, 不弹
    n.notify('s2', 'Edit', '/q', false)  // 未 muted, 弹
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('muted=true 不写 dedup 记录;后续 unmute 通知视为首次 (避免 mute 期间累积窗口)', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p', true)        // muted, 不弹 + 不写 dedup
    vi.advanceTimersByTime(10_000)
    n.notify('s1', 'Bash', '/p', true)        // 仍 muted
    n.notify('s1', 'Bash', '/p', false)       // unmute, 视为首次
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
