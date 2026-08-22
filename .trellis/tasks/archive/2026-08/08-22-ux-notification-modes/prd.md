# P1-5,6: 通知系统改造 (静音模式 / per-session mute / dedupe 修复)

## Goal

三件事:(a) 新增 `notifyMode=silent` 配置 + status bar/badge 仍更新;(b) per-session mute 写入 SessionState,右键菜单加 'Mute Notifications';(c) notifier dedupe 改按 `(sessionId, toolName)` 去重而不是仅 `sessionId`,避免连续工具请求只弹第一条。

## Requirements

- 新增配置 `claudeTaskMonitor.notifyMode`,enum{`all`, `aggregate`, `silent`},默认 `aggregate`(保留现有默认)
- `silent` 模式下 `notifier.notify` 直接 no-op;`status bar` / `badge` 仍更新(用户靠余光感知)
- `aggregate` 行为保持不变(向后兼容)
- SessionState 加 `muted: boolean`,持久化方案:写入 `.jsonl` 末尾一行 metadata 行 `{hook_event_name:"Metadata", session_id, muted: true}`,store.apply 识别
- notifier dedupe key 从 `sessionId` 改为 `(sessionId, toolName)`
- 右键菜单新增 `Mute Notifications` / `Unmute Notifications`(根据当前 muted 状态显示)

## Acceptance Criteria

- [ ] 配置 `silent` 后,弹通知验证 = 0,sidebar 红点仍出现
- [ ] per-session mute 写入后 VS Code 重启仍生效
- [ ] 同一 session 连续触发 3 个不同 tool,3 条通知都至少弹一次(不再被 dedupe 吞)
- [ ] 同一 session 同一 tool 30s 内只弹一次(原行为)
- [ ] aggregate 模式行为不变(向后兼容测试通过)
- [ ] mute / unmute 命令有 toast 反馈

## Notes

- 父任务:[08-22-ux-optimization-roadmap](../08-22-ux-optimization-roadmap/)
- muting 持久化方案需在 `design.md` 阶段决定:jsonl metadata 行 vs workspaceState vs 独立 file
  - 推荐 jsonl metadata 行(跟随 session 自然归档,无需额外同步逻辑)
- 影响:`notifier.ts` 核心 dedupe key + `SessionStore.apply` 识别新 event type + `types.ts` 加字段 + `treeDataProvider.ts` 加右键菜单