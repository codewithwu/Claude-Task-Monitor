// 首次激活 onboarding:
//   1. globalState 幂等(只弹一次)
//   2. 三步引导卡片:安装 hook → 启动 claude → 看红点
//   3. 两个动作按钮:「安装 hook」/「跳过」
//   4. jq 缺失分支:第一步变为"先装 jq",附复制命令按钮(只复制,不触发 hook 安装)
//
// 注意:onboarding 只负责"展示 + 标记已读"。
// 「安装 hook」按钮真正触发的写盘逻辑由 extension.ts 提供(避免 onboarding
// 直接 import installer.ts 形成 UI ↔ installer 紧耦合)。
//
// 关键不变量:jq 缺失时绝不调 installHook —— 否则用户会被「hook 已安装」
// toast 误导,而 hook.sh 第一行就是 jq,实际静默失败。

import * as vscode from 'vscode'
import { hasSeenOnboarding, markOnboardingShown } from '../util/onboardingState.js'

export interface InstallHookResult {
  ok: boolean
  error?: string
}

export type InstallHookFn = () => Promise<InstallHookResult>

export async function maybeShowOnboarding(
  context: vscode.ExtensionContext,
  hasJq: boolean,
  installHook: InstallHookFn
): Promise<void> {
  if (hasSeenOnboarding(context)) return
  // 标记 seen 即使失败也要写,避免重复骚扰用户;失败由具体按钮响应体现
  await markOnboardingShown(context)

  const action = hasJq
    ? await showJqOk()
    : await showJqMissing()

  if (action === 'install') {
    const result = await installHook()
    if (!result.ok) {
      void vscode.window.showErrorMessage(
        `Claude Task Monitor: hook 安装失败:${result.error ?? '未知错误'}`
      )
    } else {
      void vscode.window.showInformationMessage(
        'Claude Task Monitor: hook 已安装。现在启动 `claude`,有 waiting 时侧边栏会出现红点。'
      )
    }
  }
  // 'skip' / 'dismissed' / undefined 都视为结束,不再做额外动作
}

// jq 已就位:标准三步引导
async function showJqOk(): Promise<'install' | 'skip' | 'dismissed' | undefined> {
  const choice = await vscode.window.showInformationMessage(
    '🎉 Claude Task Monitor 已激活\n\n三步开始使用:\n\n1️⃣ 安装 hook (点下方按钮)\n2️⃣ 打开终端运行 claude\n3️⃣ 等待权限时,红点会出现在侧边栏',
    '安装 hook',
    '跳过'
  )
  if (!choice) return 'dismissed'
  return choice === '安装 hook' ? 'install' : 'skip'
}

// jq 缺失:第一步改为引导用户先装 jq。
// 复制 brew/apt 命令只是把命令写到剪贴板,让用户自己去终端跑,
// 不算 "install" —— 避免误导性 success toast。
async function showJqMissing(): Promise<'copy' | 'skip' | 'dismissed' | undefined> {
  const choice = await vscode.window.showWarningMessage(
    '⚠️ Claude Task Monitor 需要先安装 jq\n\nhook 依赖 jq 解析 Claude Code 事件载荷。按系统选其一:\n\n• macOS: brew install jq\n• Debian/Ubuntu: sudo apt install jq\n• Windows: 从 stedolan.github.io/jq/download/ 下载二进制加入 PATH\n\n安装完 jq 后重启 VS Code。',
    '复制 brew 命令',
    '复制 apt 命令',
    '跳过'
  )
  if (!choice) return 'dismissed'
  if (choice === '跳过') return 'skip'
  const cmd = choice === '复制 brew 命令' ? 'brew install jq' : 'sudo apt install jq'
  await vscode.env.clipboard.writeText(cmd)
  void vscode.window.showInformationMessage(`已复制: ${cmd}。粘贴到终端运行,装好后重启 VS Code。`)
  return 'copy'  // 不是 install —— 不触发 installHook
}