# fix: address 5 high/medium code-review findings (audit round 5)

## Goal

5 个并行子代理对 `src/` 全量扫描产出 36 条 finding；用户按 ROI 选定 5 条修复：

1. **formatError.ts:30** — duck-typed 分支空串透传（违反文件头契约）
2. **treeDataProvider.ts:102** — tooltip markdown 注入（用户输入未转义，安全洞）
3. **watcher.ts:77** — JSONL 截断后偏移量不重置，新内容永久丢失
4. **extension.ts:482** — `deactivate()` 等待模态对话框，卸载时阻塞扩展宿主
5. **i18n 硬编码 3 处** — `rowPresentation.ts:77` dying 前缀、`extension.ts:484` 卸载提示、`extension.ts:97` jq-missing toast

## Scope

### In scope

| # | Finding | 文件 | 类别 |
|---|---------|------|------|
| 1 | duck-typed `{message:string}` 分支无空串兜底 | `src/util/formatError.ts:30` | 契约 / 边界 |
| 2 | tooltip 把 `lastUserPrompt` / `currentTool.input` 拼进 `MarkdownString.appendMarkdown` 未转义 | `src/treeDataProvider.ts:102-116` | 安全 |
| 3 | JSONL `stat.size < offset` 时 early-return，偏移量不重置 | `src/watcher.ts:77` | 正确性 |
| 4 | `deactivate()` await 模态 InformationMessage，阻塞扩展宿主 | `src/extension.ts:482-498` | 生命周期 |
| 5a | `'已退出 · '` 硬编码中文，en 用户 UI 漏中文 | `src/util/rowPresentation.ts:77` | i18n |
| 5b | 卸载提示 + 「是/否」按钮硬编码中文 | `src/extension.ts:482-487` | i18n |
| 5c | jq-missing toast 硬编码中文 | `src/extension.ts:97-99` | i18n |

### Out of scope（明确排除）

- **`i18n/index.ts:68` lang-override footgun** —— `i18n.test.ts:94-100` 已显式断言其行为；改 API 是 invasive 且无生产路径触发。08-23 决策为 deliberate non-fix，本次延续。
- **agent 找出的 31 条 LOW/PLAUSIBLE finding**（死 key、测试覆盖 gap、watcher fs.openSync 在 try 外等）—— 不在 top-5 ROI，单独 task 跟踪。
- **`hook.install.ok` 与 `onboarding.toast.installed` 字符串重复**（en+zh 都中招）—— LOW，但与本次 i18n 改动紧邻、可以顺手 dedupe；**决定不做**，避免越界。
- **`detectJq` 无 timeout / kill**（installer.ts:82，LOW）—— 单列后续 task。

### Override 决策（覆盖前任务）

| 项 | 前任务决策 | 本次决策 | 理由 |
|---|---|---|---|
| `extension.ts:484` 卸载按钮「是/否」中文 | `08-23-fix-v020-leftovers` out of scope：「不顺手本地化会扩散 scope」 | **In scope** | 用户在 round-5 明确点名要修 |
| `extension.ts:97` jq-missing toast 中文 | 同上，列在「其他几处中文 toast」排除列表 | **In scope** | 同上，用户明确点名 |
| `rowPresentation.ts:77` dying 前缀中文 | 08-23 修了 status.label.* 三个 key 但漏了这个 | **In scope** | 是 08-23 修复的遗漏项，保持一致性 |

## Requirements

### Functional

- **R1**：`formatErrorMessage({ message: '' })` 返回非空字符串（与 `e.message || String(e)` 对齐）
- **R2**：tooltip 渲染的 `lastUserPrompt` / `currentTool.input` 中所有 markdown 语法（`[]()` `![]()` `#` `` ` `` 等）显示为字面字符，不被解释为链接 / 标题 / 代码块
- **R3**：JSONL 文件被截断后（`truncate -s N`、磁盘满回滚等），下一次 `change` 事件能从当前位置继续读，不永久丢失
- **R4**：`deactivate()` 不阻塞；VS Code 卸载/关闭扩展宿主时，hook 清理逻辑仍能在合理时间内执行（best-effort）
- **R5**：en 用户看到的所有 UI 文案、tooltip、按钮 label、toast 都不含中文；与现有 `status.label.*` / `notify.*` / `onboarding.*` i18n 体系一致
- **R6**：i18n key 在 en.ts 和 zh.ts 中键集合对称（继续通过 `i18n.test.ts` 的 symmetry 测试）

### Non-functional

- **NFR1**：改动不引入新依赖
- **NFR2**：`pnpm test` 全绿，新增测试用例遵循现有 vitest 模式（mock vscode 等）
- **NFR3**：`pnpm build` (tsup) 编译通过，无 TS error/warning
- **NFR4**：i18n 新 key 添加遵循 `<area>.<context>.<id>` 命名约定
- **NFR5**：commit 拆为 2 个原子 commit（核心 bug + i18n），便于 revert

## Acceptance Criteria

### 核心 bug 批

- [ ] `src/util/formatError.ts:30` duck-typed 分支改为 `return (e as { message: string }).message || String(e)`
- [ ] `src/test/formatError.test.ts` 新增 case：`{ message: '' }` 应返回非空字符串（具体期望值 `String({ message: '' })` 即 `'[object Object]'`，或与 Error 分支行为对齐的 `'[object Object]'`）
- [ ] `src/treeDataProvider.ts:102-116` `buildTooltip` 用 `MarkdownString.appendText` + 受控的 `appendMarkdown` 组合，确保 `lastUserPrompt` / `currentTool.input` 通过 `appendText` 渲染（不解释 markdown）；保留项目名 / 状态 / sessionId 用 `appendMarkdown` 渲染（这些是受控字符串）
- [ ] `src/treeDataProvider.ts` 添加单测 `src/test/treeDataProvider.test.ts`，验证包含 markdown 元字符的 `lastUserPrompt` 渲染后不被解释为链接（可选，若代价低）
- [ ] `src/watcher.ts:77` 当 `stat.size < offset` 时将 offset 重置为 `stat.size` 之前的有效位置（具体策略：`offsets.set(file, stat.size)` 然后继续读；或更保守：先 `offsets.delete(file)` 让下次 `change` 事件从 0 开始）。选择 **`offsets.set(file, stat.size)` + 继续读 0..stat.size**，因为我们已知 0..stat.size 的内容是新的；保留已经 emit 过的 `offset + consumed` 推进逻辑不变
- [ ] `src/test/watcher.test.ts` 新增 case：先 emit 几行 → truncate 文件 → 写新内容 → 验证新内容被读到
- [ ] `src/extension.ts:482` `deactivate()` 移除 `await`；改为 fire-and-forget，让 VS Code 强制关闭扩展宿主时清理逻辑不被丢弃；保留 try/catch 包裹 fs 操作，错误仍走 `console.warn` + `formatErrorMessage`

### i18n 批

- [ ] `src/i18n/messages/en.ts` + `zh.ts` 新增 `row.dying` key（值：en='Exited', zh='已退出'）
- [ ] `src/util/rowPresentation.ts:77` 改为 `const dyingPrefix = dying ? t('row.dying') + ' · ' : ''`
- [ ] `src/test/rowPresentation.test.ts`（若存在）新增 case：dying 时 description 含 `t('row.dying')` 字面值
- [ ] `src/i18n/messages/en.ts` + `zh.ts` 新增 `extension.uninstall.prompt` + `extension.uninstall.remove` + `extension.uninstall.keep` 三个 key
- [ ] `src/extension.ts:482-487` `deactivate()` 改为调用 `t(...)` 渲染提示和按钮（提示文本英中两个版本）
- [ ] `src/i18n/messages/en.ts` + `zh.ts` 新增 `extension.jqMissing` key（值：与原字符串语义一致的两语版本；保持 macOS/Debian 命令文本不翻译——它们是 shell 命令）
- [ ] `src/extension.ts:97-99` 改为 `void vscode.window.showErrorMessage(t('extension.jqMissing'))`
- [ ] `src/test/i18n.test.ts` 的 symmetry 测试继续通过（en 与 zh 键集合一致）

### 全局

- [ ] `pnpm test` 全绿，所有现有 + 新增测试用例 pass
- [ ] `pnpm build` 编译通过
- [ ] git log 显示 2 个原子 commit（核心 bug 批 + i18n 批）

## Notes

- **i18n spec 遵守**：`src/i18n/messages/{en,zh}.ts` 的 key 必须严格对称（已有 symmetry 测试强制）；命名遵循 `<area>.<context>.<id>`。具体新 key 列表见 acceptance criteria。
- **不动 deferred finding**：`t()` lang-override footgun 保持 deliberate non-fix；如需复盘，改 API 是后续 task。
- **安全修复策略**：`MarkdownString.appendText` 不解释 markdown 语法（仅作字面字符输出）；`appendMarkdown` 保留受控字串（项目路径 basename、状态标签、sessionId）的 markdown 格式（粗体、代码块）。
- **deactivate 非阻塞化权衡**：`await` 移除后用户点击「是」前 VS Code 可能已强制关闭扩展宿主；这是 VS Code 文档明示的限制（"deactivate must not block"），我们目前采用 fire-and-forget + best-effort fs cleanup，不引入「异步卸载队列」这类额外机制。
- **watcher 截断恢复策略**：选择「`offsets.set(file, stat.size)` 后继续读 0..stat.size」是因为：stat.size < offset 的真实场景是文件被截短后重新增长；从头读 0..stat.size 等价于「已知的新内容」，开销是单次小文件读。备选方案 `offsets.delete(file)` + 下次 change 从 0 读，多了一次事件循环延迟。