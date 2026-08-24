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
//
// 构造函数参数:接受 `() => LangPref` getter 而不是完整 LangStore 实例 —— render() 只读 pref,
// 跟 LangStore 的写方法 (set/cycle/syncFromConfig) 解耦,跟 commit 661d891 之前的窄接口对齐。

import * as vscode from 'vscode'
import { type LangPref, nextPref } from '../util/langStore.js'
import { t } from '../i18n/index.js'

// 短标签:跟状态名 (i18n) 区分,作为符号存在,不进 messages 表
const LABELS: Record<LangPref, string> = {
  auto: 'A',
  zh: '中',
  en: 'EN'
}

// 运行时防御:settings.json 被手编辑成 enum 之外的值 (例如 'fr'),LangStore 不会校验
// 直接存进来。render() 必须能容忍,否则 status bar 会渲染字面量 'undefined'。
// 返回 null 时调用方负责兜底展示 (见 render())。
function safePref(p: LangPref): LangPref | null {
  return p === 'auto' || p === 'zh' || p === 'en' ? p : null
}

export class LangToggle {
  private readonly item: vscode.StatusBarItem

  constructor(private readonly getPref: () => LangPref) {
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
    const raw = this.getPref()
    const pref = safePref(raw)
    if (pref === null) {
      // 非法 pref:显示 '?' 让用户看到异常,tooltip 告知原始值;
      // 用户点击 → cycle() 会把任意 pref 推进到 PREF_ORDER[0]='auto' (indexOf 不命中 → 0),
      // 自愈到合法值,无需专门写 reset 命令。
      this.item.text = '$(globe) ?'
      this.item.tooltip = t('lang.toggle.invalid', raw)
      return
    }
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
