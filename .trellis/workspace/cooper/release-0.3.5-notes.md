## v0.3.5 — audit-r5 fixes

Round-5 comprehensive src/ audit (5 parallel agents) + 3 hardcoded Chinese strings cleanup + spec docs codification.

### Fixed (commits 9ae6ae1 + ce29ef7)

- **formatError empty-string fallback** (`src/util/formatError.ts`): duck-typed `{message: ''}` 分支
  返回空串违反文件头 "每一段都保证 t() 拿到非空字符串" 契约;补 `|| String(e)` 兜底,
  `String({message: ''}) === '[object Object]'`,既非空也携带可读线索。
  新增 `formatError.test.ts` 用例 `[{message: ''} → '[object Object]']`。

- **Watcher truncation recovery** (`src/watcher.ts`): JSONL truncation (`stat.size < offset`)
  早退没更新 offsets map,truncate + append 后下次 `size === offset` 仍命中早退;
  改成同时重置 local var 和 map entry 到 0。
  新增 `watcher.test.ts` 用例 `truncateSync+append`。

- **Tooltip markdown injection** (`src/ui/treeDataProvider.ts`): buildTooltip 用
  `MarkdownString.appendMarkdown` 渲染非受信用户输入 (`lastUserPrompt`,
  `currentTool.input`),`[Click](https://evil)` 渲染成可点链接;
  切换到 `appendText`(literal chars,不解析 markdown)。
  受控字符串(basename / statusLabel / sessionId / cwd code block)继续走
  `appendMarkdown`。新增 `treeDataProvider.test.ts` 用 `vi.mock'd MarkdownString`
  spy `appendText` vs `appendMarkdown` 调用。

- **dyingAt row hardcoded Chinese** (`src/ui/rowPresentation.ts`): `'已退出 · '` 改
  i18n key `status.dying`(en: `'Exited'`、zh: `'已退出'`)。
  `rowPresentation.test.ts` `dyingAt 有值` 用例继续在 zh-cn mock 下 pass。

- **deactivate uninstall prompt hardcoded Chinese** (`src/extension.ts`):
  新增 `extension.uninstall.{prompt, remove, keep}` keys。**同步修 blocking-modal bug**:
  `async/await` 改成 fire-and-forget `.then()`,VS Code deactivate 不应 await 交互 UI,
  避免 extension host 关闭卡住导致 uninstall cleanup 丢失。

- **jq-missing toast hardcoded Chinese** (`src/extension.ts`):
  新增 `extension.jqMissing` key。shell 命令(brew / apt)不翻译。

### Docs (commit a6cb01f)

- `.trellis/spec/ingest.md` 落 Watcher.readNew truncation recovery 契约:
  `stat.size < offset` 时同时重置 local offset AND offsets map entry 到 0;
  map 跨 change event 持久,只更新 local var 不够。

- `.trellis/spec/lifecycle.md` 落 MarkdownString.appendText vs appendMarkdown 边界:
  受控字符串(basename / statusLabel / sessionId)继续 appendMarkdown;
  非受信 hook payload 字符串(`lastUserPrompt`、`currentTool.name`、`currentTool.input`)
  必须 appendText,不解析 markdown 语法,防止 link / image 注入。

### Override note

i18n 的 uninstall prompt + jq-missing toast 之前在 `08-23-fix-v020-leftovers` 中
主动 deferred,本次按 round-5 priority list 显式 override。

### Testing

- `pnpm test`: 260/260 pass(round-5 自检)。
- `pnpm build`: green,`dist/extension.js` 241.01 KB。

### Install / Upgrade

- Open VSX:已发布到 `codewithwu-cn/claude-task-monitor@0.3.5`。
- GitHub:见下方 `.vsix` asset,可手动安装。