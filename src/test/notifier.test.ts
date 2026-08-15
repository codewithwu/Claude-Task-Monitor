import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Notifier } from '../notifier'

beforeEach(() => {
  vi.useFakeTimers()
})

describe('Notifier', () => {
  it('首次 notify 触发回调', () => {
    const spy = vi.fn()
    const n = new Notifier(30, spy)
    n.notify('s1', 'Bash', '/p')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('s1', 'Bash', '/p')
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
