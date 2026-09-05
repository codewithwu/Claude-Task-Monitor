# C2 — Publish v0.3.8 to Open VSX

## Goal

把 `packages/codewithwu-cn.claude-task-monitor-0.3.8.vsix` 发布到 Eclipse Open VSX Registry(Eclipse 基金会,`open-vsx.org`),namespace 沿用历史的 `codewithwu-cn.claude-task-monitor`。

## Pre-conditions

- C1 已完成,`.vsix` 落在 `packages/claude-task-monitor-0.3.8.vsix`(vsce 默认输出 bare name;0.3.6 / 0.3.7 发布用同款 bare name,Open VSX registry 通过 `package.json` 的 `publisher` 字段识别 namespace)。
- `OVSX_PAT` env var 已设(本 session start 已验证)。
- `ovsx` CLI 在 PATH 上(`/home/cooper/.nvm/versions/node/v24.11.1/bin/ovsx`)。

## Functional Requirements

### FR1 — ovsx publish

- 命令:`ovsx publish packages/claude-task-monitor-0.3.8.vsix`(CLI 自动读 `$OVSX_PAT`;registry 通过 vsix 内 `package.json` 的 `publisher = "codewithwu-cn"` 字段识别 namespace,与文件名无关)。
- `--pat` flag 可省略,因为 env var 已经设;如果要显式,`ovsx publish ... --pat "$OVSX_PAT"`(`$OVSX_PAT` 不进 echo / log)。
- 退出码 0 视为成功;非 0 视为失败,留 TODO。

### FR2 — Verify published

- `ovsx get codewithwu-cn.claude-task-monitor --metadata`:输出 JSON 应包含 `"version": "0.3.8"` 和 `"versionAlias": ["latest"]`。**必须加 `--metadata` flag**:不加时 ovsx CLI 默认行为是下载 LATEST version 的 .vsix 到 CWD(0.3.5 实测发现并修正)。
- API 端:`curl -s https://open-vsx.org/api/codewithwu-cn/claude-task-monitor | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['version']=='0.3.8' and 'latest' in d['versionAlias']; print('OK')"`(双因素确认)。
- Web 端:`open-vsx.org/extension/codewithwu-cn/claude-task-monitor` 应能看到 0.3.8(可 grep manifest,不必开浏览器)。

### FR3 — 失败处理

- publish 报 401 / 403 → `OVSX_PAT` 失效,留 TODO 让用户刷新。
- publish 报 5xx / network → 重试一次(用户 VPN 已知);仍失败留 TODO。
- publish 报 409(version conflict)→ 不太可能,但如果发生说明之前已经发过 0.3.8;不要重复 publish,留 TODO。

## Non-functional Requirements

- **NFR1**:`OVSX_PAT` 不进 commit message / log / chat 输出。
- **NFR2**:本任务只读 main 分支 / `packages/` 目录,不修改代码。
- **NFR3**:失败可重试,不留副作用——Open VSX publish 是 all-or-nothing。

## Acceptance Criteria

- [ ] **AC1**:`ovsx get codewithwu-cn.claude-task-monitor --metadata` 输出 JSON 里 `"version" = "0.3.8"` AND `"versionAlias"` 包含 `"latest"`。
- [ ] **AC2**:`https://open-vsx.org/api/codewithwu-cn/claude-task-monitor` API 返回 `"version" = "0.3.8"` AND `"versionAlias"` 包含 `"latest"`。
- [ ] **AC3**:API 返回额外元数据 sanity:`namespace = "codewithwu-cn"`、`name = "claude-task-monitor"`、`verified = true`、`timestamp` 接近 publish 时间(2026-09-06)。

## Out of Scope

- `vsce publish` 到 VS Code marketplace。
- GitHub release(子任务 C3 负责)。
- 改 `.vsix` 内容(C1 已经固化)。

## Rollback

- Open VSX publish 是 immutable;没有 delete 操作,只能 publish 新版本覆盖。
- 如果 publish 了错的版本,在 PRD 末尾留 TODO,publish 新 patch 版本(0.3.9)修复。
