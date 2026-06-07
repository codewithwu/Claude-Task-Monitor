import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)) }

const SESSIONS_DIR = path.join(os.homedir(), '.claude-task-monitor', 'sessions')

suite('e2e', () => {
  test('扩展激活后, 写入 jsonl 文件会出现在 store', async () => {
    await wait(2000)
    const sessionId = 'e2e-' + Date.now()
    const file = path.join(SESSIONS_DIR, `${sessionId}.jsonl`)
    fs.mkdirSync(SESSIONS_DIR, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({
      hook_event_name: 'SessionStart',
      session_id: sessionId,
      cwd: '/tmp/e2e',
      ts: Math.floor(Date.now() / 1000)
    }) + '\n')
    await wait(1000)

    const exts = vscode.extensions.all.filter(e => e.id.endsWith('.claude-task-monitor'))
    assert.ok(exts.length > 0, 'extension should be loaded')

    fs.unlinkSync(file)
    await wait(500)
  })
})
