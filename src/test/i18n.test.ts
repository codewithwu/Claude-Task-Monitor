import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 桩 vscode 模块:detection 逻辑只读 vscode.env.language 一个字段,
// 测试时直接 defineProperty 切换即可,不需要整个 stub。
// 这里用 vi.mock 占位只是为了通过模块解析 (vitest 默认找不到 vscode 包)。
vi.mock('vscode', () => ({
  env: { language: 'en' }
}))

import * as vscode from 'vscode'
import { detectLang, detectEnvLang, getMessages, t, setLangOverride } from '../i18n/index.js'

function setLang(lang: string): void {
  Object.defineProperty(vscode.env, 'language', { value: lang, configurable: true })
}

describe('detectLang', () => {
  let originalLang: string
  beforeEach(() => {
    originalLang = vscode.env.language
    // override 是模块级共享变量,每个 case 前显式清零,避免 case 之间污染
    setLangOverride(undefined)
  })
  afterEach(() => {
    setLang(originalLang)
    setLangOverride(undefined)
  })

  it('zh-cn → zh', () => {
    setLang('zh-cn')
    expect(detectLang()).toBe('zh')
  })

  it('zh-tw → zh (繁中也走中文分支)', () => {
    setLang('zh-tw')
    expect(detectLang()).toBe('zh')
  })

  it('en → en', () => {
    setLang('en')
    expect(detectLang()).toBe('en')
  })

  it('en-us → en', () => {
    setLang('en-us')
    expect(detectLang()).toBe('en')
  })

  it('ja-jp → en (fallback)', () => {
    setLang('ja-jp')
    expect(detectLang()).toBe('en')
  })
})

describe('detectLang override (08-23 ui-lang-toggle)', () => {
  let originalLang: string
  beforeEach(() => {
    originalLang = vscode.env.language
    setLangOverride(undefined)
  })
  // 跟第一个 describe 块对齐:env.language 在每个 case 末尾还原成进入 case 前的值,
  // 避免 4 个 override test 把 env 留在不确定状态 (zh-cn / en 交替),让后续依赖
  // vscode.env.language 的测试随顺序 flaky。setLangOverride 也要清 —— 模块级共享变量。
  afterEach(() => {
    setLang(originalLang)
    setLangOverride(undefined)
  })

  it('override 优先于 vscode.env.language', () => {
    setLang('zh-cn')  // env = zh
    setLangOverride('en')
    expect(detectLang()).toBe('en')
  })

  it('override 设为 undefined 回落到 env', () => {
    setLang('zh-cn')
    setLangOverride('en')
    expect(detectLang()).toBe('en')
    setLangOverride(undefined)
    expect(detectLang()).toBe('zh')
  })

  it('override 与 t() 联动 (LangStore.set 流程)', () => {
    setLang('en')  // env = en
    setLangOverride('zh')
    // 直接调 t() 不传 lang,应走 detectLang → override → zh
    expect(t('status.label.waiting')).toBe('等待权限')
    setLangOverride(undefined)
    expect(t('status.label.waiting')).toBe('Waiting')
  })

  it('t() 显式 lang 仍优先于 override (保留现有语义)', () => {
    setLang('en')
    setLangOverride('zh')
    // 显式传 lang 跳过 detectLang,override 不影响此路径
    expect(t('status.label.waiting', 'en')).toBe('Waiting')
  })
})

describe('detectEnvLang (08-25 fix-i18n-lang-bugs)', () => {
  let originalLang: string
  beforeEach(() => {
    originalLang = vscode.env.language
    setLangOverride(undefined)
  })
  afterEach(() => {
    setLang(originalLang)
    setLangOverride(undefined)
  })

  it('zh-cn → zh', () => {
    setLang('zh-cn')
    expect(detectEnvLang()).toBe('zh')
  })

  it('en-us → en', () => {
    setLang('en-us')
    expect(detectEnvLang()).toBe('en')
  })

  it('ja-jp → en (fallback)', () => {
    setLang('ja-jp')
    expect(detectEnvLang()).toBe('en')
  })

  it('不读 override (env=en 但 override=zh 仍返回 en)', () => {
    setLang('en')
    setLangOverride('zh')
    expect(detectEnvLang()).toBe('en')
  })

  it('不读 override (env=zh 但 override=undefined 仍返回 zh)', () => {
    setLang('zh-cn')
    // setLangOverride(undefined) 已经在 beforeEach 调用
    expect(detectEnvLang()).toBe('zh')
  })
})

describe('getMessages', () => {
  it('zh 返回的 message 表包含中文 key', () => {
    const m = getMessages('zh')
    expect(m['status.label']).toBe('CTM')
    expect(m['notify.action.openProject']).toBe('打开项目')
  })

  it('en 返回的 message 表包含英文 key', () => {
    const m = getMessages('en')
    expect(m['status.label']).toBe('CTM')
    expect(m['notify.action.openProject']).toBe('Open Project')
  })
})

describe('t() 占位符 + lang override', () => {
  // 测试用显式 lang 覆盖,不依赖 vscode.env.language
  it('zh 模式渲染中文 + 替换 {0}', () => {
    expect(t('notify.single', 'proj-a', 'Bash', 'zh')).toBe('proj-a 等待权限确认：Bash')
  })

  it('en 模式渲染英文 + 替换 {0}', () => {
    expect(t('notify.single', 'proj-a', 'Bash', 'en')).toBe('proj-a waiting for permission: Bash')
  })

  it('多占位符按 {0} {1} {2} 顺序替换 (lang 放最后)', () => {
    expect(t('notify.aggregate.long', 5, 'a, b, c', 2, 'en')).toBe('5 sessions waiting: a, b, c and 2 more')
  })

  it('缺失 key:返回 key 本身 (UI 显示原始 key 便于发现),console.warn 一次', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = t('nonexistent.key', 'en')
    expect(result).toBe('nonexistent.key')
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('占位符缺失对应参数 → 保留 {N} 占位符', () => {
    expect(t('notify.single', 'only-zero', 'en')).toBe('only-zero waiting for permission: {1}')
  })

  it('zh 与 en 同 key 文案不同 (sanity check,避免两份文案意外同步成同一份)', () => {
    expect(t('notify.action.openProject', 'zh')).not.toBe(t('notify.action.openProject', 'en'))
  })

  it('lang 出现在任何位置都会被识别 (扫所有 args,遇到 zh/en 就设为 lang)', () => {
    // 实际实现:遍历 args,遇到 'zh'/'en' 就吞为 lang,其他视为占位符
    // 这种"宽松"识别比"必须放最后"更易用 —— caller 不用记顺序
    // 但要注意:如果某个文案真的想传 'en' 作占位符,就会被误吞 (边界 case,生产中不会出现)
    const result = t('notify.single', 'en', 'Bash')
    expect(result).toBe('Bash waiting for permission: {1}')
  })
})

describe('i18n key 对称性', () => {
  it('en 和 zh 的 key 集合完全一致 (防止后续单边加 key)', async () => {
    const { en } = await import('../i18n/messages/en.js')
    const { zh } = await import('../i18n/messages/zh.js')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('activation pattern (08-26, FR3)', () => {
  let originalLang: string
  beforeEach(() => {
    originalLang = vscode.env.language
    setLangOverride(undefined)
  })
  afterEach(() => {
    setLang(originalLang)
    setLangOverride(undefined)
  })

  it('setLangOverride(undefined) + env=en → detectLang returns en', () => {
    setLang('en')
    setLangOverride(undefined)              // simulates extension.ts:83 with pref='auto'
    expect(detectLang()).toBe('en')
  })

  it('setLangOverride(undefined) + env=zh → detectLang returns zh', () => {
    setLang('zh-cn')
    setLangOverride(undefined)
    expect(detectLang()).toBe('zh')
  })

  it('activation with invalid cfg normalizes through langStore.get() (08-27, FR1)', async () => {
    setLang('en')
    // 08-28 F3:挡 LangStore 构造器的 warn 落到 vitest stderr
    // (复刻 langStore.test.ts:160-186 的 spy/mockRestore 范式)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { LangStore } = await import('../util/langStore.js')
      const langStore = new LangStore('fr' as unknown as ConstructorParameters<typeof LangStore>[0])
      expect(langStore.get()).toBe('auto')
      // Activation 模式 (FR1 后):读 langStore.get() 而非 raw langPref
      const effective = langStore.get()
      setLangOverride(effective === 'auto' ? undefined : effective)
      // setLangOverride 写入 undefined → detectLang 回落 env
      expect(detectLang()).toBe('en')
    } finally {
      warnSpy.mockRestore()
    }
  })
})
