import { describe, it, expect } from 'vitest'
import { reduce } from '../stateManager'
import type { SessionState, HookPayload } from '../types'

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
})

import { SessionStore } from '../stateManager'

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
