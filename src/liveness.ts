import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { SessionStore } from './stateManager'

// 判定进程是否已不可用:
//   1. 不存在 (ESRCH)
//   2. 存在但被挂起 (T/t)
//   3. 僵尸 (Z) / 已死 (X)
// 存在 + R/S/D 一律视作活
//
// 平台路由:
//   - Linux (含 WSL guest): /proc/${pid}/status 优先,/proc 读不到再降级 ps
//   - macOS: ps 即可 (/proc 不存在)
//   - Windows: wsl.exe ps 优先 (能查 WSL2 的 Linux PID),失败再降级 tasklist
export function isProcessGone(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false

  if (process.platform === 'linux') {
    return checkViaProc(pid) || checkViaPsFallback(pid)
  }
  if (process.platform === 'darwin') {
    return checkViaPsFallback(pid)
  }
  // win32: WSL2 PID 走 wsl.exe,纯 Windows 进程走 tasklist
  return checkViaWslOrTasklist(pid)
}

// Linux/WSL guest: process.kill(pid, 0) 检测 ESRCH;成功则读 /proc 解析 State
// /proc State 行的格式: `State:\t<T/t/Z/X/...> (<human readable>)`
// human readable 可能是单词 (running/sleeping/stopped/zombie/dead) 也可能是多词 (tracing stop),
// 所以只取 state code 首字母判断,跟 ps -o stat= 对齐
function checkViaProc(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ESRCH') return true
    // EPERM: 进程存在但无权访问,视为活
    return false
  }

  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
    const m = status.match(/^State:\s+(\S)/m)
    if (m) {
      const c = m[1]
      return c === 'T' || c === 't' || c === 'Z' || c === 'X'
    }
    return false
  } catch {
    // /proc 不可读 (容器/PID 命名空间受限) → 让调用方降级 ps
    return false
  }
}

// 跨平台兜底:用 ps 取 stat 列。失败一律视为「无法验证 → 活」,不误杀
function checkViaPsFallback(pid: number): boolean {
  try {
    const out = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1000
    }).trim()
    if (!out) return true
    const c = out[0]
    return c === 'T' || c === 't' || c === 'Z' || c === 'X'
  } catch {
    return false
  }
}

// Windows: wsl.exe ps 能查 WSL2 的 Linux PID (这是 host Windows 唯一能看到的方法),
// tasklist 只能查 native Windows 进程。先 wsl 再 tasklist,都不行返回 false
function checkViaWslOrTasklist(pid: number): boolean {
  try {
    const out = execFileSync('wsl.exe', ['ps', '-p', String(pid), '-o', 'stat='], {
      encoding: 'utf8',
      timeout: 1000
    }).trim()
    if (out) {
      const c = out[0]
      return c === 'T' || c === 't' || c === 'Z' || c === 'X'
    }
  } catch {
    // wsl.exe 不在 PATH 或调用失败 (没有 WSL / WSL 关闭 / PID 不在 WSL 中),降级 tasklist
  }

  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
      encoding: 'utf8',
      timeout: 1000
    })
    if (out.includes('INFO: No tasks')) return true
    // 有 CSV 行 → 找到了 PID → alive;其他情况(空输出等)保守视为 alive
    return false
  } catch {
    return false
  }
}

// 跟 hook.sh 在 SessionEnd 时的归档行为保持一致:把 .jsonl 移进 .ended/
// 这样 watcher 看到 unlink 会派发 fileRemoved,store 自然被清
export function pruneDeadSessions(store: SessionStore, sessionsDir: string): { removed: number; archived: string[] } {
  const archived: string[] = []
  let removed = 0
  const endedDir = path.join(sessionsDir, '.ended')
  // 提到循环外:路径在 tick 之间不会变,recursive:true 已经幂等但避免 N 次 stat
  fs.mkdirSync(endedDir, { recursive: true })

  for (const s of store.list()) {
    if (s.pid === undefined) continue
    if (!isProcessGone(s.pid)) continue
    const sessionFile = path.join(sessionsDir, `${s.sessionId}.jsonl`)
    try {
      if (fs.existsSync(sessionFile)) {
        // randomUUID 切片保证同 tick 内多次归档也不撞名 (Date.now() 相同)
        const target = path.join(endedDir, `${s.sessionId}-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`)
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