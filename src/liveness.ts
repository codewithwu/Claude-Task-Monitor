import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import type { SessionStore } from './stateManager'

// 判定进程是否已不可用:
//   1. 不存在 (ESRCH)
//   2. 存在但被挂起 (T/t)
//   3. 僵尸 (Z) / 已死 (X)
// 存在 + R/S/D 一律视作活
export function isProcessGone(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ESRCH') return true
    if (err.code === 'EPERM') return false
    return false
  }

  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
    const m = status.match(/^State:\s+\S+\s+\((\w+)\)/m)
    if (m) {
      const state = m[1]
      return state === 'stopped' || state === 'tracing_stop' || state === 'zombie' || state === 'dead'
    }
    return false
  } catch {
    // 非 Linux:降级到 ps
    try {
      const out = execSync(`ps -o stat= -p ${pid}`, { encoding: 'utf8', timeout: 1000 }).trim()
      if (!out) return true
      const c = out[0]
      return c === 'T' || c === 'Z' || c === 'X'
    } catch {
      return false
    }
  }
}

export function pruneDeadSessions(store: SessionStore, sessionsDir: string): { removed: number; archived: string[] } {
  const archived: string[] = []
  let removed = 0
  for (const s of store.list()) {
    if (s.pid === undefined) continue
    if (!isProcessGone(s.pid)) continue
    // 跟 hook.sh 在 SessionEnd 时的归档行为保持一致:把 .jsonl 移进 .ended/
    // 这样 watcher 看到 unlink 会派发 fileRemoved,store 自然被清
    const sessionFile = path.join(sessionsDir, `${s.sessionId}.jsonl`)
    const endedDir = path.join(sessionsDir, '.ended')
    try {
      if (fs.existsSync(sessionFile)) {
        fs.mkdirSync(endedDir, { recursive: true })
        const target = path.join(endedDir, `${s.sessionId}-${Date.now()}.jsonl`)
        fs.renameSync(sessionFile, target)
        archived.push(target)
      }
    } catch {
      // 归档失败也照样从 store 移除,避免死循环
    }
    store.removeByPid(s.pid)
    removed++
  }
  return { removed, archived }
}
