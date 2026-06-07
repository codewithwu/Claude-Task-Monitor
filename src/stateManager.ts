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
