import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { SessionsWatcher } from './watcher.js'
import { SessionStore } from './stateManager.js'
import { SessionTreeDataProvider } from './treeDataProvider.js'
import { Notifier } from './notifier.js'
import { pruneDeadSessions } from './liveness.js'
import {
  writeHookScript,
  mergeSettings,
  uninstallSettings,
  detectJq,
  getJqInstallCommand,
  OWNER_TAG
} from './installer.js'
import type { HookPayload } from './types.js'
import type { SessionState, FilterMode } from './types.js'
import { FILTER_MODES, isFilterMode } from './types.js'
import { StatusBar, FOCUS_SESSIONS_VIEW_COMMAND } from './ui/statusBar.js'
import { maybeShowOnboarding, showOnboardingCards } from './ui/onboarding.js'
import { MutedStore } from './util/muted.js'
import { t } from './i18n/index.js'
import { applyBadge } from './ui/badge.js'
import { formatSingleMessage, formatAggregateMessage } from './util/notifyMessage.js'

const HOME_DIR = os.homedir()
const ROOT_DIR = path.join(HOME_DIR, '.claude-task-monitor')
const SESSIONS_DIR = path.join(ROOT_DIR, 'sessions')
const ENDED_DIR = path.join(SESSIONS_DIR, '.ended')
const HOOK_SCRIPT = path.join(ROOT_DIR, 'hook.sh')
const MUTED_FILE = path.join(ROOT_DIR, 'muted.json')
const CLAUDE_SETTINGS = path.join(HOME_DIR, '.claude', 'settings.json')

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('claudeTaskMonitor')
  const staleHours = cfg.get<number>('staleHours', 24)
  const dedupeSeconds = cfg.get<number>('notifyDedupeSeconds', 30)
  const refreshMs = cfg.get<number>('refreshIntervalMs', 1000)
  const livenessMs = cfg.get<number>('livenessCheckIntervalMs', 5000)
  const aggregateMode = cfg.get<'perSession' | 'aggregate' | 'silent'>('notifyAggregateMode', 'aggregate')

  // 通知模式:优先读新配置 notifyMode,fallback 到旧 notifyAggregateMode(perSession→all)。
  // 旧配置保留是为了不破坏既有用户的设置。
  type NotifyMode = 'all' | 'aggregate' | 'silent'
  const newMode = cfg.get<string>('notifyMode', '')
  let notifyMode: NotifyMode
  if (newMode === 'all' || newMode === 'aggregate' || newMode === 'silent') {
    notifyMode = newMode
  } else if (aggregateMode === 'perSession') {
    notifyMode = 'all'
  } else if (aggregateMode === 'silent') {
    notifyMode = 'silent'
  } else {
    notifyMode = 'aggregate'
  }

  // 视图过滤模式:workspaceState 持久化 (vs globalState — workspace 重置时跟着清),
  // 首次激活读 cfg.defaultFilter 作 fallback。filter 变化通过 treeDataProvider.getFilter() 闭包读取,
  // 不重建 provider —— 跟 store.onChange 走同一 refresh 路径。
  const FILTER_KEY = 'ctm.filter'
  const cfgDefaultFilter = cfg.get<string>('defaultFilter', 'all')
  const initialFilter: FilterMode = isFilterMode(cfgDefaultFilter) ? cfgDefaultFilter : 'all'
  const savedFilter = context.workspaceState.get<string>(FILTER_KEY, initialFilter)
  const currentFilter: FilterMode = isFilterMode(savedFilter) ? savedFilter : initialFilter
  let activeFilter: FilterMode = currentFilter

  // 长等阈值 (waiting 行 icon 升级为 alert 的临界值)。从 cfg 读,默认 300 秒。
  // 注入到 treeDataProvider,每行 render 时用最新值 —— cfg 修改无需重启。
  const longWaitingThresholdSec = cfg.get<number>('longWaitingThresholdSec', 300)

  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  fs.mkdirSync(ENDED_DIR, { recursive: true })

  const hasJq = await detectJq()
  if (!hasJq) {
    // 没装 jq 时不要尝试写 hook.sh + settings.json:
    // hook.sh 第一行就是 `jq -r '.session_id // empty'`,没 jq 直接 exit,
    // 用户看不到任何 session 还要被「hook 已安装」误导。
    // onboarding 弹窗会引导用户装 jq 并提供复制命令。
    void vscode.window.showErrorMessage(
      'Claude Task Monitor: `jq` 未在 PATH 中找到。请先安装：macOS `brew install jq`，Debian/Ubuntu `apt install jq`。hook 安装已跳过,装好 jq 后重启 VS Code 即可。'
    )
  } else {
    // 首次自动安装 hook (失败只 toast,不阻塞后续)
    const initialInstall = installHookAssets(context)
    if (!initialInstall.ok) {
      void vscode.window.showErrorMessage(`Claude Task Monitor: hook 安装失败：${initialInstall.error}`)
    }
  }

  archiveStaleFiles(SESSIONS_DIR, ENDED_DIR, staleHours)

  // notifier 必须先于 store 构造,store 需要拿到 notifier.reset 作为 onSessionRemoved 回调
  // (SessionEnd / removeByPid 时清掉 dedup Map,防止 Map 永久膨胀)
  const notifier = new Notifier(dedupeSeconds, (kind, sessions) => {
    // silent 模式:跳过所有系统通知(但 status bar/badge 已在 notifier.notify 时同步)
    if (notifyMode === 'silent') return

    if (notifyMode === 'all' || kind === 'single') {
      // all 模式或单条:每条单独弹
      for (const s of sessions) {
        const msg = formatSingleMessage(s)
        void vscode.window.showWarningMessage(msg, '打开项目').then(action => {
          if (action === '打开项目') {
            void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(s.cwd), { forceNewWindow: false })
          }
        })
      }
      return
    }
    // aggregate 模式 + 多 waiting:弹一条聚合,点击 reveal sidebar
    const msg = formatAggregateMessage(sessions)
    void vscode.window.showWarningMessage(msg, '查看侧边栏').then(action => {
      if (action === '查看侧边栏') {
        void vscode.commands.executeCommand(FOCUS_SESSIONS_VIEW_COMMAND)
      }
    })
  })
  // 静音持久化文件 ~/.claude-task-monitor/muted.json
  const mutedStore = new MutedStore(MUTED_FILE)
  const store = new SessionStore((id) => notifier.reset(id), (id) => mutedStore.isMuted(id))
  const watcher = new SessionsWatcher(SESSIONS_DIR)

  bootstrapExistingFiles(SESSIONS_DIR, watcher, store)

  watcher.on('fileAdded', (file) => {
    // 真正的事件回放靠 line 事件; 这里仅占位
  })
  watcher.on('line', (file, parsedUnknown) => {
    const parsed = parsedUnknown as HookPayload
    const prevStatus = store.get(parsed.session_id)?.status
    store.apply(parsed)
    const next = store.get(parsed.session_id)
    if (!next) return
    // 进 waiting → notifier 进集合 (muted=true 时 notifier 内部跳过弹通知,
    // 但 currentWaiting 仍同步,status bar/badge 反映状态)
    if (next.status === 'waiting' && prevStatus !== 'waiting') {
      notifier.notify(next.sessionId, next.currentTool?.name ?? '<unknown>', next.cwd, next.muted === true)
    } else if (prevStatus === 'waiting' && next.status !== 'waiting') {
      // 出 waiting(Stop / PostToolUse 等)→ 静默退出集合
      notifier.exitWaiting(next.sessionId)
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

  const provider = new SessionTreeDataProvider(store, () => activeFilter, longWaitingThresholdSec)
  const treeView = vscode.window.createTreeView('claudeTaskMonitor.sessionsView', {
    treeDataProvider: provider,
    showCollapseAll: false
  })

  // jq 缺失时在 sidebar 顶部常驻 warning banner,直到用户装好 jq 重启。
  // 不要再走一闪而过的 toast —— 用户很容易错过。
  applyJqBanner(treeView, hasJq)

  // status bar:右下角常驻,反映 waiting 数 (R2)
  const statusBar = new StatusBar()
  statusBar.update(store)

  // 注册 reveal sidebar 命令 (status bar / 通知点击都触发)
  const focusCommand = vscode.commands.registerCommand(FOCUS_SESSIONS_VIEW_COMMAND, () => {
    void vscode.commands.executeCommand('claudeTaskMonitor.sessionsView.focus')
  })

  // sidebar 右键菜单 (5 个 action,接收 SessionState 作 argument)
  const copySessionIdCommand = vscode.commands.registerCommand('claudeTaskMonitor.copySessionId', (s: SessionState) => {
    void vscode.env.clipboard.writeText(s.sessionId)
  })
  const copyAsJsonCommand = vscode.commands.registerCommand('claudeTaskMonitor.copyAsJson', (s: SessionState) => {
    void vscode.env.clipboard.writeText(JSON.stringify(s, null, 2))
  })
  const openInTerminalCommand = vscode.commands.registerCommand('claudeTaskMonitor.openInTerminal', (s: SessionState) => {
    const term = vscode.window.createTerminal({ cwd: s.cwd, name: `claude: ${path.basename(s.cwd) || s.cwd}` })
    term.show()
  })
  const revealInExplorerCommand = vscode.commands.registerCommand('claudeTaskMonitor.revealInExplorer', (s: SessionState) => {
    void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(s.cwd))
  })
  const archiveSessionCommand = vscode.commands.registerCommand('claudeTaskMonitor.archiveSession', (s: SessionState) => {
    archiveSessionNow(s)
  })
  // 右键菜单 "Open in Current Window":forceNewWindow:false 是替换当前 workspace,
  // 单击 / 双击已经默认走 forceNewWindow:true(在新窗口开)避免破坏上下文。
  // 这个命令把旧默认行为降级为显式 opt-in。
  const openInCurrentWindowCommand = vscode.commands.registerCommand('claudeTaskMonitor.openInCurrentWindow', (s: SessionState) => {
    void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(s.cwd), { forceNewWindow: false })
  })
  // 右键菜单 "View Session File":revealFileInOS 到 ~/.claude-task-monitor/sessions/<id>.jsonl
  // —— debug 时看 hook 写盘内容 / 自己排查
  const viewSessionFileCommand = vscode.commands.registerCommand('claudeTaskMonitor.viewSessionFile', (s: SessionState) => {
    const jsonlPath = path.join(SESSIONS_DIR, `${s.sessionId}.jsonl`)
    void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(jsonlPath))
  })
  // 右键菜单 "Toggle Pin":pinned=true 时 sidebar 列表跨 group 置顶
  const togglePinCommand = vscode.commands.registerCommand('claudeTaskMonitor.togglePin', (s: SessionState) => {
    const next = !(s.pinned === true)
    store.setPinned(s.sessionId, next)
  })

  // 从 Command Palette 调用时的 helper:读 treeView 当前选中的 session。
  // 没选中 / 选的是 group 时返回 undefined —— caller 弹 warning。
  function getSelectedSession(): SessionState | undefined {
    const sel = treeView.selection
    if (sel.length === 0) return undefined
    const first = sel[0]
    // sel 是 TreeElement[] = SessionState | SessionGroup;只接 SessionState
    if (first instanceof SessionGroup) return undefined
    return first
  }
  function warnNoSelection(): void {
    void vscode.window.showWarningMessage(t('warn.noSelection'))
  }
  // *OnSelected 版本:无 SessionState 参数,从 treeView.selection 拿。
  // Command Palette 可搜;右键菜单仍走原命令 (有 contextValue 直接传)。
  const copySessionIdOnSelected = vscode.commands.registerCommand('claudeTaskMonitor.copySessionIdOnSelected', () => {
    const s = getSelectedSession()
    if (!s) { warnNoSelection(); return }
    void vscode.env.clipboard.writeText(s.sessionId)
  })
  const copyAsJsonOnSelected = vscode.commands.registerCommand('claudeTaskMonitor.copyAsJsonOnSelected', () => {
    const s = getSelectedSession()
    if (!s) { warnNoSelection(); return }
    void vscode.env.clipboard.writeText(JSON.stringify(s, null, 2))
  })
  const openInTerminalOnSelected = vscode.commands.registerCommand('claudeTaskMonitor.openInTerminalOnSelected', () => {
    const s = getSelectedSession()
    if (!s) { warnNoSelection(); return }
    const term = vscode.window.createTerminal({ cwd: s.cwd, name: `claude: ${path.basename(s.cwd) || s.cwd}` })
    term.show()
  })
  const revealInExplorerOnSelected = vscode.commands.registerCommand('claudeTaskMonitor.revealInExplorerOnSelected', () => {
    const s = getSelectedSession()
    if (!s) { warnNoSelection(); return }
    void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(s.cwd))
  })
  const archiveSessionOnSelected = vscode.commands.registerCommand('claudeTaskMonitor.archiveSessionOnSelected', () => {
    const s = getSelectedSession()
    if (!s) { warnNoSelection(); return }
    archiveSessionNow(s)
  })
  // 切换单 session 通知静音:写 MutedStore (落盘) + 同步 store (UI 立即反映)。
  // 当前 muted 状态由 SessionState.muted 决定,菜单 when 表达式控制可见性。
  const toggleMuteCommand = vscode.commands.registerCommand('claudeTaskMonitor.toggleMute', (s: SessionState) => {
    const next = !(s.muted === true)
    mutedStore.setMuted(s.sessionId, next)
    store.setMuted(s.sessionId, next)
    const name = path.basename(s.cwd) || s.cwd
    void vscode.window.showInformationMessage(next ? t('mute.on', name) : t('mute.off', name))
  })
  // 打开 GitHub README —— Welcome View / 错误 toast 里都能用
  const openDocsCommand = vscode.commands.registerCommand('claudeTaskMonitor.openDocs', () => {
    void vscode.env.openExternal(vscode.Uri.parse('https://github.com/codewithwu/Claude-Task-Monitor#readme'))
  })

  // 安装 / 重新安装 hook:Command Palette + Welcome View 都能触发。
  const installHookCommand = vscode.commands.registerCommand('claudeTaskMonitor.installHook', () => {
    const result = installHookAssets(context)
    if (!result.ok) {
      void vscode.window.showErrorMessage(t('hook.install.fail', result.error ?? 'unknown'))
    } else {
      void vscode.window.showInformationMessage(t('hook.install.ok'))
    }
  })
  // 重新弹 onboarding 卡片:无视 globalState,无论是否已 show 过都可触发。
  // 不写 globalState —— 用户显式触发"再看一次",语义纯净。
  const showOnboardingCommand = vscode.commands.registerCommand('claudeTaskMonitor.showOnboarding', () => {
    return showOnboardingCards(hasJq, () => Promise.resolve(installHookAssets(context)))
  })
  // 复制 jq 安装命令到剪贴板(按 process.platform 选 brew/apt/winget)。
  const copyJqInstallCommand = vscode.commands.registerCommand('claudeTaskMonitor.copyJqInstallCommand', async () => {
    const cmd = getJqInstallCommand()
    await vscode.env.clipboard.writeText(cmd)
    void vscode.window.showInformationMessage(t('onboarding.toast.copied', cmd))
  })
  // 切换视图过滤模式(All/Waiting/Running/Idle):无参从 Command Palette 调用时弹 quickPick;
  // 有参 (FilterMode) 时直接应用,供右键菜单 / 后续 inline button 调用。
  const setFilterCommand = vscode.commands.registerCommand('claudeTaskMonitor.setFilter', async (mode?: string) => {
    const target: FilterMode = (mode && isFilterMode(mode)) ? mode : await pickFilterMode()
    if (!target) return
    if (target === activeFilter) return
    activeFilter = target
    await context.workspaceState.update(FILTER_KEY, target)
    provider.refresh()
  })

  // store 变化时同步刷新 status bar 文案 + sidebar 徽标。
// 用 waitingCount 闭包变量去重,避免 UserPromptSubmit / PreToolUse /
  // PostToolUse 等不影响 waiting 集合的事件触发无意义的 UI 更新 (#7)。
  let lastWaitingCount = -1
  const syncWaitingDependentUI = () => {
    const cur = store.list().filter(s => s.status === 'waiting').length
    if (cur === lastWaitingCount) return
    lastWaitingCount = cur
    statusBar.update(store)
    applyBadge(treeView, store)
  }
  const onStoreChange = () => syncWaitingDependentUI()
  store.onChange(onStoreChange)
  // 初始化 (waiting 可能来自 bootstrapExistingFiles)
  syncWaitingDependentUI()

  const tick = setInterval(() => {
    provider.refresh()
    // statusBar + badge 走 syncWaitingDependentUI,不再每 tick 触发 (#6)
  }, refreshMs)
  const livenessTick = setInterval(() => {
    const { removed, archived } = pruneDeadSessions(store, SESSIONS_DIR)
    if (removed > 0) {
      console.log(`[claude-task-monitor] pruned ${removed} dead session(s): ${archived.map(p => path.basename(p)).join(', ')}`)
    }
  }, livenessMs)

  context.subscriptions.push(
    treeView,
    provider,  // dispose() 释放 store.onChange listener 和 EventEmitter (#8)
    focusCommand,
    copySessionIdCommand,
    copyAsJsonCommand,
    openInTerminalCommand,
    revealInExplorerCommand,
    archiveSessionCommand,
    openInCurrentWindowCommand,
    viewSessionFileCommand,
    togglePinCommand,
    toggleMuteCommand,
    openDocsCommand,
    copySessionIdOnSelected,
    copyAsJsonOnSelected,
    openInTerminalOnSelected,
    revealInExplorerOnSelected,
    archiveSessionOnSelected,
    installHookCommand,
    showOnboardingCommand,
    copyJqInstallCommand,
    setFilterCommand,
    statusBar,
    { dispose: () => clearInterval(tick) },
    { dispose: () => clearInterval(livenessTick) },
    { dispose: () => void watcher.close() }
  )

  // 首次激活 onboarding (R2)。fire-and-forget;内部自己处理 globalState 幂等
  // 「安装 hook」按钮复用 installHookAssets (跟激活时的自动安装走同一份代码)
  void maybeShowOnboarding(context, hasJq, () => Promise.resolve(installHookAssets(context)))
}

// 把 hook.sh 写到 ~/.claude-task-monitor/ 并把 hooks 块合并进 ~/.claude/settings.json。
// activate 自动安装 + onboarding 「安装 hook」按钮共用此函数。
// settings.json 写盘前做内容比较,内容相同则跳过 writeFileSync (#9) ——
// 避免每次激活都 touch 文件,免得 Claude Code 或其他 watcher 误以为配置变了。
function installHookAssets(context: vscode.ExtensionContext): { ok: boolean; error?: string } {
  try {
    const resourceHook = path.join(context.extensionPath, 'resources', 'hook.sh')
    writeHookScript(resourceHook, HOOK_SCRIPT)
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true })
    const existingRaw = fs.existsSync(CLAUDE_SETTINGS) ? fs.readFileSync(CLAUDE_SETTINGS, 'utf8') : '{}'
    const existing = JSON.parse(existingRaw)
    const merged = mergeSettings(existing, HOOK_SCRIPT)
    const newRaw = JSON.stringify(merged, null, 2)
    if (newRaw !== existingRaw) {
      fs.writeFileSync(CLAUDE_SETTINGS, newRaw)
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// jq 缺失时在 sidebar 顶部常驻 warning banner,直到用户装好 jq 重启。
// TreeView.message 支持 markdown + command 链接 ([text](command:id))。
// 已就位时清空 banner,避免占视觉空间。
function applyJqBanner(treeView: vscode.TreeView<unknown>, hasJq: boolean): void {
  if (hasJq) {
    treeView.message = undefined
    return
  }
  treeView.message = new vscode.MarkdownString(t('banner.jqMissing'))
}

// filter 命令无参时弹 quickPick,让用户从 4 种模式里选。
async function pickFilterMode(): Promise<FilterMode | undefined> {
  const labels: Record<FilterMode, string> = {
    all: t('filter.label.all'),
    waiting: t('filter.label.waiting'),
    running: t('filter.label.running'),
    idle: t('filter.label.idle')
  }
  const picked = await vscode.window.showQuickPick(
    FILTER_MODES.map(mode => ({ label: labels[mode], mode })),
    { title: t('filter.title'), placeHolder: t('filter.placeholder') }
  )
  return picked?.mode
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
  fs.mkdirSync(endedDir, { recursive: true })
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!name.endsWith('.jsonl')) continue
    const full = path.join(sessionsDir, name)
    try {
      const stat = fs.statSync(full)
      if (stat.mtimeMs < cutoffMs) {
        fs.renameSync(full, path.join(endedDir, `${path.basename(name, '.jsonl')}-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`))
      }
    } catch {
      // 忽略
    }
  }
}

// 立即归档单个 session (右键菜单 "Archive Session Now" 调用):
//   把 ~/.claude-task-monitor/sessions/<id>.jsonl 移到 .ended/,
//   watcher.on('fileRemoved') 会派发 SessionEnd 到 store。
function archiveSessionNow(s: SessionState): void {
  const jsonlPath = path.join(SESSIONS_DIR, `${s.sessionId}.jsonl`)
  if (!fs.existsSync(jsonlPath)) {
    void vscode.window.showWarningMessage(`Claude Task Monitor: 归档失败,文件不存在 (${s.sessionId})`)
    return
  }
  try {
    const target = path.join(ENDED_DIR, `${s.sessionId}-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`)
    fs.renameSync(jsonlPath, target)
  } catch (e) {
    void vscode.window.showErrorMessage(`Claude Task Monitor: 归档失败:${(e as Error).message}`)
  }
}

function bootstrapExistingFiles(sessionsDir: string, watcher: SessionsWatcher, store: SessionStore): void {
  const files = fs.readdirSync(sessionsDir).filter(n => n.endsWith('.jsonl'))
  console.log(`[claude-task-monitor] bootstrap: found ${files.length} session files in ${sessionsDir}`)
  for (const name of files) {
    const full = path.join(sessionsDir, name)
    try {
      const content = fs.readFileSync(full, 'utf8')
      for (const line of content.split('\n')) {
        if (!line) continue
        try {
          store.apply(JSON.parse(line) as HookPayload)
        } catch (e) {
          console.warn(`[claude-task-monitor] bootstrap parse error in ${full}: ${(e as Error).message}`)
        }
      }
      watcher.setOffset(full, Buffer.byteLength(content, 'utf8'))
    } catch (e) {
      console.warn(`[claude-task-monitor] bootstrap read error for ${full}: ${(e as Error).message}`)
    }
  }
}
