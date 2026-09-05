import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  uninstallSettings,
  HOOK_SCRIPT_REL,
  CLAUDE_SETTINGS_REL,
  type Settings
} from './installer.js'

// vscode:uninstall 钩子入口(09-05 P0 #2)。
//
// 背景:deactivate() 在 reload / 关闭窗口 / 禁用扩展 / 卸载 时都会触发,
// 把卸载清理放进 deactivate 会污染日常使用。VS Code 提供专门的
// "vscode:uninstall" 脚本(v1.21+),只在扩展被卸载时由 VS Code 调起,
// 跑在普通 Node 进程里(无 vscode API),适合做文件系统清理。
//
// runUninstall 是纯函数式核心,opts.home 可注入 → 测试用 tmpDir 隔离。
// CLI 入口(require.main === module)只做 best-effort 调用,不抛异常。

export interface UninstallOptions {
  /** 用户 home 目录绝对路径;测试可注入临时目录 */
  home: string
}

export interface UninstallResult {
  ok: boolean
  error?: string
}

export function runUninstall(opts: UninstallOptions): UninstallResult {
  const settingsPath = path.join(opts.home, CLAUDE_SETTINGS_REL)
  const hookPath = path.join(opts.home, HOOK_SCRIPT_REL)

  try {
    // 1. 清 ~/.claude/settings.json 中本扩展条目
    //    settings.json 不存在 → 当作无需清理,直接 ok。
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf8')
      let parsed: Settings
      try {
        parsed = JSON.parse(raw) as Settings
      } catch (e) {
        // JSON 损坏:不能让卸载流程因此挂掉;记录后继续删 hook.sh。
        console.warn('[claude-task-monitor] uninstall: settings.json 不是合法 JSON:', (e as Error).message)
        parsed = {}
      }
      const cleaned = uninstallSettings(parsed)
      const newRaw = JSON.stringify(cleaned, null, 2)
      // 内容相等则不写回:避免无意义 touch(与 installHookAssets 的 #9 优化对称)。
      if (newRaw !== raw) {
        fs.writeFileSync(settingsPath, newRaw)
      }
    }

    // 2. 删 ~/.claude-task-monitor/hook.sh
    //    文件不存在 → ok。
    if (fs.existsSync(hookPath)) {
      fs.unlinkSync(hookPath)
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// CLI 入口 —— 由 package.json scripts.vscode:uninstall 调起。
// tsup 输出 cjs (见 tsup.config.ts format),require.main === module 可用。
// 卸载流程已发生,即便 ok: false 也 exit 0;错误日志交给 console.warn 让
// 用户在 VS Code 「Extension Uninstall」面板或下一启动日志里能看到。
if (require.main === module) {
  const result = runUninstall({ home: os.homedir() })
  if (!result.ok) {
    console.warn('[claude-task-monitor] uninstall:', result.error)
  }
}
