// 归档 (archive) 文件名 + 目录的单一来源:
//
//   .ended/<sessionId>-<epochMs>-<uuid8>.jsonl
//
// 三处共用:liveness.ts pruneDeadSessions、extension.ts archiveSessionNow /
// archiveStaleFiles。randomUUID 切片保证同一 tick 内多次归档也不撞名
// (Date.now() 可能相同)。
import { randomUUID } from 'node:crypto'

// chokidar ignored + liveness prune + extension stale archive 全用这个目录名
export const ENDED_DIR_NAME = '.ended'

export function archiveFileName(sessionId: string): string {
  return `${sessionId}-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`
}