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
  pid?: number                      // SessionStart: 注入的 $PPID,用于活性检测
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
  pid?: number                      // CLI 进程 PID;通过 process.kill(pid, 0) 活性检测
  muted?: boolean                   // 用户右键静音(持久化在 ~/.claude-task-monitor/muted.json)
  pinned?: boolean                  // 用户右键 pin (会话级,内存;session 结束清空)
  dyingAt?: number                  // liveness 检测到进程死亡,标记 2s 延迟移除 (epoch seconds)
}

export type ReduceResult =
  | { kind: 'updated'; state: SessionState }
  | { kind: 'removed' }              // SessionEnd 返回这个

// TreeView 嵌套分组的 group 节点 (Waiting/Running/Idle 各自一个 group)。
// 用 class 而非 plain object,便于 treeDataProvider 用 'instanceof' 判别。
// 空组(对应 status 没有 session)由 caller 在 getChildren 阶段过滤掉 ——
// 不渲染空 group,避免视觉噪音。
export class SessionGroup {
  constructor(public readonly status: SessionStatus) {}
}

// TreeElement 是 treeDataProvider 的泛型:group 和 session 都是合法元素。
export type TreeElement = SessionState | SessionGroup

// 视图过滤模式:workspaceState 持久化,跨重启保留。
export type FilterMode = 'all' | 'waiting' | 'running' | 'idle'

export const FILTER_MODES: readonly FilterMode[] = ['all', 'waiting', 'running', 'idle'] as const

export function isFilterMode(s: string): s is FilterMode {
  return (FILTER_MODES as readonly string[]).includes(s)
}
