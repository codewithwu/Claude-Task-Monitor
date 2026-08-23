// Status bar 语言切换按钮 (08-23 ui-lang-toggle):
//   - priority 99 紧邻 CTM (priority 100),逻辑分组
//   - 文本:$(globe) + 短标签 (A/中/EN) —— 短标签是符号,不是文案,不 i18n
//   - tooltip:多行,i18n 化,显式告知 Command palette 不跟随的硬限制
//   - 点击触发命令 claudeTaskMonitor.toggleLanguage,由 extension.ts 注册并接 LangStore.cycle()
//
// 刷新路径:
//   - 用户点按钮 → cycle() 写 config → onDidChangeConfiguration 监听器 → render()
//   - 用户在 Settings UI 改 language → onDidChangeConfiguration 监听器 → render()
//   - LangStore.syncFromConfig() 后立即 render() (避免 1s tick 内的视觉延迟)

import * as vscode from 'vscode'
import { type LangPref, LangStore, nextPref } from '../util/langStore.js'
import { t } from '../i18n/index.js'

// 短标签:跟状态名 (i18n) 区分,作为符号存在,不进 messages 表
const LABELS: Record<LangPref, string> = {
  auto: 'A',
  zh: '中',
  en: 'EN'
}

export class LangToggle {
  private readonly item: vscode.StatusBarItem

  constructor(private readonly store: LangStore) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99
    )
    this.item.command = 'claudeTaskMonitor.toggleLanguage'
    this.item.name = 'Language toggle'
    this.render()
    this.item.show()
  }

  /**
   * 重画按钮文本 + tooltip。调用方负责在状态变化后调用 (extension.ts 的
   * onDidChangeConfiguration 监听器,见 syncFromConfig + render 链路)。
   */
  render(): void {
    const pref = this.store.get()
    const next = nextPref(pref)
    this.item.text = `$(globe) ${LABELS[pref]}`
    this.item.tooltip = t(
      'lang.toggle.tooltip',
      t(`lang.toggle.state.${pref}`),
      t(`lang.toggle.state.${next}`)
    )
  }

  dispose(): void {
    this.item.dispose()
  }
}
