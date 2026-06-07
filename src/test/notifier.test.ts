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
})
