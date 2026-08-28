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
//
// 健壮性策略 (08-28 F2):构造器对非法 pref 改为 fail-soft (warn + 渲染 ? + invalid tooltip),
// 不再 throw。一旦 LangStore 数据边界回归 (例如 syncFromConfig 漏掉 isLangPref 守卫),
// 透出非法值时 LangToggle 仍能加载,只是按钮显示降级 UI;
// 下次 cycle() 经 LangStore.set() 写 config 成功后,
// onDidChangeConfiguration 监听器触发新 render() 自愈。LangStore 仍是数据边界责任,
// LangToggle 是 UI 兜底 (不应承担非法输入的检测主责)。

import * as vscode from 'vscode'
import { type LangPref, isLangPref, nextPref } from '../util/langStore.js'
import { t } from '../i18n/index.js'

// 短标签:跟状态名 (i18n) 区分,作为符号存在,不进 messages 表
const LABELS: Record<LangPref, string> = {
  auto: 'A',
  zh: '中',
  en: 'EN'
}

export class LangToggle {
  private readonly item: vscode.StatusBarItem

  constructor(private readonly getPref: () => LangPref) {
    // 防御层 (08-26→08-28):getPref 契约是 () => LangPref,LangStore 是数据边界
    // (非法输入会回落到 'auto' + warn)。一旦 LangStore 回归让 get() 透出非法值,
    // 这里 fail-loud 会让 extension.activate() 抛错,整个 extension 无法加载。
    // 改为 fail-soft (08-28 F2):warn 一次 + render() 走降级分支 (?, invalid tooltip);
    // 下次 cycle() 经 LangStore.set() 写 config 成功后,
    // onDidChangeConfiguration 监听器触发新 render() 自愈。
    // 这一行只跑一次,运行时零开销。
    const initial = getPref()
    if (!isLangPref(initial)) {
      console.warn(
        `[claude-task-monitor] LangToggle: getPref() returned invalid value ` +
        `"${String(initial)}"; rendering degraded UI until next sync.`
      )
    }
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
   * 当 getPref() 返回非法值时走降级 UI (? + invalid tooltip),见 08-28 F2。
   */
  render(): void {
    const raw = this.getPref()
    if (isLangPref(raw)) {
      const next = nextPref(raw)
      this.item.text = `$(globe) ${LABELS[raw]}`
      this.item.tooltip = t(
        'lang.toggle.tooltip',
        t(`lang.toggle.state.${raw}`),
        t(`lang.toggle.state.${next}`)
      )
    } else {
      // 08-28 F2 fail-soft:构造时已 warn 一次 (见 constructor)。
      // 显示 ? + 解释 tooltip;cycle() 写 config 成功后 LangStore 会自我修复,
      // 下次 render() (由 onDidChangeConfiguration 触发) 走正常分支。
      this.item.text = `$(globe) ?`
      this.item.tooltip = t('lang.toggle.invalid', String(raw))
    }
  }

  dispose(): void {
    this.item.dispose()
  }
}
