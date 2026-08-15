export type NotifyFn = (sessionId: string, toolName: string, cwd: string) => void

export class Notifier {
  private lastNotifiedAt = new Map<string, number>()

  constructor(private readonly dedupeSeconds: number, private readonly fn: NotifyFn) {}

  notify(sessionId: string, toolName: string, cwd: string): void {
    const now = Date.now()
    const last = this.lastNotifiedAt.get(sessionId) ?? 0
    if (now - last < this.dedupeSeconds * 1000) return
    this.lastNotifiedAt.set(sessionId, now)
    this.fn(sessionId, toolName, cwd)
  }

  // 清掉一个 session 的 dedup 记录,防止 Map 永久膨胀
  // 调用时机:SessionStore 在 SessionEnd / removeByPid 删除 session 时
  reset(sessionId: string): void {
    this.lastNotifiedAt.delete(sessionId)
  }
}
