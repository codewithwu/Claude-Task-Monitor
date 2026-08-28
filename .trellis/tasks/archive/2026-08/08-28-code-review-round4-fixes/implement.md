# Implement — 4 /code-review @src/ findings fixes

## 顺序

按依赖排：F1（helper 改进）→ F4（依赖 F1 的新分支正确性）→ F2（LangToggle fail-soft）→ F3（测试 spy）→ 验证。

F1 和 F2 之间无依赖；F4 假设 F1 已合并（否则 `{ message: 'x' }` 仍 `'[object Object]'`）。F3 独立。

## 步骤

### Step 1: F1 — `src/util/formatError.ts`

- Edit `formatErrorMessage`：加 duck-typed `.message` 分支
- Edit 文件头注释：删掉"两条分支都走 String() 兜底"那句，改成"三段优先级：Error → duck-typed object.message → String() 兜底"

### Step 2: F1 test — `src/test/formatError.test.ts`

- Edit line 9 把期望值从 `'[object Object]'` 改成 `'string-coerced'`
- Edit 同 case 的注释
- 跑 `pnpm test src/test/formatError.test.ts` 单测验证

### Step 3: F4 — `src/extension.ts:495-497`

- Edit catch 块用 `formatErrorMessage(e)`
- `formatErrorMessage` 已在 import 列表（line 29）

### Step 4: F2 — `src/ui/langToggle.ts`

- Edit constructor：删 throw，改 console.warn
- Edit render()：加 `if (!isLangPref(raw))` 分支显示 `?` + invalid tooltip
- Edit 文件头注释块说明新策略

### Step 5: F2 i18n key — 找 i18n 翻译表（`src/i18n/messages.ts` 或 `src/i18n/index.ts`）

- 用 `grep -rn 'lang.toggle.tooltip' src/i18n/` 定位
- 新增 `'lang.toggle.invalid': { zh: '语言偏好无效: {0}', en: 'Invalid language preference: {0}' }`

### Step 6: F3 — `src/test/i18n.test.ts`

- Edit line 223 那个 `it(...)`：在 body 起始 `vi.spyOn(console, 'warn').mockImplementation(() => {})`，body 末尾 `spy.mockRestore()`
- 删 line 225 注释里"warn suppressed by vi.spyOn if needed"那句（已实施）

### Step 7: 验证

```bash
pnpm test
pnpm build     # 或 pnpm type-check / pnpm lint,看 package.json scripts
```

预期：
- formatError.test.ts: 旧 9 个 case → 8 个不变 + 1 个期望值更新，全 pass
- langStore.test.ts: 不动
- i18n.test.ts: 不再泄漏 warn 到 stderr
- 所有现有测试 green

## 验证检查清单

- [ ] `formatErrorMessage({ message: 'Config is system-controlled' })` === `'Config is system-controlled'`
- [ ] `formatErrorMessage({ message: null })` === `'[object Object]'`（不变）
- [ ] `formatErrorMessage(new Error('x'))` === `'x'`（不变）
- [ ] `formatErrorMessage(null)` === `'null'`（不变）
- [ ] `new LangToggle(() => 'fr' as unknown as LangPref)` 不抛 + warn 1 次
- [ ] 在 invalid 状态下 `render()` 显示 `$(globe) ?` + invalid tooltip
- [ ] `extension.ts` 全 catch 块都走 `formatErrorMessage`（grep `catch \(` 后跟 `console.warn` 行）
- [ ] `pnpm test` 输出无 `[claude-task-monitor] LangStore: invalid pref "fr"...`
- [ ] `pnpm test` 全绿
- [ ] `pnpm build` 绿（如有 build 脚本）

## Commit plan

1 commit（"fix(i18n): address 4 round-4 code-review findings"）— 4 个改动互相内聚，都是 round-4 /code-review 的修复，分多个 commit 会让 reviewer 看不出关联。

如 review 要求分拆可拆：
- F1 单 commit（"fix(formatError): extract duck-typed .message from non-Error rejects"）
- F2 单 commit（"refactor(langToggle): fail-soft on invalid pref instead of throwing"）
- F3 单 commit（"test(i18n): suppress LangStore warn leak in activation test"）
- F4 单 commit（"refactor(extension): route deactivate() uninstall catch through formatErrorMessage"）

## 风险 & 回滚

- **F1 风险**：把 `{ message: 'string' }` 从 `'[object Object]'` 改成 `'string'`，**如果有 call site 依赖"[object Object]"作为非法信号**（基本不会，但理论存在）→ 影响 toast 文案；用户可见但不是崩溃
- **F2 风险**：从 fail-loud 变 fail-soft，LangStore 数据边界回归不再让 extension 整体崩溃 → 这是设计选择，但意味着"LangStore 校验回归"会变得悄无声息（除非有 i18n key 出现）
- **F3 / F4 风险**：纯测试 / 一行改，几乎无风险

回滚：单个 commit revert 即可。
