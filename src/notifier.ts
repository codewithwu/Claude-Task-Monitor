// 通知聚合:
//   - N=1:kind='single',沿用旧文案「X 等待权限确认:Y」(兼容性 + 体感不变)
//   - N≥2:kind='aggregate',新文案「N 个会话正在等待:name1, name2, ...」
//   - 维护 currentWaiting 集合,确保状态实时反映(session 进/出 waiting 都更新)
//
// dedupe 窗口:
//   - 按 (sessionId, toolName) 维度独立计时 —— 同一 session 连续多个不同工具请求都弹
//     (老逻辑按 sessionId 太激进,只弹第一条,后面吞掉,用户看不到后续工具)
//   - dedup 拦截时不弹通知,但 currentWaiting 集合仍要更新(状态必须准)
//   - 进 waiting 时即便弹了一条,出 waiting 时不弹(exit 是静默事件)
//
// mute:
//   - notify 接受 muted 参数;若 true,跳过弹通知,但 currentWaiting 仍同步
//     (status bar / badge 仍反映 waiting,只有系统通知 toast 被静音)

export interface WaitingSession {
  sessionId: string
  toolName: string
  cwd: string
}

export type NotifyKind = 'single' | 'aggregate'
export type NotifyFn = (kind: NotifyKind, sessions: WaitingSession[]) => void

// dedupe key 编码:sessionId + toolName 用 NUL 拼接 —— 避免冒号出现在
// sessionId 里的边界情况。
function dedupeKey(sessionId: string, toolName: string): string {
  return `${sessionId}\0${toolName}`
}

export class Notifier {
  private lastNotifiedAt = new Map<string, number>()
  private currentWaiting = new Map<string, WaitingSession>()

  constructor(
    private readonly dedupeSeconds: number,
    private readonly fn: NotifyFn
  ) {}

  // session 进入 waiting。
  //   muted=true:跳过弹通知,但 currentWaiting 仍同步(status bar/badge 反映状态)
  //   muted=false: 按 (sessionId, toolName) dedupe;窗口内重复调用拦截
  notify(sessionId: string, toolName: string, cwd: string, muted: boolean = false): void {
    const now = Date.now()
    const key = dedupeKey(sessionId, toolName)
    const last = this.lastNotifiedAt.get(key) ?? 0
    const inWindow = now - last < this.dedupeSeconds * 1000

    // 状态永远更新(无论 dedup / mute 是否拦截)
    this.currentWaiting.set(sessionId, { sessionId, toolName, cwd })

    if (muted) return
    if (inWindow) return

    this.lastNotifiedAt.set(key, now)
    this.fireNotification()
  }

  // session 离开 waiting。静默事件,不发通知。
  exitWaiting(sessionId: string): void {
    this.currentWaiting.delete(sessionId)
  }

  // 同时清 dedup 和 waiting 记录(SessionEnd / removeByPid 时调用,
  // 防止 Map 永久膨胀,避免幽灵 session 干扰聚合)
  reset(sessionId: string): void {
    this.currentWaiting.delete(sessionId)
    // 仅清除该 session 的 dedupe keys(同 session 可能有多个 toolName 记录)
    const prefix = `${sessionId}\0`
    for (const key of this.lastNotifiedAt.keys()) {
      if (key.startsWith(prefix)) this.lastNotifiedAt.delete(key)
    }
  }

  // 供 badge / status bar peek 当前等待集合
  getWaitingSessions(): WaitingSession[] {
    return Array.from(this.currentWaiting.values())
  }

  getWaitingCount(): number {
    return this.currentWaiting.size
  }

  private fireNotification(): void {
    // notify() 在 fire 前必然先 set currentWaiting,所以 sessions 不可能为空。
    const sessions = Array.from(this.currentWaiting.values())
    const kind: NotifyKind = sessions.length === 1 ? 'single' : 'aggregate'
    this.fn(kind, sessions)
  }
}