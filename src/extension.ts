import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SessionsWatcher } from './watcher'
import { SessionStore } from './stateManager'
import { SessionTreeDataProvider } from './treeDataProvider'
import { Notifier } from './notifier'
import {
  writeHookScript,
  mergeSettings,
  uninstallSettings,
  detectJq,
  OWNER_TAG
} from './installer'
import type { HookPayload } from './types'

const HOME_DIR = os.homedir()
const ROOT_DIR = path.join(HOME_DIR, '.claude-task-monitor')
const SESSIONS_DIR = path.join(ROOT_DIR, 'sessions')
const ENDED_DIR = path.join(SESSIONS_DIR, '.ended')
const HOOK_SCRIPT = path.join(ROOT_DIR, 'hook.sh')
const CLAUDE_SETTINGS = path.join(HOME_DIR, '.claude', 'settings.json')

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('claudeTaskMonitor')
  const staleHours = cfg.get<number>('staleHours', 24)
  const dedupeSeconds = cfg.get<number>('notifyDedupeSeconds', 30)
  const refreshMs = cfg.get<number>('refreshIntervalMs', 1000)
  const livenessMs = cfg.get<number>('livenessCheckIntervalMs', 5000)

  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  fs.mkdirSync(ENDED_DIR, { recursive: true })

  const hasJq = await detectJq()
  if (!hasJq) {
    void vscode.window.showErrorMessage(
      'Claude Task Monitor: `jq` 未在 PATH 中找到。请安装：macOS `brew install jq`，Debian/Ubuntu `apt install jq`。'
    )
  }

  try {
    const resourceHook = path.join(context.extensionPath, 'resources', 'hook.sh')
    writeHookScript(resourceHook, HOOK_SCRIPT)
  } catch (e) {
    void vscode.window.showErrorMessage(`Claude Task Monitor: 写 hook.sh 失败：${(e as Error).message}`)
  }

  try {
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true })
    const existingRaw = fs.existsSync(CLAUDE_SETTINGS) ? fs.readFileSync(CLAUDE_SETTINGS, 'utf8') : '{}'
    const existing = JSON.parse(existingRaw)
    const merged = mergeSettings(existing, HOOK_SCRIPT)
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(merged, null, 2))
  } catch (e) {
    void vscode.window.showErrorMessage(`Claude Task Monitor: 合并 ~/.claude/settings.json 失败：${(e as Error).message}`)
  }

  archiveStaleFiles(SESSIONS_DIR, ENDED_DIR, staleHours)

  const store = new SessionStore()
  const watcher = new SessionsWatcher(SESSIONS_DIR)
  const notifier = new Notifier(dedupeSeconds, (sessionId, toolName, cwd) => {
    const name = path.basename(cwd) || cwd
    const msg = `${name} 等待权限确认：${toolName}`
    void vscode.window.showWarningMessage(msg, '打开项目').then(action => {
      if (action === '打开项目') {
        void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(cwd), { forceNewWindow: false })
      }
    })
  })

  bootstrapExistingFiles(SESSIONS_DIR, watcher, store)

  watcher.on('fileAdded', (file) => {
    // 真正的事件回放靠 line 事件; 这里仅占位
  })
  watcher.on('line', (file, parsedUnknown) => {
    const parsed = parsedUnknown as HookPayload
    const prevStatus = store.get(parsed.session_id)?.status
    store.apply(parsed)
    const next = store.get(parsed.session_id)
    if (next && next.status === 'waiting' && prevStatus !== 'waiting') {
      notifier.notify(next.sessionId, next.currentTool?.name ?? '<unknown>', next.cwd)
    }
  })
  watcher.on('fileRemoved', (file) => {
    const sessionId = path.basename(file, '.jsonl')
    store.apply({ hook_event_name: 'SessionEnd', session_id: sessionId, ts: Math.floor(Date.now() / 1000) } as HookPayload)
  })
  watcher.on('parseError', (msg, file, line) => {
    console.warn(`[claude-task-monitor] parse error in ${file}: ${msg}`)
  })

  try {
    await watcher.start()
  } catch (e) {
    void vscode.window.showErrorMessage(`Claude Task Monitor: 启动 watcher 失败：${(e as Error).message}`)
    return
  }

  const provider = new SessionTreeDataProvider(store)
  const treeView = vscode.window.createTreeView('claudeTaskMonitor.sessionsView', {
    treeDataProvider: provider,
    showCollapseAll: false
  })
  const tick = setInterval(() => provider.refresh(), refreshMs)
  const livenessTick = setInterval(() => pruneDeadSessions(store), livenessMs)

  context.subscriptions.push(
    treeView,
    { dispose: () => clearInterval(tick) },
    { dispose: () => clearInterval(livenessTick) },
    { dispose: () => void watcher.close() }
  )
}

export async function deactivate(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    'Claude Task Monitor 卸载：是否同时移除已注入的 hooks 与 hook.sh？',
    '是', '否'
  )
  if (choice !== '是') return
  try {
    if (fs.existsSync(CLAUDE_SETTINGS)) {
      const existing = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
      const cleaned = uninstallSettings(existing)
      fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(cleaned, null, 2))
    }
    if (fs.existsSync(HOOK_SCRIPT)) fs.unlinkSync(HOOK_SCRIPT)
  } catch (e) {
    console.warn('[claude-task-monitor] uninstall failed:', e)
  }
}

function archiveStaleFiles(sessionsDir: string, endedDir: string, staleHours: number): void {
  const cutoffMs = Date.now() - staleHours * 3600 * 1000
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!name.endsWith('.jsonl')) continue
    const full = path.join(sessionsDir, name)
    try {
      const stat = fs.statSync(full)
      if (stat.mtimeMs < cutoffMs) {
        fs.mkdirSync(endedDir, { recursive: true })
        fs.renameSync(full, path.join(endedDir, `${path.basename(name, '.jsonl')}-${Date.now()}.jsonl`))
      }
    } catch {
      // 忽略
    }
  }
}

function bootstrapExistingFiles(sessionsDir: string, watcher: SessionsWatcher, store: SessionStore): void {
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!name.endsWith('.jsonl')) continue
    const full = path.join(sessionsDir, name)
    try {
      const content = fs.readFileSync(full, 'utf8')
      for (const line of content.split('\n')) {
        if (!line) continue
        try {
          store.apply(JSON.parse(line) as HookPayload)
        } catch {
          // 跳过损坏行
        }
      }
      watcher.setOffset(full, Buffer.byteLength(content, 'utf8'))
    } catch {
      // 跳过
    }
  }
}

function pruneDeadSessions(store: SessionStore): void {
  for (const s of store.list()) {
    if (s.pid === undefined) continue
    try {
      process.kill(s.pid, 0)
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ESRCH') {
        store.removeByPid(s.pid)
      }
    }
  }
}
