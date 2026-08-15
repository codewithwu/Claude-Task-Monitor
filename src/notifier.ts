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
}
