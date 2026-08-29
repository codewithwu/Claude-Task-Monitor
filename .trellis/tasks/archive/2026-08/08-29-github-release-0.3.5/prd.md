# C3 — Create GitHub release v0.3.5

## Goal

在 `codewithwu/Claude-Task-Monitor` repo 上创建 GitHub release `v0.3.5`,
带 round-5 audit 修复的 release notes 和 `.vsix` attachment。

## Pre-conditions

- C1 完成:tag `v0.3.5` 已推到 origin。
- C2 完成:.vsix 已发布到 Open VSX(无需等 C2 完成才能建 release,但
  release notes 会引用 .vsix,所以通常顺序是 C1 → C2 → C3)。
- `gh` CLI 已 auth(用户 session 已验证)。

## Functional Requirements

### FR1 — Create release draft

- 命令:
  ```bash
  gh release create v0.3.5 \
    --title "v0.3.5 — audit-r5 fixes (3 core bugs + 3 i18n strings + spec docs)" \
    --notes-file /path/to/release-notes.md \
    packages/codewithwu-cn.claude-task-monitor-0.3.5.vsix
  ```
- `--notes-file`:release notes 文本路径,见 FR3。
- 不带 `--draft` / `--prerelease`:这是 stable patch release。
- 退出码 0 视为成功。

### FR2 — Verify release visible

- `gh release view v0.3.5`:输出应包含 tag `v0.3.5`、title 字符串、
  attached `.vsix` 资产。
- Web 端:`github.com/codewithwu/Claude-Task-Monitor/releases/tag/v0.3.5`
  应能访问,带 `.vsix` 下载链接。

### FR3 — Release notes 内容

写在 `.trellis/workspace/cooper/release-0.3.5-notes.md`(workspace 笔记,
不进 git),GitHub release 直接从这个文件读 notes。结构跟
`release-0.3.3-notes.md` 对齐(commit 引用 + bullet 摘要):

```markdown
## v0.3.5 — audit-r5 fixes

### Fixed (commits 9ae6ae1 + ce29ef7)

- **formatError empty-string fallback**: duck-typed `{message: ''}` 分支
  返回空串违反文件头契约,补 `|| String(e)` 兜底。
- **Watcher truncation recovery**: JSONL truncate 后 offsets map 未重置
  导致下次 append 仍早退;同时重置 local var + map entry 到 0。
- **Tooltip markdown injection**: buildTooltip 对非受信用户输入用
  `appendMarkdown` 会渲染 `[Click](https://evil)`;切到 `appendText`。
- **dyingAt row hardcoded Chinese**: `'已退出 · '` 改 i18n key
  `status.dying`(en/zh 各一份)。
- **deactivate uninstall prompt hardcoded Chinese**: 新增
  `extension.uninstall.{prompt, remove, keep}` keys;**同步修**
  blocking-modal bug(deactivate 改 fire-and-forget .then())。
- **jq-missing toast hardcoded Chinese**: 新增 `extension.jqMissing` key。

### Docs (commit a6cb01f)

- `.trellis/spec/ingest.md` 落 truncation recovery 契约。
- `.trellis/spec/lifecycle.md` 落 MarkdownString.appendText vs
  appendMarkdown 边界。

### Override note

i18n 的 uninstall prompt + jq-missing toast 之前在
`08-23-fix-v020-leftovers` 中 deferred,本次按 round-5 priority
list 显式 override。

### Testing

- `pnpm test`: 260/260 pass。
- `pnpm build`: green。
```

### FR4 — 失败处理

- `gh release create` 报 401 / 403 → token 失效,留 TODO 让用户
  `gh auth refresh`。
- 报 404 → repo remote 不对,留 TODO。
- 报 conflict(tag 已存在 release)→ 留 TODO,提示用户 `gh release
  delete v0.3.5` 后重试。

## Non-functional Requirements

- **NFR1**:`GH_TOKEN` / `GITHUB_TOKEN` 不进 commit message / log /
  chat 输出。
- **NFR2**:release notes 文件在 `.trellis/workspace/cooper/`,**不进**
  git(workspace 笔记)。可参考 `release-0.3.3-notes.md` 的处理方式。
- **NFR3**:`.vsix` attachment 必须从 `packages/` 目录取,不重新构建。
- **NFR4**:title 简洁,跟历史 release 对齐(`v0.3.4` 的 title 留空,
  v0.3.3 的 title 留空,本次可加上 "— audit-r5 fixes (3 core bugs +
  3 i18n strings + spec docs)" 帮助搜索)。

## Acceptance Criteria

- [ ] **AC1**:`gh release view v0.3.5` 退出码 0,JSON 输出包含
  `tagName: "v0.3.5"`、`assets[].name` 包含
  `codewithwu-cn.claude-task-monitor-0.3.5.vsix`。
- [ ] **AC2**:release notes 内容包含全部 6 个 fixed 项 + 2 个 docs 项 +
  override note + testing 摘要。
- [ ] **AC3**:`git ls-remote origin refs/tags/v0.3.5` 命中(已在 C1
  push,本任务仅消费)。
- [ ] **AC4**:release notes 文件
  `.trellis/workspace/cooper/release-0.3.5-notes.md` 存在,
  `.gitignore` 排除(workspace 笔记)。

## Out of Scope

- 改 release notes 之外的 repo 内容。
- 触发 VS Code marketplace 自动更新(不在 marketplace 发布)。

## Rollback

- `gh release delete v0.3.5 --yes`(会一并删 `.vsix` asset)。
- 注意:tag 不会自动删;如需删 tag,
  `git push origin :v0.3.5 && git tag -d v0.3.5`。
