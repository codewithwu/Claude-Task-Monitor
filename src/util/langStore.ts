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
import { detectEnvLang } from '../i18n/index.js'

export type LangPref = 'auto' | 'zh' | 'en'
export type Lang = 'zh' | 'en'

// cycle 顺序:用户在 status bar 点击按钮按此序列前进
const PREF_ORDER: readonly LangPref[] = ['auto', 'zh', 'en'] as const

/**
 * 运行时校验:任意 unknown 是否是合法 LangPref。
 * 供 LangStore 构造器 / syncFromConfig 在手编辑 settings.json / schema 漂移时
 * 退回到 'auto';供 LangToggle.render() 替代手维护的合法值枚举。
 * 实现:PREF_ORDER.includes 是单一事实源,新 pref 加入只需改 PREF_ORDER。
 */
export function isLangPref(p: unknown): p is LangPref {
  return typeof p === 'string' && (PREF_ORDER as readonly string[]).includes(p)
}

export class LangStore {
  private current: LangPref

  constructor(initial: LangPref) {
    if (!isLangPref(initial)) {
      console.warn(
        `[claude-task-monitor] LangStore: invalid pref "${String(initial)}", ` +
        `falling back to "auto". Valid values: ${PREF_ORDER.join(', ')}`
      )
      this.current = 'auto'
      return
    }
    this.current = initial
  }

  /** 当前偏好状态 (不含 'auto' 解析) */
  get(): LangPref {
    return this.current
  }

  /**
   * 把 pref 解析成实际生效的 lang。
   * - pref='auto' → detectEnvLang() (env only,**不读** module override)
   * - pref='zh'/'en' → 直接返回
   *
   * 注意:LangStore 不写 module override (08-27 FR5 明确化)。
   * override 由 extension.ts 的 onDidChangeConfiguration 监听器单一写入,
   * LangStore 保持与 i18n 层解耦 (可单测,无需 mock vscode 状态)。
   * 'auto' 走 detectEnvLang 是 UI 跟随 env 的语义需要 —— LangToggle 只读
   * pref,UI 跟随由 detectEnvLang 解析,而 t() 全局则通过
   * setLangOverride(undefined) 回落 env (见 i18n spec)。
   */
  currentLang(): Lang {
    return this.current === 'auto' ? detectEnvLang() : this.current
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
   *
   * 防御层:config 里出现非 LangPref 值 (手编辑 settings.json / schema 漂移)
   * 时回落到 'auto' + warn。LangToggle.render() 也会再校验一次,
   * 但那是 UI 兜底 —— 数据层先挡住,避免 UI 看到污染数据。
   */
  syncFromConfig(): LangPref {
    const cfg = vscode.workspace.getConfiguration('claudeTaskMonitor')
      .get<LangPref>('language', 'auto')
    if (isLangPref(cfg)) {
      this.current = cfg
      return this.current
    }
    console.warn(
      `[claude-task-monitor] LangStore: config has invalid language "${String(cfg)}", ` +
      `falling back to "auto".`
    )
    this.current = 'auto'
    return this.current
  }
}

/** 把 LangPref 推进一步 (不写 config,纯函数)。供 LangToggle 预览「下次点击会发生什么」。 */
export function nextPref(pref: LangPref): LangPref {
  const idx = PREF_ORDER.indexOf(pref)
  return PREF_ORDER[(idx + 1) % PREF_ORDER.length]
}
