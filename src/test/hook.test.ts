import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const HOOK_SCRIPT = path.resolve(__dirname, '..', '..', 'resources', 'hook.sh')
const SESSIONS_DIR = path.join(os.homedir(), '.claude-task-monitor', 'sessions')

function uniqueSessionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

function setSelfComm(comm: string): boolean {
  try {
    fs.writeFileSync(`/proc/${process.pid}/comm`, comm)
    return true
  } catch {
    return false
  }
}

interface CapturedEvent { pid?: number; session_id: string; hook_event_name: string; cwd?: string }

function readCapturedEvent(sessionId: string): CapturedEvent {
  const file = path.join(SESSIONS_DIR, `${sessionId}.jsonl`)
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  return JSON.parse(lines[lines.length - 1]) as CapturedEvent
}

const WRAPPER_SOURCE = `
  const {spawn} = require('child_process');
  const fs = require('fs');
  const payload = JSON.stringify({
    session_id: process.env.SESSION_ID,
    hook_event_name: 'SessionStart',
    cwd: '/tmp/hook-test'
  });
  const c = spawn('bash', [process.env.HOOK_PATH], {stdio: ['pipe', 'inherit', 'inherit']});
  c.on('error', e => console.error('[wrapper] hook spawn error:', e.message));
  c.on('exit', code => process.exit(0));
  c.stdin.write(payload);
  c.stdin.end();
`

function invokeHookViaTransientWrapper(sessionId: string): { child: ReturnType<typeof spawn>; cleanup: () => void } {
  const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.jsonl`)
  try { fs.unlinkSync(sessionFile) } catch {}

  const child = spawn(process.execPath, ['-e', WRAPPER_SOURCE], {
    stdio: 'inherit',
    env: { ...process.env, HOOK_PATH: HOOK_SCRIPT, SESSION_ID: sessionId }
  })

  const cleanup = () => {
    try { child.kill('SIGKILL') } catch {}
    try { fs.unlinkSync(sessionFile) } catch {}
  }
  return { child, cleanup }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

describe('hook.sh PID capture', () => {
  it('祖先进程中有 claude 时,捕获的是 claude PID 而不是 $PPID', async () => {
    if (!setSelfComm('claude')) {
      console.warn('无法修改 /proc/self/comm,跳过该测试(非 Linux)')
      return
    }
    const claudePid = process.pid
    const sessionId = uniqueSessionId('hook-claude-ancestor')
    const { cleanup } = invokeHookViaTransientWrapper(sessionId)

    await sleep(800)
    const file = path.join(SESSIONS_DIR, `${sessionId}.jsonl`)
    if (!fs.existsSync(file)) {
      console.error('Session file not found. SESSIONS_DIR contents:', fs.readdirSync(SESSIONS_DIR))
    }
    const captured = readCapturedEvent(sessionId)
    expect(captured.pid).toBe(claudePid)
    cleanup()
  }, 10000)

  it('祖先进程中没有 claude 时,降级到 $PPID', async () => {
    const sessionId = uniqueSessionId('hook-fallback')
    const { cleanup } = invokeHookViaTransientWrapper(sessionId)

    await sleep(800)
    const file = path.join(SESSIONS_DIR, `${sessionId}.jsonl`)
    if (!fs.existsSync(file)) {
      console.error('Session file not found. SESSIONS_DIR contents:', fs.readdirSync(SESSIONS_DIR))
    }
    const captured = readCapturedEvent(sessionId)
    expect(typeof captured.pid).toBe('number')
    expect(captured.pid).toBeGreaterThan(1)
    cleanup()
  }, 10000)

  it('捕获的 PID 在 5 秒后仍存活 → liveness 不会误杀该 session', async () => {
    if (!setSelfComm('claude')) return
    const sessionId = uniqueSessionId('hook-liveness-keep')
    const { cleanup } = invokeHookViaTransientWrapper(sessionId)

    await sleep(800)
    const captured = readCapturedEvent(sessionId)
    expect(typeof captured.pid).toBe('number')

    // 默认 livenessCheckIntervalMs=5000;等够时间再确认 PID 仍在
    await sleep(5500)
    let stillAlive = false
    try { process.kill(captured.pid!, 0); stillAlive = true } catch { stillAlive = false }
    expect(stillAlive).toBe(true)
    cleanup()
  }, 15000)
})

function invokeHookDirectly(payload: object): ReturnType<typeof spawn> {
  const c = spawn('bash', [HOOK_SCRIPT], { stdio: ['pipe', 'inherit', 'inherit'] })
  c.stdin.write(JSON.stringify(payload))
  c.stdin.end()
  return c
}

describe('hook.sh SessionEnd 归档', () => {
  it('归档文件名包含 PID 后缀,避免同秒撞名', async () => {
    const sessionId = uniqueSessionId('hook-archive')
    const sessionFile = path.join(SESSIONS_DIR, `${sessionId}.jsonl`)
    const endedDir = path.join(SESSIONS_DIR, '.ended')
    try { fs.unlinkSync(sessionFile) } catch {}
    try { fs.readdirSync(endedDir).filter(f => f.startsWith(sessionId)).forEach(f => fs.unlinkSync(path.join(endedDir, f))) } catch {}

    // 先 SessionStart 写 jsonl
    invokeHookDirectly({ session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp/hook-test' })
    await sleep(500)
    expect(fs.existsSync(sessionFile)).toBe(true)

    // 再 SessionEnd 归档
    invokeHookDirectly({ session_id: sessionId, hook_event_name: 'SessionEnd' })
    await sleep(500)

    expect(fs.existsSync(sessionFile)).toBe(false)
    const archived = fs.readdirSync(endedDir).filter(f => f.startsWith(sessionId))
    expect(archived.length).toBe(1)
    // 格式: ${sessionId}-<unix-seconds>-<pid>.jsonl
    expect(archived[0]).toMatch(new RegExp(`^${sessionId}-\\d+-\\d+\\.jsonl$`))
    // 必须比 sessionId 多一段(PID 后缀),否则同秒撞名
    expect(archived[0].split('-').length).toBeGreaterThan(sessionId.split('-').length)

    try { fs.unlinkSync(path.join(endedDir, archived[0])) } catch {}
  }, 10000)
})
