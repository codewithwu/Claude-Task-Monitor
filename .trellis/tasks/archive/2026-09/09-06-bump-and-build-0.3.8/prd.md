# C1 — Bump version + build 0.3.8 .vsix

## Goal

完成 v0.3.8 release 的本地物料:CHANGELOG 段、`package.json` version bump、`.vsix` 构建、`git commit` + `git tag v0.3.8` + push 到 origin。

## Pre-conditions

- Parent `09-06-release-v0.3.8` 已 active。
- 当前 `main` HEAD 包含本 release 的 2 个 commit(`e06da35` feat + `6569479` docs);无未提交工作(`git status` clean)。
- `pnpm` + `vsce` 在 PATH 上;`pnpm install` 已跑过(`node_modules/` 在)。

## Functional Requirements

### FR1 — CHANGELOG entry

- `CHANGELOG.md` 当前 `## [Unreleased]` 段(空)替换为 `## [0.3.8] - 2026-09-06`。
- 新 `## [Unreleased]` 段插回,保持空(无新增内容预留)。
- 段格式参照 `[0.3.6] / [0.3.7]`(`### Added` / `### Fixed` 子标题 + commit/task 引用)。
- 内容:**sidebar focus terminal**(commit `e06da35`,closes improvement-backlog #4 P1)。
- spec doc `6569479` 不进 CHANGELOG(纯 docs,无 user-visible 行为变化)。

### FR2 — package.json version bump

- `"version": "0.3.7"` → `"version": "0.3.8"`。
- 唯一改动字段;不改 `displayName` / `description` / `publisher` / `engines` 等。

### FR3 — Build .vsix

- 命令:`pnpm package`(即 `vsce package --no-dependencies && mkdir -p packages && mv *.vsix packages/`,见 `package.json` `scripts.package`)。
- 产物:
  - `packages/claude-task-monitor-0.3.8.vsix`(旧 naming,无 publisher 前缀;vsce 默认输出)
  - `packages/codewithwu-cn.claude-task-monitor-0.3.8.vsix`(publisher-prefixed,历史命名;`vsce` 通过 `--packageName` 或后续 `mv` 都能产生,本次按 0.3.5 / 0.3.6 / 0.3.7 已有产物对齐)
- 验证:`ls -la packages/*0.3.8*.vsix` 命中 2 个文件。

### FR4 — Commit + tag + push

- `git add CHANGELOG.md package.json`(只这两个文件;`.vsix` 被 `.gitignore` 排除)。
- `git commit -m "chore(release): bump version to 0.3.8"`。
- `git tag v0.3.8`(无前缀,与历史一致)。
- `git push origin main` + `git push origin v0.3.8`。
- 退出码 0 视为成功。

## Non-functional Requirements

- **NFR1**:`OVSX_PAT` / 任何 token 不进 commit message。
- **NFR2**:`packages/*.vsix` 不进 git(`.gitignore` 已覆盖,确认不变)。
- **NFR3**:commit message 用英文(项目历史约定,见 0.3.5 / 0.3.6 / 0.3.7 的 `chore(release): bump version to X.Y.Z`)。

## Acceptance Criteria

- [ ] **AC1**:`CHANGELOG.md` 顶部是 `## [Unreleased]`(空)+ `## [0.3.8] - 2026-09-06` + focus-terminal 内容。
- [ ] **AC2**:`package.json` `version` = `0.3.8`。
- [ ] **AC3**:`packages/claude-task-monitor-0.3.8.vsix` 与 `packages/codewithwu-cn.claude-task-monitor-0.3.8.vsix` 双双存在。
- [ ] **AC4**:`git log -1 --format=%s` = `chore(release): bump version to 0.3.8`。
- [ ] **AC5**:`git tag --list | grep '^v0.3.8$'` 命中本地。
- [ ] **AC6**:`git ls-remote origin refs/tags/v0.3.8` 命中 origin。
- [ ] **AC7**:`git status` clean;`git log origin/main..HEAD` 为空(已同步)。

## Out of Scope

- Open VSX publish(子任务 C2)。
- GitHub release(子任务 C3)。
- 改任何 src/ 文件。

## Rollback

- commit 之后、tag 之前:`git reset --hard HEAD~1`。
- tag 本地创建之后:`git tag -d v0.3.8`。
- push 之后:`git push origin :v0.3.8` + `git tag -d v0.3.8`(tag delete 是非破坏性的)。
- `.vsix` 是 `pnpm package` 重新生成物,删了重跑就行。
