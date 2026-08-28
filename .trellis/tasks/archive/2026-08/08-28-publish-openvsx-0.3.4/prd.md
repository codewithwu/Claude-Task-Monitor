# C2 — Publish v0.3.4 to Open VSX

## Goal

把 `packages/codewithwu-cn.claude-task-monitor-0.3.4.vsix` 发布到 Eclipse Open
VSX Registry(Eclipse 基金会,`open-vsx.org`),namespace 沿用历史的
`codewithwu-cn.claude-task-monitor`。

## Pre-conditions

- C1 已经完成,`.vsix` 落在 `packages/codewithwu-cn.claude-task-monitor-0.3.4.vsix`。
- `OVSX_PAT` env var 已设(已在 session start 验证)。
- `ovsx` CLI 1.0.2 在 PATH 上(`/home/cooper/.nvm/versions/node/v24.11.1/bin/ovsx`)。

## Functional Requirements

### FR1 — ovsx publish

- 命令:`ovsx publish packages/codewithwu-cn.claude-task-monitor-0.3.4.vsix`
  (CLI 自动读 `$OVSX_PAT`)。
- `--pat` flag 可省略,因为 env var 已经设;如果要显式,
  `ovsx publish ... --pat "$OVSX_PAT"`(`$OVSX_PAT` 不进 echo / log)。
- 退出码 0 视为成功;非 0 视为失败,留 TODO。

### FR2 — Verify published

- `ovsx get codewithwu-cn.claude-task-monitor`:输出应包含
  `0.3.4` 作为 `latest` / `version` 字段。
- Web 端:`open-vsx.org/extension/codewithwu-cn/claude-task-monitor` 应能
  看到 0.3.4(Web 验证可以做 grep `<title>` / 抓取 manifest,不必开浏览器)。

### FR3 — 失败处理

- publish 报 401 / 403 → `OVSX_PAT` 失效,留 TODO 让用户刷新。
- publish 报 5xx / network → 重试一次(用户 VPN 已知);仍失败留 TODO。
- publish 报 409(version conflict)→ 不太可能,但如果发生说明之前已经发过
  0.3.4;不要重复 publish,留 TODO。

## Non-functional Requirements

- **NFR1**:`OVSX_PAT` 不进 commit message / log / chat 输出。
- **NFR2**:本任务只读 main 分支 / `packages/` 目录,不修改代码。
- **NFR3**:失败可重试,不留副作用——Open VSX publish 是 all-or-nothing。

## Acceptance Criteria

- [ ] **AC1**:`ovsx get codewithwu-cn.claude-task-monitor` 输出里 `version`
  (或 `latest`)字段 = `0.3.4`。
- [ ] **AC2**:`open-vsx.org/extension/codewithwu-cn/claude-task-monitor`
  的网页 / manifest 包含 `0.3.4`(可以 curl + grep)。
- [ ] **AC3**:本任务会话日志 / 临时文件 / 终端输出不含 `OVSX_PAT` 明文。
- [ ] **AC4**:`packages/codewithwu-cn.claude-task-monitor-0.3.4.vsix` 在
  publish 之后仍然存在于本地(C3 要用它做 GitHub release asset)。

## Out of Scope

- VS Code marketplace publish。
- 撤回 / unpublish 已发布版本(Open VSX 没有 rollback API;若需要修必须发新版本)。
- 改 namespace 或 publisher 信息。

## Rollback

- 没有真正的 rollback。可选方案:
  - 发一个 patch 版本(如 0.3.4-hotfix1)替换;或
  - 跟 Open VSX 团队沟通(超出本任务范围)。
- 本地 `.vsix` 不动,留给 C3 用。