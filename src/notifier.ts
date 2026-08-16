// 通知聚合:
//   - N=1:kind='single',沿用旧文案「X 等待权限确认:Y」(兼容性 + 体感不变)
//   - N≥2:kind='aggregate',新文案「N 个会话正在等待:name1, name2, ...」
//   - 维护 currentWaiting 集合,确保状态实时反映(session 进/出 waiting 都更新)
//
// dedupe 窗口:
//   - 按 session 维度独立计时(老逻辑)
//   - dedup 拦截时不弹通知,但 currentWaiting 集合仍要更新(状态必须准)
//   - 进 waiting 时即便弹了一条,出 waiting 时不弹(exit 是静默事件)

export interface WaitingSession {
  sessionId: string
  toolName: string
  cwd: string
}

export type NotifyKind = 'single' | 'aggregate'
export type NotifyFn = (kind: NotifyKind, sessions: WaitingSession[]) => void

export class Notifier {
  private lastNotifiedAt = new Map<string, number>()
  private currentWaiting = new Map<string, WaitingSession>()

  constructor(
    private readonly dedupeSeconds: number,
    private readonly fn: NotifyFn
  ) {}

  // session 进入 waiting。dedup 窗口内重复调用会被拦截,但 currentWaiting 集合仍同步。
  notify(sessionId: string, toolName: string, cwd: string): void {
    const now = Date.now()
    const last = this.lastNotifiedAt.get(sessionId) ?? 0
    const inWindow = now - last < this.dedupeSeconds * 1000

    // 状态永远更新(无论 dedup 是否拦截)
    this.currentWaiting.set(sessionId, { sessionId, toolName, cwd })

    if (inWindow) return

    this.lastNotifiedAt.set(sessionId, now)
    this.fireNotification()
  }

  // session 离开 waiting。静默事件,不发通知。
  exitWaiting(sessionId: string): void {
    this.currentWaiting.delete(sessionId)
  }

  // 同时清 dedup 和 waiting 记录(SessionEnd / removeByPid 时调用,
  // 防止 Map 永久膨胀,避免幽灵 session 干扰聚合)
  reset(sessionId: string): void {
    this.lastNotifiedAt.delete(sessionId)
    this.currentWaiting.delete(sessionId)
  }

  // 供 badge / status bar peek 当前等待集合
  getWaitingSessions(): WaitingSession[] {
    return Array.from(this.currentWaiting.values())
  }

  getWaitingCount(): number {
    return this.currentWaiting.size
  }

  private fireNotification(): void {
    const sessions = Array.from(this.currentWaiting.values())
    if (sessions.length === 0) return
    const kind: NotifyKind = sessions.length === 1 ? 'single' : 'aggregate'
    this.fn(kind, sessions)
  }
}