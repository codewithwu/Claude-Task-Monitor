# C1 — Bump version 0.3.3 → 0.3.4 + build package on main

## Goal

把 `fix/08-28-round4-i18n-review-fixes` 合并到 `main`,在 main 上完成 0.3.3 → 0.3.4
的版本 bump、CHANGELOG 更新、`.vsix` 构建,并 push commit + tag `v0.3.4` 到 origin。

## Pre-conditions

- 当前 working tree 干净(`release-0.3.3-notes.md` 是 workspace 笔记,不在 git
  tracked 列表里,合并前可以留着,合并后再决定是否要 archive)。
- origin 上 `main` 在 `76b04ba`,没有未拉取的提交。
- fix 分支 `fix/08-28-round4-i18n-review-fixes` HEAD = `4a5c81e`。

## Functional Requirements

### FR1 — Merge fix branch to main

- 切到 main:`git checkout main && git pull --ff-only origin main`。
- Merge:`git merge --no-ff fix/08-28-round4-i18n-review-fixes -m "merge: round-4 i18n code-review fixes"`。
  用 `--no-ff` 保留 fix 分支存在过的痕迹。
- 如果有冲突,停下,在 PRD 末尾留 TODO,等用户决策。

### FR2 — Tests + build sanity on main

- 跑 `pnpm test`(254/254 pass,源自 round 4 commit 的自检声明)。
- 跑 `pnpm build`(dist/extension.js 应该是上次 round 4 之后的产物)。
- 任一失败 → 不进入 FR3,留 TODO。

### FR3 — CHANGELOG `[0.3.4] - 2026-08-28` 段

- 在 `## [Unreleased]` 之后、`## [0.3.3]` 之前插入新段。
- 内容:从 round 4 commit message + 归档 prd.md 里提取 4 个 findings:
  - **F1**: `formatErrorMessage` 增加 duck-typed `{ message: string }` 分支,
    让受限 profile 下 `workspace.getConfiguration().update()` rejection
    不再渲染成 `[object Object]`。
  - **F2**: `LangToggle` 构造器对非法 pref 改 fail-soft(`console.warn` +
    渲染 `?` + invalid tooltip),不再因为 LangStore 一次数据边界回归
    把整个 extension 关掉。
  - **F3**: `i18n.test.ts` 在激活测试里 spy `console.warn` 并 restore,
    修复 vitest stderr 泄漏(`langStore.test.ts:160-186` 标准范式)。
  - **F4**: `extension.ts:deactivate()` 的 catch 也走 `formatErrorMessage`,
    完成 header comment 里的 "all catches covered" 承诺。
- 把 `[Unreleased]` 的 compare target 从 `v0.3.3...HEAD` 改成
  `v0.3.4...HEAD`。
- 文体与 [0.3.3] 段保持一致(中英混排、`### Fixed` + bullet + 子点)。

### FR4 — package.json version bump

- `"version": "0.3.3"` → `"version": "0.3.4"`。
- 其他字段不动。

### FR5 — Build `.vsix`

- 跑 `pnpm package`(script: `vsce package --no-dependencies && mkdir -p packages && mv *.vsix packages/`)。
- 期望产物:`packages/codewithwu-cn.claude-task-monitor-0.3.4.vsix`,size > 100 KB。
- 解压 / `vsce ls` 抽查 `package.json` 里的 `version` / `publisher` 字段:
  - `name`: `claude-task-monitor`
  - `publisher`: `codewithwu-cn`
  - `version`: `0.3.4`

### FR6 — Commit + tag + push

- 一个 commit,只动 `package.json` + `CHANGELOG.md`:
  - message: `chore: bump version 0.3.3 → 0.3.4 + CHANGELOG`
  - 风格对齐 `76b04ba`(0.3.3)、`d5a8922`(0.3.2)、`4cc58a2`(0.3.1)。
- Tag:`git tag -a v0.3.4 -m "v0.3.4"`(annotated,跟历史 `v0.3.3` 等保持一致)。
- Push:`git push origin main && git push origin v0.3.4`。
- tag 不落在 fix 分支;落在 main HEAD。

## Non-functional Requirements

- **NFR1**:本任务不动 `src/`(所有 src 改动已经在 `0a3dc0c` commit 里)。
- **NFR2**:`packages/*.vsix` 目录由 `.gitignore` 排除(.gitignore 已确认包含 `packages`),
  commit 里不会出现 vsix。
- **NFR3**:commit message 不含 token / 敏感信息。
- **NFR4**:`release-0.3.3-notes.md` 在 workspace,跟 git tracked 无关,
  本任务不主动处理(用户已经在 notes 里写了 0.3.3 摘要,不是 0.3.4)。

## Acceptance Criteria

- [ ] **AC1**:`main` 分支上 `git show HEAD:package.json | grep version` 输出
  `"version": "0.3.4"`。
- [ ] **AC2**:`CHANGELOG.md` 里 `## [0.3.4] - 2026-08-28` 段在
  `## [Unreleased]` 之后、`## [0.3.3]` 之前;`[Unreleased]` 的
  compare target = `v0.3.4...HEAD`。
- [ ] **AC3**:`packages/codewithwu-cn.claude-task-monitor-0.3.4.vsix` 存在,
  size > 100 KB;`unzip -p <vsix> extension/package.json | grep version`
  输出 `"version": "0.3.4"`。
- [ ] **AC4**:`pnpm test` 在 main 上 pass(round 4 自检 254/254)。
- [ ] **AC5**:`git log --oneline origin/main..main` 为空(本地 main
  已推到 origin);`git tag --list | grep '^v0.3.4$'` 命中;
  `git ls-remote origin refs/tags/v0.3.4` 也命中。
- [ ] **AC6**:本任务产生的 commit message 严格等于
  `chore: bump version 0.3.3 → 0.3.4 + CHANGELOG`。
- [ ] **AC7**:`fix/08-28-round4-i18n-review-fixes` 仍然存在
  (`git branch --list` 命中),但 main HEAD 不再指向它。

## Out of Scope

- `vsce publish` 到 VS Code marketplace。
- Open VSX publish(子任务 C2 负责)。
- GitHub release 创建(子任务 C3 负责)。
- 删 `fix/08-28-round4-i18n-review-fixes` 分支(留着等 round 5 / 复盘用)。
- 改 `displayName` / `description` / `package.nls.*`。

## Rollback

- `git reset --hard origin/main` 把本地 main 退回合并前。
- `git tag -d v0.3.4 && git push origin :v0.3.4` 撤回 tag。
- CHANGELOG 段落 / `package.json` 改动随 `git reset` 一起撤回。
- 已经在 origin 上的 commit 用 `git revert <bump-commit>` 反做。