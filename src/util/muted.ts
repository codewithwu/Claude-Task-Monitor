// per-session 静音持久化:
//   - 文件 ~/.claude-task-monitor/muted.json 存 { sessionId: true }
//   - 进程启动时 load,setMuted 时 persist
//   - 写入失败不抛错(避免 toast 风暴),只 console.warn
//
// 设计选择:用独立 JSON 文件而不是写入 .jsonl 元数据行,避开改 hook.sh +
// HookPayload 类型 + store.apply 多分支识别 —— 文件方案独立、低耦合。
// 代价是 mute 状态跟 session id 绑定,如果 session id 重新分配(罕见),
// mute 状态不会自动跟随。

import * as fs from 'node:fs'
import * as path from 'node:path'
import { formatErrorMessage } from './formatError.js'

export class MutedStore {
  private map = new Map<string, boolean>()

  constructor(private readonly filePath: string) {
    this.load()
  }

  isMuted(sessionId: string): boolean {
    return this.map.get(sessionId) === true
  }

  setMuted(sessionId: string, muted: boolean): void {
    if (muted) {
      if (this.map.get(sessionId) === true) return  // already muted, no-op
      this.map.set(sessionId, true)
    } else {
      if (!this.map.has(sessionId)) return  // already unmuted, no-op
      this.map.delete(sessionId)
    }
    this.persist()
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const obj: unknown = JSON.parse(raw)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (v === true) this.map.set(k, true)
        }
      }
    } catch (e) {
      console.warn(`[claude-task-monitor] muted.json load failed: ${formatErrorMessage(e)}`)
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const obj: Record<string, true> = {}
      for (const [k, v] of this.map) {
        if (v) obj[k] = true
      }
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2))
    } catch (e) {
      console.warn(`[claude-task-monitor] muted.json persist failed: ${formatErrorMessage(e)}`)
    }
  }
}