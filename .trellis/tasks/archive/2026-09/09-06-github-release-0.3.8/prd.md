# C3 — GitHub release v0.3.8

## Goal

在 `github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.3.8` 创建 release page,带 release notes(summary focus-terminal P1)+ `.vsix` attachment。

## Pre-conditions

- C1 已完成,`v0.3.8` tag 在 origin(`git ls-remote origin refs/tags/v0.3.8` 命中)。
- `packages/codewithwu-cn.claude-task-monitor-0.3.8.vsix` 在本地。
- `gh` CLI 已 auth(`gh auth status` 通过);本 session 已有 `gh` 在 `/usr/bin/gh`。

## Functional Requirements

### FR1 — gh release create

- 命令(参考 0.3.5 / 0.3.6 / 0.3.7 历史):
  ```bash
  gh release create v0.3.8 \
    --title "v0.3.8" \
    --notes-file .trellis/tasks/09-06-release-v0.3.8/release-notes.md \
    packages/codewithwu-cn.claude-task-monitor-0.3.8.vsix
  ```
- tag `v0.3.8` 已在 origin(FR1 push 已完成),gh CLI 自动 detect。
- 如果 `--notes-file` 路径不存在,fallback 到 `--notes "..."` 内联(短摘要)。

### FR2 — Release notes 内容

- 简短 markdown,主条目:**sidebar focus terminal**(improvement-backlog #4 P1)。
- 引用 `e06da35 feat(sidebar): focus the terminal running Claude instead of opening a new one`。
- 可附 commit/CHANGELOG 链接:`/blob/v0.3.8/CHANGELOG.md`、`/compare/v0.3.7...v0.3.8`。
- 不重复完整 CHANGELOG 内容(那是 CHANGELOG.md 的职责,GitHub release 只放用户视角摘要)。
- notes 文件路径:`.trellis/tasks/09-06-release-v0.3.8/release-notes.md`(与 prd 同级,便于 review)。

### FR3 — Verify published

- `gh release view v0.3.8 --json tagName,name,assets` 输出:
  - `tagName = "v0.3.8"`
  - `name = "v0.3.8"`
  - `assets` 包含 1 个 file,`name` 以 `.vsix` 结尾,`sizeInBytes` 接近本地 `.vsix` 大小。
- 网页端:`https://github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.3.8` 200 OK。

### FR4 — 失败处理

- `gh` 报 401 → `gh auth login` 重做。
- `gh` 报 "tag not found" → 检查 origin tag push 是否成功(C1 AC6 重跑)。
- `.vsix` 上传失败 → 重试;仍失败手动 `gh release upload v0.3.8 <path>` 补传。

## Non-functional Requirements

- **NFR1**:GitHub PAT 不进 commit / log / chat。
- **NFR2**:release notes 不泄露本地路径(只引用 git tag + 文件名)。
- **NFR3**:release notes 中英双语或英文,与历史 release notes 一致(0.3.5 / 0.3.6 / 0.3.7 release notes 是英文)。

## Acceptance Criteria

- [ ] **AC1**:`gh release view v0.3.8 --json tagName` 输出 `"v0.3.8"`。
- [ ] **AC2**:`gh release view v0.3.8 --json assets` 输出数组长度 ≥ 1,首个 asset name = `codewithwu-cn.claude-task-monitor-0.3.8.vsix`。
- [ ] **AC3**:本地 `.vsix` 文件 size 与 uploaded asset size 差异 ≤ 1KB(sanity,排除 GH 压缩开销)。
- [ ] **AC4**:release notes 文件存在 + 内容包含 focus-terminal 关键词 + `e06da35` commit 引用。
- [ ] **AC5**:网页 `https://github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.3.8` 200 OK(可用 `curl -I` 验证)。

## Out of Scope

- VS Code marketplace publish(不在本项目 scope)。
- Open VSX publish(子任务 C2)。
- 改 release 标题 / 描述(若有变更需 `gh release edit`)。

## Rollback

- `gh release delete v0.3.8`(本地 `gh` 默认行为,tag 不动)。
- 重做时 `gh release create v0.3.8 ...` 即可(release 是可 recreate 的,与 Open VSX immutable 不同)。
