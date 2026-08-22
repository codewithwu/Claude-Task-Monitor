import { describe, it, expect } from 'vitest'
import { reduce } from '../stateManager.js'
import type { SessionState, HookPayload } from '../types.js'

const baseTs = 1700000000

function evt(p: Partial<HookPayload> & Pick<HookPayload, 'hook_event_name' | 'session_id'>): HookPayload {
  return { ts: baseTs, ...p } as HookPayload
}

describe('reduce', () => {
  it('SessionStart 创建 idle 会话', () => {
    const result = reduce(null, evt({
      hook_event_name: 'SessionStart',
      session_id: 'abc',
      cwd: '/p'
    }))
    expect(result.kind).toBe('updated')
    if (result.kind !== 'updated') return
    expect(result.state).toMatchObject({
      sessionId: 'abc',
      cwd: '/p',
      status: 'idle',
      stateChangedAt: baseTs,
      lastUserPrompt: '',
      currentTool: null
    })
  })

  it('UserPromptSubmit 切到 running 并记录 prompt', () => {
    const start = reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' }))
    if (start.kind !== 'updated') throw new Error('expected updated')
    const r = reduce(start.state, evt({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'a',
      user_prompt: '修复登录接口的 token 过期问题',
      ts: baseTs + 5
    }))
    if (r.kind !== 'updated') throw new Error('expected updated')
    expect(r.state.status).toBe('running')
    expect(r.state.stateChangedAt).toBe(baseTs + 5)
    expect(r.state.lastUserPrompt).toBe('修复登录接口的 token 过期问题')
  })

  it('UserPromptSubmit 截断超过 60 字符的 prompt', () => {
    const start = reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' }))
    if (start.kind !== 'updated') throw new Error()
    const long = 'x'.repeat(120)
    const r = reduce(start.state, evt({ hook_event_name: 'UserPromptSubmit', session_id: 'a', user_prompt: long }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.lastUserPrompt.length).toBeLessThanOrEqual(60)
  })

  it('PreToolUse 设置 currentTool 且状态保持 running', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'UserPromptSubmit', session_id: 'a', user_prompt: 'p' })) as any).state
    const r = reduce(s, evt({
      hook_event_name: 'PreToolUse',
      session_id: 'a',
      tool_name: 'Bash',
      tool_input: { command: 'ls' }
    }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('running')
    expect(r.state.currentTool).toEqual({ name: 'Bash', input: { command: 'ls' } })
  })

  it('Notification(permission_prompt) 切到 waiting，保留 currentTool', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'PreToolUse', session_id: 'a', tool_name: 'Bash', tool_input: { command: 'rm' } })) as any).state
    const r = reduce(s, evt({
      hook_event_name: 'Notification',
      session_id: 'a',
      notification_type: 'permission_prompt',
      ts: baseTs + 10
    }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('waiting')
    expect(r.state.stateChangedAt).toBe(baseTs + 10)
    expect(r.state.currentTool).toEqual({ name: 'Bash', input: { command: 'rm' } })
  })

  it('Notification(其他类型) 不改状态', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    const r = reduce(s, evt({
      hook_event_name: 'Notification',
      session_id: 'a',
      notification_type: 'idle_prompt'
    }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('idle')
  })

  it('PostToolUse 清空 currentTool，状态变 running', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'PreToolUse', session_id: 'a', tool_name: 'Bash' })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'Notification', session_id: 'a', notification_type: 'permission_prompt' })) as any).state
    const r = reduce(s, evt({ hook_event_name: 'PostToolUse', session_id: 'a', tool_name: 'Bash' }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('running')
    expect(r.state.currentTool).toBeNull()
  })

  it('Stop 切到 idle 并清空 currentTool', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'PreToolUse', session_id: 'a', tool_name: 'Bash' })) as any).state
    const r = reduce(s, evt({ hook_event_name: 'Stop', session_id: 'a' }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('idle')
    expect(r.state.currentTool).toBeNull()
  })

  it('SessionEnd 返回 removed', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    const r = reduce(s, evt({ hook_event_name: 'SessionEnd', session_id: 'a' }))
    expect(r.kind).toBe('removed')
  })

  it('同状态内重复事件不重置 stateChangedAt', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p', ts: baseTs })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'Notification', session_id: 'a', notification_type: 'permission_prompt', ts: baseTs + 10 })) as any).state
    expect(s.stateChangedAt).toBe(baseTs + 10)
    const r = reduce(s, evt({ hook_event_name: 'Notification', session_id: 'a', notification_type: 'permission_prompt', ts: baseTs + 30 }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.status).toBe('waiting')
    expect(r.state.stateChangedAt).toBe(baseTs + 10)
  })

  it('SessionStart 之前先到事件能用事件的 cwd 推断创建', () => {
    const r = reduce(null, evt({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'x',
      cwd: '/derived',
      user_prompt: 'hi'
    }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.cwd).toBe('/derived')
  })

  it('cwd 完全缺失时用 <unknown>', () => {
    const r = reduce(null, evt({ hook_event_name: 'UserPromptSubmit', session_id: 'x', user_prompt: 'hi' }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.cwd).toBe('<unknown>')
  })

  it('未知 event 类型对已有 session 不破坏状态', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' })) as any).state
    const r = reduce(s, { hook_event_name: 'WeirdEvent' as any, session_id: 'a', ts: baseTs })
    if (r.kind !== 'updated') throw new Error()
    expect(r.state).toEqual(s)
  })

  it('SessionStart 存储事件里的 pid', () => {
    const r = reduce(null, evt({
      hook_event_name: 'SessionStart',
      session_id: 'a',
      cwd: '/p',
      pid: 12345
    }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.pid).toBe(12345)
  })

  it('SessionStart 没有 pid 字段时,state.pid 为 undefined', () => {
    const r = reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p' }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.pid).toBeUndefined()
  })

  it('SessionStart 漏发时,后续带 pid 的事件也能补上 pid', () => {
    const r = reduce(null, evt({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'a',
      cwd: '/p',
      user_prompt: 'hi',
      pid: 99999
    }))
    if (r.kind !== 'updated') throw new Error()
    expect(r.state.pid).toBe(99999)
  })

  it('后续事件的 pid 覆盖之前记录的值', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p', pid: 100 })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'UserPromptSubmit', session_id: 'a', user_prompt: 'p', pid: 200 })) as any).state
    expect(s.pid).toBe(200)
  })

  it('事件没带 pid 时,state.pid 保留之前的值', () => {
    let s: SessionState = (reduce(null, evt({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p', pid: 100 })) as any).state
    s = (reduce(s, evt({ hook_event_name: 'Stop', session_id: 'a' })) as any).state
    expect(s.pid).toBe(100)
  })
})

import { SessionStore } from '../stateManager.js'

describe('SessionStore', () => {
  it('apply SessionStart 后能 list 出该 session', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    const list = store.list()
    expect(list).toHaveLength(1)
    expect(list[0].sessionId).toBe('s1')
  })

  it('apply SessionEnd 后 session 被移除', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    store.apply({ hook_event_name: 'SessionEnd', session_id: 's1', ts: 2 } as any)
    expect(store.list()).toHaveLength(0)
  })

  it('list 按 waiting > running > idle 优先级排序，同色按 stateChangedAt 倒序', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 'idle-old', cwd: '/a', ts: 100 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'running', cwd: '/b', ts: 200 } as any)
    store.apply({ hook_event_name: 'UserPromptSubmit', session_id: 'running', user_prompt: 'p', ts: 250 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'waiting', cwd: '/c', ts: 300 } as any)
    store.apply({ hook_event_name: 'Notification', session_id: 'waiting', notification_type: 'permission_prompt', ts: 350 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'idle-new', cwd: '/d', ts: 400 } as any)
    const ids = store.list().map(s => s.sessionId)
    expect(ids).toEqual(['waiting', 'running', 'idle-new', 'idle-old'])
  })

  it('pinned 会话跨 group 置顶', () => {
    const store = new SessionStore()
    // waiting 在前,idle 在后(STATUS_PRIORITY)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'idle-1', cwd: '/a', ts: 100 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 'waiting-1', cwd: '/b', ts: 200 } as any)
    store.apply({ hook_event_name: 'Notification', session_id: 'waiting-1', notification_type: 'permission_prompt', ts: 250 } as any)
    expect(store.list()[0].sessionId).toBe('waiting-1')
    // pin idle → 应跨 group 置顶
    store.setPinned('idle-1', true)
    expect(store.list()[0].sessionId).toBe('idle-1')
    expect(store.list()[0].pinned).toBe(true)
  })

  it('setPinned 已一致时返回 false,不重复 emit', () => {
    const store = new SessionStore()
    let count = 0
    store.onChange(() => { count++ })
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    expect(count).toBe(1)  // SessionStart 触发一次
    expect(store.setPinned('s1', true)).toBe(true)
    expect(count).toBe(2)  // setPinned 触发一次
    expect(store.setPinned('s1', true)).toBe(false)  // 已 pinned,no-op
    expect(count).toBe(2)  // 没新增
  })

  it('setPinned 不存在的 session 返回 false', () => {
    const store = new SessionStore()
    expect(store.setPinned('never-seen', true)).toBe(false)
  })

  it('updateFileOffset 持久化游标', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    store.updateFileOffset('s1', 512)
    expect(store.get('s1')?.fileOffset).toBe(512)
  })

  it('onChange 回调在 apply 后触发', () => {
    const store = new SessionStore()
    let count = 0
    store.onChange(() => { count++ })
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    expect(count).toBe(1)
  })

  it('offChange 取消订阅,后续 apply 不再触发该 listener (#8)', () => {
    const store = new SessionStore()
    let count = 0
    const listener = () => { count++ }
    store.onChange(listener)
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    expect(count).toBe(1)
    store.offChange(listener)
    store.apply({ hook_event_name: 'SessionStart', session_id: 's2', cwd: '/q', ts: 2 } as any)
    expect(count).toBe(1)  // 未变,listener 已 off
  })

  it('offChange 未注册的 listener 不抛错', () => {
    const store = new SessionStore()
    expect(() => store.offChange(() => {})).not.toThrow()
  })

  it('offChange 只摘除目标 listener,其他 listener 仍生效', () => {
    const store = new SessionStore()
    let a = 0, b = 0
    const listenerA = () => { a++ }
    const listenerB = () => { b++ }
    store.onChange(listenerA)
    store.onChange(listenerB)
    store.offChange(listenerA)
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    expect(a).toBe(0)
    expect(b).toBe(1)
  })

  it('对未知 session 的 SessionEnd 不抛错', () => {
    const store = new SessionStore()
    expect(() => store.apply({ hook_event_name: 'SessionEnd', session_id: 'nope', ts: 1 } as any)).not.toThrow()
  })

  it('removeByPid 移除 pid 匹配的 session,返回 sessionId,触发 onChange', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1, pid: 100 } as any)
    store.apply({ hook_event_name: 'SessionStart', session_id: 's2', cwd: '/q', ts: 1, pid: 200 } as any)
    let count = 0
    store.onChange(() => { count++ })
    const removed = store.removeByPid(100)
    expect(removed).toBe('s1')
    expect(store.list().map(s => s.sessionId)).toEqual(['s2'])
    expect(count).toBe(1)
  })

  it('removeByPid 没匹配时返回 undefined,不触发 onChange', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1, pid: 100 } as any)
    let count = 0
    store.onChange(() => { count++ })
    const removed = store.removeByPid(999)
    expect(removed).toBeUndefined()
    expect(count).toBe(0)
  })

  it('removeByPid 只匹配 pid 字段存在的 session', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 'no-pid', cwd: '/p', ts: 1 } as any)
    expect(store.removeByPid(undefined as any)).toBeUndefined()
    expect(store.list()).toHaveLength(1)
  })
})

describe('SessionStore onSessionRemoved 回调', () => {
  it('SessionEnd 删除已存在 session 时被调用', () => {
    const removed: string[] = []
    const store = new SessionStore((id) => removed.push(id))
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    store.apply({ hook_event_name: 'SessionEnd', session_id: 's1', ts: 2 } as any)
    expect(removed).toEqual(['s1'])
  })

  it('SessionEnd 对未知 session 不回调 (覆盖 chokidar unlink race)', () => {
    const removed: string[] = []
    const store = new SessionStore((id) => removed.push(id))
    store.apply({ hook_event_name: 'SessionEnd', session_id: 'never-existed', ts: 1 } as any)
    expect(removed).toEqual([])
  })

  it('removeByPid 命中时回调', () => {
    const removed: string[] = []
    const store = new SessionStore((id) => removed.push(id))
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1, pid: 100 } as any)
    store.removeByPid(100)
    expect(removed).toEqual(['s1'])
  })

  it('removeByPid 没匹配时既不返回也不回调', () => {
    const removed: string[] = []
    const store = new SessionStore((id) => removed.push(id))
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1, pid: 100 } as any)
    expect(store.removeByPid(999)).toBeUndefined()
    expect(removed).toEqual([])
  })

  it('回调未提供时删除行为不变 (向后兼容)', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/p', ts: 1 } as any)
    expect(() => store.apply({ hook_event_name: 'SessionEnd', session_id: 's1', ts: 2 } as any)).not.toThrow()
    expect(store.list()).toHaveLength(0)
  })
})

describe('SessionStore.apply no-op 短路', () => {
  it('apply(Notification 非 permission_prompt) 不触发 onChange', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p', ts: 1 } as any)
    let count = 0
    store.onChange(() => { count++ })
    store.apply({ hook_event_name: 'Notification', session_id: 'a', notification_type: 'idle_prompt', ts: 2 } as any)
    expect(count).toBe(0)
  })

  it('apply(未知 event type) 不触发 onChange', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p', ts: 1 } as any)
    let count = 0
    store.onChange(() => { count++ })
    store.apply({ hook_event_name: 'WeirdEvent' as any, session_id: 'a', ts: 2 })
    expect(count).toBe(0)
  })

  it('apply(SessionEnd 未知 session) 不触发 onChange', () => {
    const store = new SessionStore()
    let count = 0
    store.onChange(() => { count++ })
    store.apply({ hook_event_name: 'SessionEnd', session_id: 'never-existed', ts: 1 } as any)
    expect(count).toBe(0)
  })

  it('apply(Notification permission_prompt) 仍触发 onChange', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p', ts: 1 } as any)
    let count = 0
    store.onChange(() => { count++ })
    store.apply({ hook_event_name: 'Notification', session_id: 'a', notification_type: 'permission_prompt', ts: 2 } as any)
    expect(count).toBe(1)
  })

  it('apply(SessionStart 创建新 session) 触发 onChange', () => {
    const store = new SessionStore()
    let count = 0
    store.onChange(() => { count++ })
    store.apply({ hook_event_name: 'SessionStart', session_id: 'new', cwd: '/p', ts: 1 } as any)
    expect(count).toBe(1)
  })

  it('apply(SessionEnd 已存在 session) 触发 onChange 一次', () => {
    const store = new SessionStore()
    store.apply({ hook_event_name: 'SessionStart', session_id: 'a', cwd: '/p', ts: 1 } as any)
    let count = 0
    store.onChange(() => { count++ })
    store.apply({ hook_event_name: 'SessionEnd', session_id: 'a', ts: 2 } as any)
    expect(count).toBe(1)
  })
})
