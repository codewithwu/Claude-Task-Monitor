import type { HookPayload, ReduceResult, SessionState, SessionStatus } from './types'

const MAX_PROMPT_LEN = 60

function init(sessionId: string, cwd: string, ts: number): SessionState {
  return {
    sessionId,
    cwd,
    status: 'idle',
    stateChangedAt: ts,
    lastUserPrompt: '',
    currentTool: null,
    fileOffset: 0
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
  const base = prev ?? init(event.session_id, cwd, ts)

  switch (event.hook_event_name) {
    case 'SessionStart':
      return { kind: 'updated', state: { ...init(event.session_id, cwd, ts), fileOffset: base.fileOffset } }

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

  apply(event: HookPayload): void {
    const prev = this.sessions.get(event.session_id) ?? null
    const result = reduce(prev, event)
    if (result.kind === 'removed') {
      this.sessions.delete(event.session_id)
    } else {
      this.sessions.set(event.session_id, result.state)
    }
    this.emit()
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

  onChange(fn: () => void): void {
    this.listeners.push(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}
