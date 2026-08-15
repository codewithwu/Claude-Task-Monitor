import type { HookPayload, ReduceResult, SessionState, SessionStatus } from './types.js'

const MAX_PROMPT_LEN = 60

function init(sessionId: string, cwd: string, ts: number, pid?: number): SessionState {
  return {
    sessionId,
    cwd,
    status: 'idle',
    stateChangedAt: ts,
    lastUserPrompt: '',
    currentTool: null,
    fileOffset: 0,
    pid
  }
}

function transition(prev: SessionState, next: Partial<SessionState> & { status: SessionStatus }, ts: number): SessionState {
  const changed = next.status !== prev.status
  return {
    ...prev,
    ...next,
    stateChangedAt: changed ? ts : prev.stateChangedAt
  }
}

export function reduce(prev: SessionState | null, event: HookPayload): ReduceResult {
  const ts = event.ts
  const cwd = event.cwd ?? prev?.cwd ?? '<unknown>'
  // 任何带 pid 的事件都更新 session 的 pid(不限于 SessionStart)
  // 第一次收到事件时 init 一次;有 prev 时把 event.pid 合并进去
  const base: SessionState = prev
    ? (event.pid !== undefined && event.pid !== prev.pid
        ? { ...prev, pid: event.pid }
        : prev)
    : init(event.session_id, cwd, ts, event.pid)

  switch (event.hook_event_name) {
    case 'SessionStart':
      return { kind: 'updated', state: { ...init(event.session_id, cwd, ts, event.pid), fileOffset: base.fileOffset, pid: event.pid ?? base.pid } }

    case 'SessionEnd':
      return { kind: 'removed' }

    case 'UserPromptSubmit': {
      const prompt = (event.user_prompt ?? '').slice(0, MAX_PROMPT_LEN)
      return { kind: 'updated', state: transition(base, { status: 'running', lastUserPrompt: prompt }, ts) }
    }

    case 'PreToolUse': {
      const tool = { name: event.tool_name ?? '<unknown>', input: event.tool_input ?? null }
      return { kind: 'updated', state: transition(base, { status: 'running', currentTool: tool }, ts) }
    }

    case 'PostToolUse':
      return { kind: 'updated', state: transition(base, { status: 'running', currentTool: null }, ts) }

    case 'Notification':
      if (event.notification_type === 'permission_prompt') {
        return { kind: 'updated', state: transition(base, { status: 'waiting' }, ts) }
      }
      return { kind: 'updated', state: base }

    case 'Stop':
      return { kind: 'updated', state: transition(base, { status: 'idle', currentTool: null }, ts) }

    default:
      return { kind: 'updated', state: base }
  }
}

const STATUS_PRIORITY: Record<SessionStatus, number> = {
  waiting: 0,
  running: 1,
  idle: 2
}

export class SessionStore {
  private sessions = new Map<string, SessionState>()
  private listeners: Array<() => void> = []

  // 删除 session 时回调(给 Notifier.reset 等用,避免 dedup Map 永久膨胀)
  // 注意:apply(removed) 对未知 session 不回调(prev === null 短路),避免对幽灵 session 误触发
  constructor(private readonly onSessionRemoved?: (sessionId: string) => void) {}

  apply(event: HookPayload): void {
    const prev = this.sessions.get(event.session_id) ?? null
    const result = reduce(prev, event)
    if (result.kind === 'removed') {
      // SessionEnd 对未知/已移除 session:no-op,不打扰订阅者
      // (覆盖 chokidar unlink 跟 pruneDeadSessions 之间的 race)
      if (prev === null) return
      this.sessions.delete(event.session_id)
      this.onSessionRemoved?.(event.session_id)
      this.emit()
    } else if (prev === null || result.state !== prev) {
      // reduce 对 Notification 非 permission_prompt / 未知 event 返回 prev 本身
      // (引用相等 = 真 no-op),这种情况跳过 set 和 emit
      this.sessions.set(event.session_id, result.state)
      this.emit()
    }
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)
  }

  list(): SessionState[] {
    return [...this.sessions.values()].sort((a, b) => {
      const p = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
      if (p !== 0) return p
      return b.stateChangedAt - a.stateChangedAt
    })
  }

  updateFileOffset(sessionId: string, offset: number): void {
    const s = this.sessions.get(sessionId)
    if (s) this.sessions.set(sessionId, { ...s, fileOffset: offset })
  }

  removeByPid(pid: number): string | undefined {
    for (const [id, s] of this.sessions) {
      if (s.pid !== undefined && s.pid === pid) {
        this.sessions.delete(id)
        this.onSessionRemoved?.(id)
        this.emit()
        return id
      }
    }
    return undefined
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}
