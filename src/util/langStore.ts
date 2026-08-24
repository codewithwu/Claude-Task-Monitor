// UI 语言偏好存储 (08-23 ui-lang-toggle):
//   - 状态保存在 VS Code 配置 claudeTaskMonitor.language (enum: auto/zh/en, Global scope)
//   - 'auto' 表示跟随 vscode.env.language,zh/en 是强制覆盖
//   - set/cycle 写 config,触发 onDidChangeConfiguration 后由 extension.ts 统一刷 UI
//   - syncFromConfig 供监听器读最新值 (避免读陈旧内部状态)
//
// 设计选择:
//   - 不持有 EventEmitter —— 事件由 onDidChangeConfiguration 单一通道驱动,避免双触发
//   - 不引入工作区作用域 —— 语言偏好是用户级,跨工作区保持一致 (跟 notifyMode 同型)
//   - 幂等:同 pref 重复 set 不写 config,避免误触发 onDidChange
//   - 无 dispose 需要:无 EventEmitter / 无定时器 / 无 IDisposable 字段
//     (subscriptions 由 extension.ts 推 disposable,本身没有可释放资源)

import * as vscode from 'vscode'
import { detectLang } from '../i18n/index.js'

export type LangPref = 'auto' | 'zh' | 'en'
export type Lang = 'zh' | 'en'

// cycle 顺序:用户在 status bar 点击按钮按此序列前进
const PREF_ORDER: readonly LangPref[] = ['auto', 'zh', 'en'] as const

export class LangStore {
  private current: LangPref

  constructor(initial: LangPref) {
    this.current = initial
  }

  /** 当前偏好状态 (不含 'auto' 解析) */
  get(): LangPref {
    return this.current
  }

  /**
   * 把 pref 解析成实际生效的 lang。
   * 'auto' 时回落到 i18n.detectLang (auto 分支只看 vscode.env.language,这里直接复用,
   * 避免双处维护 startsWith('zh') 逻辑)。
   */
  currentLang(): Lang {
    return this.current === 'auto' ? detectLang() : this.current
  }

  /**
   * 写入新偏好。同 pref 重复设直接返回,不触发 config write。
   * 注意:必须 await config.update() 成功后才更新内部状态 —— 如果先改 this.current
   * 再写 config,update() 抛错会让 in-memory 跟 config 永久偏离,下次 cycle() 会把
   * 用户的 'auto' 静默覆盖成 'en'。把赋值挪到 await 之后,失败时 this.current 保持
   * 不变,syncFromConfig() 重新对账即可。
   */
  async set(pref: LangPref): Promise<void> {
    if (pref === this.current) return
    await vscode.workspace.getConfiguration('claudeTaskMonitor')
      .update('language', pref, vscode.ConfigurationTarget.Global)
    this.current = pref
  }

  /** 按 PREF_ORDER 前进一格 (auto → zh → en → auto loop),返回新 pref。 */
  async cycle(): Promise<LangPref> {
    const next = nextPref(this.current)
    await this.set(next)
    return next
  }

  /**
   * 从 config 重读最新值。供 extension.ts 的 onDidChangeConfiguration 监听器调用,
   * 避免在异步 set() 与事件触发之间读到陈旧状态。
   */
  syncFromConfig(): LangPref {
    const cfg = vscode.workspace.getConfiguration('claudeTaskMonitor')
      .get<LangPref>('language', 'auto')
    this.current = cfg
    return this.current
  }
}

/** 把 LangPref 推进一步 (不写 config,纯函数)。供 LangToggle 预览「下次点击会发生什么」。 */
export function nextPref(pref: LangPref): LangPref {
  const idx = PREF_ORDER.indexOf(pref)
  return PREF_ORDER[(idx + 1) % PREF_ORDER.length]
}
