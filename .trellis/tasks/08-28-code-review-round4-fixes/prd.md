# 08-28 /code-review @src/ — 4 findings fixes (round 4 i18n/error-formatting)

## Goal

修复 `/code-review @src/` 命中的 4 个 verified findings，全部围绕 "i18n + error formatting" 收尾。

痛点来源：用户/受限 profile 触发错误时 toast 文案丢失原始信息（`[object Object]`）；LangToggle 防御性 throw 把 LangStore 的数据边界责任上行到了 UI 层；单测与生产路径对 `console.warn` 处理不一致；`deactivate()` 唯一一条没走 helper 的 catch。

## Findings

| # | File | 严重度 | 概要 |
|---|---|---|---|
| F1 | `src/util/formatError.ts:21` | High | `formatErrorMessage` 只判 `instanceof Error`，duck-typed `.message` 永远进 `String(e)='[object Object]'` |
| F2 | `src/ui/langToggle.ts:36` | Medium | 构造器 throw 把一次 LangStore 回归放大成 extension 整体无法激活 |
| F3 | `src/test/i18n.test.ts:223` | Low | 构造 `LangStore('fr', ...)` 时缺 `vi.spyOn(console, 'warn')`，泄漏 warn 到 vitest stderr |
| F4 | `src/extension.ts:495-497` | Low | `deactivate()` 的 catch 是 extension.ts 唯一一条没迁移到 `formatErrorMessage` 的 catch |

## Requirements

### F1: formatErrorMessage duck-typed .message

- 增加分支：`!e instanceof Error && typeof e === 'object' && e !== null && typeof (e as any).message === 'string'` 时返回 `(e as any).message`
- 保持 `instanceof Error` 优先（Error 的 `.message` 已经覆盖）
- 保持 `String(e)` 兜底
- `null`/`undefined`/`message: null`/`message: undefined` 行为不变（仍走 `String(e)`）
- 更新文件头注释以反映实际行为
- 更新 `src/test/formatError.test.ts` 里把 `{ message: 'string-coerced' }, '[object Object]'` 改成期望 `'string-coerced'`

### F2: LangToggle fail-soft（用户已选 fail-soft）

- 构造器收到非法 pref 时**不再 throw**，改为 `console.warn` 一次
- 保留 `raw` 字段在私有状态；`render()` 检测到非合法 pref 时：
  - 文本显示 `$(globe) ?`
  - tooltip 描述状态：`t('lang.toggle.invalid', String(raw))`（需要新增 i18n key）
- 下次 `cycle()` 写 config 时由 LangStore 自我修复；extension.ts 的 onDidChangeConfiguration 监听器再 render 一次回到正常 UI
- 更新文件头注释块说明新策略

### F3: i18n.test.ts suppress warn leak

- 在 `new LangStore('fr' as unknown as ...)` 前 `vi.spyOn(console, 'warn').mockImplementation(() => {})`
- 测试末尾 `spy.mockRestore()`
- 复刻 `src/test/langStore.test.ts:160-186` 的标准范式

### F4: extension.ts deactivate() 走 helper

- `extension.ts:496` 改成 `console.warn('[claude-task-monitor] uninstall failed:', formatErrorMessage(e))`
- `formatErrorMessage` import 已在 `extension.ts:29`，无需新增 import

## Acceptance Criteria

- [ ] F1: `formatErrorMessage({ message: 'Config is system-controlled' })` 返回 `'Config is system-controlled'`
- [ ] F1: `formatErrorMessage({ message: null })` 仍返回 `'[object Object]'`（不变）
- [ ] F1: `formatErrorMessage(new Error('boom'))` 仍返回 `'boom'`（不变）
- [ ] F1: `formatErrorMessage(null)` / `formatErrorMessage(undefined)` 仍返回 `'null'` / `'undefined'`（不变）
- [ ] F1: `src/test/formatError.test.ts` 现有 9 个 case 全部 pass；其中 `{ message: 'string-coerced' }` 期望更新为 `'string-coerced'`
- [ ] F2: `new LangToggle(() => 'fr' as unknown as LangPref)` **不抛**，且 `console.warn` 被调用一次
- [ ] F2: 在 F2 状态下调用 `render()` 不抛，tooltip 文案带原始 raw
- [ ] F2: `extension.ts` `new LangToggle(...)` 仍在 `activate()` 里，但不再会因为 pref 非法让 extension 加载失败
- [ ] F3: `pnpm test` 输出不再包含 `[claude-task-monitor] LangStore: invalid pref "fr"...` 字样
- [ ] F3: `src/test/i18n.test.ts` 在 `LangStore` 构造前后 spy / restore 完整
- [ ] F4: `src/extension.ts:495-497` 的 catch 块使用 `formatErrorMessage(e)`
- [ ] F4: `formatErrorMessage` 在 `extension.ts` 全文 catch 块覆盖率 100%（grep `catch (` + `console.warn` 验证）
- [ ] 所有改动：`pnpm test` green，`pnpm build` green（按实际可用命令）

## Notes

- **F2 的 i18n key**：`lang.toggle.invalid` 需在 `src/i18n/messages.ts`（或对应 i18n 表）登记，新增 zh/en 翻译。例：
  - zh: `语言偏好无效: {0}`
  - en: `Invalid language preference: {0}`
- **Scope guard**：本 task 不动 LangStore 的 invariant（`'auto'` fallback 是数据边界责任）。F2 是 UI 兜底，LangStore 仍然必须 normalize。
- **No new dependencies**。
- 涉及文件：4 + 1 (i18n messages) + 1 (formatError test) = 6 个文件
