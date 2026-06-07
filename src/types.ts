export type HookEventName =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Notification'
  | 'Stop'

export interface HookPayload {
  hook_event_name: HookEventName
  session_id: string
  ts: number
  cwd?: string
  source?: string                   // SessionStart
  reason?: string                   // Stop / SessionEnd
  user_prompt?: string              // UserPromptSubmit
  tool_name?: string                // Pre/PostToolUse
  tool_input?: unknown              // PreToolUse
  notification_type?: string        // Notification
}

export type SessionStatus = 'idle' | 'running' | 'waiting'

export interface SessionState {
  sessionId: string
  cwd: string
  status: SessionStatus
  stateChangedAt: number            // epoch seconds
  lastUserPrompt: string            // 截断到 60 字符
  currentTool: { name: string; input: unknown } | null
  fileOffset: number                // watcher 增量读取游标
}

export type ReduceResult =
  | { kind: 'updated'; state: SessionState }
  | { kind: 'removed' }              // SessionEnd 返回这个
