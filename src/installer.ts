import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'

export function writeHookScript(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const content = fs.readFileSync(sourcePath, 'utf8')
  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, 'utf8')
    if (existing === content) {
      fs.chmodSync(targetPath, 0o755)
      return
    }
  }
  fs.writeFileSync(targetPath, content, { mode: 0o755 })
}

export const OWNER_TAG = 'claude-task-monitor'

// hook 事件单一来源:类型 + matcher 是否必填都从这里读。
// ALL_HOOK_EVENTS / HOOK_EVENTS_WITH_MATCHER / HookEventName 之前三处
// 分别维护,加新事件容易漏改一处。
export const ALL_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop'
] as const

export type HookEventName = (typeof ALL_HOOK_EVENTS)[number]

const HOOK_EVENTS_WITH_MATCHER = new Set<HookEventName>(['PreToolUse', 'PostToolUse'])

interface HookEntry {
  matcher?: string
  hooks: Array<{ type: string; command: string }>
  _owner?: string
}

export interface Settings {
  hooks?: Record<string, HookEntry[]>
  [k: string]: unknown
}

function ourEntry(event: HookEventName, command: string): HookEntry {
  const entry: HookEntry = {
    hooks: [{ type: 'command', command }],
    _owner: OWNER_TAG
  }
  if (HOOK_EVENTS_WITH_MATCHER.has(event)) entry.matcher = '*'
  return entry
}

export function mergeSettings(existing: Settings, command: string): Settings {
  const result: Settings = { ...existing, hooks: { ...(existing.hooks ?? {}) } }
  for (const event of ALL_HOOK_EVENTS) {
    const current = result.hooks![event] ?? []
    const hasOurs = current.some(e => e._owner === OWNER_TAG)
    if (hasOurs) {
      result.hooks![event] = current
    } else {
      result.hooks![event] = [...current, ourEntry(event, command)]
    }
  }
  return result
}

export function uninstallSettings(existing: Settings): Settings {
  if (!existing.hooks) return existing
  const newHooks: Record<string, HookEntry[]> = {}
  for (const [event, entries] of Object.entries(existing.hooks)) {
    const filtered = entries.filter(e => e._owner !== OWNER_TAG)
    if (filtered.length > 0) newHooks[event] = filtered
  }
  const result: Settings = { ...existing }
  if (Object.keys(newHooks).length === 0) {
    delete result.hooks
  } else {
    result.hooks = newHooks
  }
  return result
}

export function detectJq(): Promise<boolean> {
  return new Promise(resolve => {
    const proc = spawn('jq', ['--version'])
    proc.on('error', () => resolve(false))
    proc.on('exit', code => resolve(code === 0))
  })
}

// 按当前 process.platform 返回对应的 jq 安装命令。
// 用于 onboarding 缺失分支 / treeView banner 的"复制安装命令"按钮。
// 注意:Linux 这里只覆盖 apt 系(Debian/Ubuntu),其他发行版需用户自行替换;
// macOS / Windows 用户按此命令装好即可。
const JQ_INSTALL_CMDS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'brew install jq',
  linux: 'sudo apt install jq',
  win32: 'winget install jqlang.jq'
}

export function getJqInstallCommand(): string {
  return JQ_INSTALL_CMDS[process.platform] ?? 'brew install jq'
}