// onboarding 的 globalState 幂等封装。
// 用 globalState (vs workspaceState) 走 MachineScope —— 同一台机器的所有
// VS Code 窗口共享一次 onboarding。跨机器各自触发,可接受。

import type { ExtensionContext } from 'vscode'

const KEY = 'ctm.onboardingShown'

export function hasSeenOnboarding(context: ExtensionContext): boolean {
  return context.globalState.get<boolean>(KEY, false) === true
}

export function markOnboardingShown(context: ExtensionContext): Thenable<void> {
  return context.globalState.update(KEY, true)
}

export function resetOnboarding(context: ExtensionContext): Thenable<void> {
  return context.globalState.update(KEY, false)
}