// 首次激活 onboarding:
//   1. globalState 幂等(只弹一次) —— `maybeShowOnboarding` 包装层负责
//   2. 三步引导卡片:安装 hook → 启动 claude → 看红点
//   3. 两个动作按钮:「安装 hook」/「跳过」
//   4. jq 缺失分支:第一步变为"先装 jq",附复制命令按钮(只复制,不触发 hook 安装)
//
// 「重新显示 onboarding」入口(`claudeTaskMonitor.showOnboarding` 命令):
//   - 走 `showOnboardingCards` 不走 `maybeShowOnboarding`,绕过 globalState
//   - 不写 globalState,这样下次启动 activate 仍会弹一次首次卡片
//
// 注意:onboarding 只负责"展示 + 标记已读"。
// 「安装 hook」按钮真正触发的写盘逻辑由 extension.ts 提供(避免 onboarding
// 直接 import installer.ts 形成 UI ↔ installer 紧耦合)。
//
// 关键不变量:jq 缺失时绝不调 installHook —— 否则用户会被「hook 已安装」
// toast 误导,而 hook.sh 第一行就是 jq,实际静默失败。
//
// 文案走 i18n。

import * as vscode from 'vscode'
import { hasSeenOnboarding, markOnboardingShown } from '../util/onboardingState.js'
import { t } from '../i18n/index.js'

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
  await showOnboardingCards(hasJq, installHook)
}

// 核心 dialog 渲染:与 globalState 解耦,可被 `claudeTaskMonitor.showOnboarding` 命令复用。
// 始终不写 globalState —— 让"重新看 onboarding"的语义保持纯净。
export async function showOnboardingCards(
  hasJq: boolean,
  installHook: InstallHookFn
): Promise<void> {
  const action = hasJq
    ? await showJqOk()
    : await showJqMissing()

  if (action === 'install') {
    const result = await installHook()
    if (!result.ok) {
      void vscode.window.showErrorMessage(
        t('hook.install.fail', result.error ?? '')
      )
    } else {
      void vscode.window.showInformationMessage(
        t('onboarding.toast.installed')
      )
    }
  }
  // 'skip' / 'dismissed' / 'copy' / undefined 都视为结束
}

// jq 已就位:标准三步引导
async function showJqOk(): Promise<'install' | 'skip' | 'dismissed' | undefined> {
  const choice = await vscode.window.showInformationMessage(
    t('onboarding.card.ok'),
    t('onboarding.button.installHook'),
    t('onboarding.button.skip')
  )
  if (!choice) return 'dismissed'
  return choice === t('onboarding.button.installHook') ? 'install' : 'skip'
}

// jq 缺失:第一步改为引导用户先装 jq。
// 复制 brew/apt 命令只是把命令写到剪贴板,让用户自己去终端跑,
// 不算 "install" —— 避免误导性 success toast。
async function showJqMissing(): Promise<'copy' | 'skip' | 'dismissed' | undefined> {
  const choice = await vscode.window.showWarningMessage(
    t('onboarding.card.jqMissing'),
    t('onboarding.button.copyBrew'),
    t('onboarding.button.copyApt'),
    t('onboarding.button.skip')
  )
  if (!choice) return 'dismissed'
  if (choice === t('onboarding.button.skip')) return 'skip'
  const cmd = choice === t('onboarding.button.copyBrew') ? t('jqInstall.darwin') : t('jqInstall.linux')
  await vscode.env.clipboard.writeText(cmd)
  void vscode.window.showInformationMessage(t('onboarding.toast.copied', cmd))
  return 'copy'  // 不是 install —— 不触发 installHook
}