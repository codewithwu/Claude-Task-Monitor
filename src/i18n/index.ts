// 运行时国际化:
//
// 设计选择:用自建轻量 i18n 而不是 vscode.l10n ——
//   1. 包体积小,不需要 vsce 生成 XLF 文件
//   2. caller 直接传 string key,编译期能检查 (vs l10n 是 bundle 时才验证)
//   3. 文案量不大(~30 条),手写 enum-like key 集合足够
//
// 切换策略:
//   - vscode.env.language 以 'zh' 开头 → 中文
//   - 其他 → 英文 (默认 fallback)
//   - 缺失 key → 返回 key 本身,console.warn 一次 (避免 typo 默默走 fallback)
//
// 手动覆盖 (08-23 ui-lang-toggle):
//   - setLangOverride(lang) 写入模块级 override,detectLang() 优先返回它
//   - LangStore.set() 在配置变化时调 setLangOverride,让所有 t() 立即生效
//   - 设为 undefined 回落到 vscode.env.language (auto 模式)
//
// 占位符:
//   - 使用 {0} {1} ... 形式,跟 vscode.l10n 对齐
//   - 调用: t('xxx', arg0, arg1) → 自动替换
//
// 测试隔离:
//   - `t(key, ...args, lang?)` 接受可选 lang 参数,默认走 detectLang (override 优先)
//   - 测试时显式传 lang,跳过 detectLang
//   - 测试覆盖 override 后必须 setLangOverride(undefined) 重置 (见 i18n.test.ts afterEach)

import * as vscode from 'vscode'

import { en } from './messages/en.js'
import { zh } from './messages/zh.js'

export type Lang = 'zh' | 'en'

// 模块级手动覆盖:LangStore 在 set/cycle 时写入,让所有 t() 立即跟随。
// undefined = 未覆盖,回落到 vscode.env.language。
let override: Lang | undefined

export function setLangOverride(lang: Lang | undefined): void {
  override = lang
}

export function detectLang(): Lang {
  if (override) return override
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/**
 * 从 vscode.env.language 解析 lang,**不读** module override。
 * 仅供 LangStore.currentLang() 在 pref='auto' 时使用 —— 让 UI 跟随环境,
 * 不被 module override 残留污染。detectLang() 保留 override 优先语义,
 * 因为 t() 全局需要 override 生效 (08-23 ui-lang-toggle 的设计选择)。
 */
export function detectEnvLang(): Lang {
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function getMessages(lang: Lang): Record<string, string> {
  return lang === 'zh' ? zh : en
}

// t() 主入口:无 lang 参数时从 vscode.env.language 读 (生产代码用)
//             显式传 lang 时跳过 detectLang (测试代码用)
export function t(key: string, ...args: Array<string | number | Lang>): string {
  // 最后一个参数如果是 'zh' 或 'en',视为 lang override (其他参数视为占位符)
  let lang: Lang | undefined
  const placeholders: Array<string | number> = []
  for (const arg of args) {
    if (arg === 'zh' || arg === 'en') {
      lang = arg
    } else {
      placeholders.push(arg as string | number)
    }
  }
  if (!lang) lang = detectLang()
  const template = resolveTemplate(key, lang)
  return template.replace(/\{(\d+)\}/g, (_m, idx) => {
    const arg = placeholders[Number(idx)]
    return arg === undefined ? `{${idx}}` : String(arg)
  })
}

function resolveTemplate(key: string, lang: Lang): string {
  const messages = getMessages(lang)
  const template = messages[key]
  if (template === undefined) {
    console.warn(`[claude-task-monitor] missing i18n key: "${key}" (lang=${lang})`)
    return key
  }
  return template
}