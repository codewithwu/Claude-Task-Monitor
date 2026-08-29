# C1 — Bump version 0.3.4 → 0.3.5 + build package on main

## Goal

在 main 分支上完成 round-5 audit 修复的 release 打包:`CHANGELOG` `[Unreleased]`
段写满、`package.json` 0.3.4 → 0.3.5、`.vsix` 构建、commit + tag `v0.3.5` +
push commit 和 tag 到 origin。

## Pre-conditions

- 当前 working tree 干净(只多出 4 个新 `.trellis/tasks/08-29-*` 目录,本任务
  结束后 archive 即可)。
- origin 上 `main` 在 `31380f0`,没有未拉取的提交。
- `pnpm test` 在 main 上 pass(round-5 自检 260/260,源自
  `9ae6ae1` + `ce29ef7` commit message 声明)。

## Functional Requirements

### FR1 — Tests + build sanity on main

- 跑 `pnpm test`:期望 260/260 pass。
- 跑 `pnpm build`:期望 `dist/extension.js` 生成成功。
- 任一失败 → 不进入 FR2,留 TODO。

### FR2 — CHANGELOG `[0.3.5] - 2026-08-29` 段

- 在 `## [Unreleased]` 之后、`## [0.3.4]` 之前插入新段。
- 把 `[Unreleased]` 的内容(`## [Unreleased]` 标题 + 紧跟的空白)整体替换为
  新段;replaced 段落到 `[0.3.5]` 头部。
- 内容:3 个 src/ commit + 1 个 docs commit 的摘要,**不**收
  `31380f0 chore(task): archive 08-29-audit-fixes-r5`(纯 task archive):

  - **F1 (commit `9ae6ae1`)** — audit-r5: 3 core bugs
    - `src/util/formatError.ts:30` duck-typed `{message: ''}` 分支
      返回空串违反文件头 "每一段都保证 t() 拿到非空字符串" 契约;补
      `|| String(e)` 兜底 + formatError.test.ts 新增
      `[{message: ''} → '[object Object]']` 用例。
    - `src/watcher.ts:77` JSONL truncation (`stat.size < offset`) 早退
      没更新 offsets map,导致 truncate + append 后旧 offset 留在 map
      里下次 size===offset 仍早退;改成同时重置 local var 和 map entry
      到 0 + watcher.test.ts 新增 truncateSync+append 用例。
    - `src/ui/treeDataProvider.ts:102` buildTooltip 用
      `MarkdownString.appendMarkdown` 渲染非受信用户输入
      (`lastUserPrompt`、`currentTool.input`),`[Click](https://evil)`
      会渲染成可点链接;切换到 `appendText`(literal chars,不解析
      markdown)。受控字符串(basename / statusLabel / sessionId /
      cwd code block)继续走 appendMarkdown;新增 treeDataProvider.test.ts
      用 `vi.mock'd MarkdownString` spy `appendText` vs `appendMarkdown`
      调用。

  - **F2 (commit `ce29ef7`)** — i18n: 3 hardcoded Chinese strings
    - `src/ui/rowPresentation.ts:77` dyingAt 行描述前缀硬编码 `'已退出 · '`,
      en 用户看到中文;新增 `status.dying` i18n key(en: `'Exited'`,
      zh: `'已退出'`)。
    - `src/extension.ts:482` `deactivate()` uninstall 确认 prompt + `'是/否'`
      按钮硬编码中文;新增 `extension.uninstall.{prompt, remove, keep}`
      keys。**同步修 blocking-modal bug**:`async/await` 改成
      fire-and-forget `.then()`,VS Code deactivate 不应 await 交互
      UI,避免 extension host 关闭卡住导致 uninstall cleanup 丢失。
    - `src/extension.ts:97` activate-time jq-missing toast 硬编码中文;
      新增 `extension.jqMissing` key。shell commands (brew/apt) 不翻译
      (是命令标识符不是文案)。
    - **Override note**: items 2、3 之前在 `08-23-fix-v020-leftovers` 中
      主动 deferred,本次按 round-5 priority list 显式 override。

  - **F3 (commit `a6cb01f`)** — spec: 把 round-5 audit 发现的两条 pattern
    落进 spec 文档(无 src 改动)
    - `.trellis/spec/ingest.md` — Watcher.readNew truncation recovery:
      `stat.size < offset` 时同时重置 local offset AND offsets map
      entry 到 0;只更新 local var 不够,map 跨 change event 持久,
      下次 append 仍 size===offset 早退。
    - `.trellis/spec/lifecycle.md` — MarkdownString.appendText vs
      appendMarkdown 边界:受控字符串(basename / statusLabel /
      sessionId)继续 appendMarkdown;非受信 hook payload 字符串
      (`lastUserPrompt`、`currentTool.name`、`currentTool.input`)
      必须 appendText,不解析 markdown 语法,防止 link/image 注入。

- 文风与 `[0.3.4]` 段保持一致(中英混排、`### Fixed` / `### Docs`
  + bullet + 子点,commit 引用 `(commit \`xxx\`)` 格式)。

### FR3 — package.json version bump

- `"version": "0.3.4"` → `"version": "0.3.5"`。
- 其他字段不动。

### FR4 — Build `.vsix`

- 跑 `pnpm package`(script: `vsce package --no-dependencies && mkdir -p packages && mv *.vsix packages/`)。
- 期望产物:`packages/codewithwu-cn.claude-task-monitor-0.3.5.vsix`,size > 100 KB。
- 解压 / `vsce ls` 抽查 `package.json` 里的 `version` / `publisher` 字段:
  - `name`: `claude-task-monitor`
  - `publisher`: `codewithwu-cn`
  - `version`: `0.3.5`

### FR5 — Commit + tag + push

- 一个 commit,只动 `package.json` + `CHANGELOG.md`:
  - message: `chore: bump version 0.3.4 → 0.3.5 + CHANGELOG`
  - 风格对齐 `0a2d6fc`(v0.3.3)、`76b04ba`(v0.3.3 bump)、`6371d2f`(v0.3.4)。
- Tag:`git tag -a v0.3.5 -m "v0.3.5"`(annotated,跟历史 `v0.3.4` 等保持一致)。
- Push:`git push origin main && git push origin v0.3.5`。
- tag 落在 main HEAD(`bump-commit` 的 SHA)。

### FR6 — Task archive

- 本任务自己的目录从 `.trellis/tasks/08-29-bump-and-build-0.3.5/` 移到
  `.trellis/tasks/archive/2026-08/08-29-bump-and-build-0.3.5/`。
- 一个 commit,只动 archive 路径(保留 prd.md + task.json +
  implement.jsonl + check.jsonl):
  - message: `chore(task): archive 08-29-bump-and-build-0.3.5`
- Push:`git push origin main`。

## Non-functional Requirements

- **NFR1**:本任务不动 `src/`(所有 src 改动已经在 3 个 fix commit 里)。
- **NFR2**:`packages/*.vsix` 由 `.gitignore` 排除,commit 里不会出现 vsix。
- **NFR3**:commit message 不含 token / 敏感信息。
- **NFR4**:task archive 是单独 commit(不在 bump commit 里),跟历史
  `3bf939e` (08-28-bump-and-build) pattern 一致。

## Acceptance Criteria

- [ ] **AC1**:`main` HEAD 上 `git show HEAD:package.json | grep version` 输出
  `"version": "0.3.5"`。
- [ ] **AC2**:`CHANGELOG.md` 里 `## [0.3.5] - 2026-08-29` 段在
  `## [0.3.4]` 之前;`[Unreleased]` 段保持为空(已被本任务搬到
  `[0.3.5]`)。
- [ ] **AC3**:`packages/codewithwu-cn.claude-task-monitor-0.3.5.vsix` 存在,
  size > 100 KB;`unzip -p <vsix> extension/package.json | grep version`
  输出 `"version": "0.3.5"`。
- [ ] **AC4**:`pnpm test` 在 main 上 pass(260/260)。
- [ ] **AC5**:`git log --oneline origin/main..main` 为空(本地 main
  已推到 origin);`git tag --list | grep '^v0.3.5$'` 命中;
  `git ls-remote origin refs/tags/v0.3.5` 也命中。
- [ ] **AC6**:本任务产生的 bump commit message 严格等于
  `chore: bump version 0.3.4 → 0.3.5 + CHANGELOG`。
- [ ] **AC7**:archive commit message 严格等于
  `chore(task): archive 08-29-bump-and-build-0.3.5`;本任务目录
  路径 = `.trellis/tasks/archive/2026-08/08-29-bump-and-build-0.3.5/`。

## Out of Scope

- `vsce publish` 到 VS Code marketplace(用户不在 marketplace 发布)。
- Open VSX publish(子任务 C2 负责)。
- GitHub release 创建(子任务 C3 负责)。
- 改 `displayName` / `description` / `package.nls.*`。

## Rollback

- 本地未 push:`git reset --hard origin/main` 退回合并前。
- tag push 后需要撤回:`git tag -d v0.3.5 && git push origin :v0.3.5`。
- CHANGELOG 段落 / `package.json` 改动随 `git reset` 一起撤回。
- archive 撤回:`mv .trellis/tasks/archive/2026-08/08-29-bump-and-build-0.3.5 .trellis/tasks/`
  + `git reset --hard HEAD~1`。
