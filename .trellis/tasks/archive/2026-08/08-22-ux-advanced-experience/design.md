# P2-18: 多窗口通知路由 — design.md

## (a) Liveness 视觉反馈:已实现 ✅

- `SessionState.dyingAt?: number` (epoch seconds)
- `pruneDeadSessions` 改为两 tick 流程:第一 tick 设 dyingAt,后续 tick 检查 elapsed ≥ 2s 才真移除
- `rowPresentation` 检测 dyingAt:icon `circle-slash` + 颜色 `descriptionForeground`,description 前缀 `已退出 · `
- "诈尸" 处理:dying 中进程复活 → 清 dyingAt
- 测试覆盖:dying 设值 / 推阈值 / 真移除 / 诈复活清标记
- 实现在 commit `feat: P2 liveness 视觉反馈`

## (b) 多窗口通知路由:design + 实测待做

### 现状分析

每个 VS Code 窗口独立 activate 插件,各自:
- 跑 watcher 监听 `~/.claude-task-monitor/sessions/`
- 维护自己的 SessionStore + Notifier
- `vscode.window.showWarningMessage` 在调用它的窗口显示 toast

**问题场景**(待实测确认):
1. 同一个 cwd 下起 2 个 claude 进程 + 2 个 VS Code 窗口分别打开 → 两窗口都收到 waiting 通知 → 用户被刷屏
2. Window A 打开项目 X,Window B 打开项目 Y,X 触发 waiting → Window B 收到"X 等待权限"通知(因为 B 的 watcher 也看到了 X 的 .jsonl)→ B 用户可能完全不知道 X 是什么
3. 用户开了 VS Code 但忘了关 → 24h 后某个 session 还显示 waiting,但插件以为是新事件 → 通知风暴

### VS Code 通知机制(基于文档理解)

- `vscode.window.showWarningMessage` 默认是**当前窗口的 toast**(右上角短暂弹窗)
- VS Code 设置 `window.toastPosition` 控制位置,但仍是 per-window
- **OS 系统通知**(notification center)需要用户手动开 `notifications.system.enabled`,开启后由 VS Code 主进程统一调度 → 看起来是全局的
- 因此:即使不实现 (b) 的路由,默认 toast 也是 per-window 的,但**同一窗口会被自己的 watcher 反复通知**

### 推荐方案:per-workspace ownership

最简单也最可预测的方案:
- 每个 VS Code 窗口在 activate 时,记下自己的 workspace folders
- notifier.notify 时:检查 `s.cwd` 是否在当前窗口的 workspace folders 下
  - 是 → 显示通知
  - 否 → 跳过(status bar/badge 仍反映,只是不弹 toast)
- 副作用:空窗口(没打开任何 workspace)→ 永不弹通知 → 这是用户想要的(空窗口没意义)

### 边界情况

1. **多 root workspace** (`*.code-workspace` 文件): `vscode.workspace.workspaceFolders` 返回多个 → s.cwd 跟任一匹配就算本窗口拥有
2. **session cwd 不在 workspace folders**: 比如用户在 `/tmp/test/` 跑了 claude,VS Code 窗口打开了 `/home/user/proj` → 当前窗口不"拥有"该 session → 不弹通知(但 sidebar 仍显示)
3. **没有 workspaceFolders**(单文件窗口): 全部 session 视为不属于 → 不弹通知(用户需要 File → Open Folder 才能 monitor)
4. **system OS 通知** 开启的场景:即使按 (b) 跳过 toast,OS 通知仍可能因 VS Code 主进程的调度而触发 → 这是 VS Code 内部行为,我们无法干预
   - 缓解:在通知 callback 内再次检查 ownership 后再 fire (但 fire 已经被 notifier 完成) → 这就需要改 notifier API
   - 妥协:**MVP 接受 OS 通知可能重复,只优化 toast 层级**

### 实测 plan(用户手动跑,需要 2 个 VS Code 窗口)

```
1. 启动 Window A,打开项目 /p/a
2. 启动 Window B,打开项目 /p/b (独立窗口,非 Window: New Window with Same Workspace)
3. 在 /p/a 跑 claude,触发 permission_prompt
5. 观察: Window A 和 B 是否都收到 toast? 是 → 验证问题存在
6. Window B 关闭项目 /p/b 后,/p/a 再触发 waiting → B 是否还收到?
7. 开启 OS 系统通知 (VS Code Settings → Notifications: System) 后重测
```

### 决策

- (a) 已实现并测试,直接合
- (b) 路由逻辑简单 (~ 20 行),但需要实测验证"现状是不是真有通知重复" → **建议用户先实测再决定是否实现**
- 如果实测确认问题:实现 ownership 过滤;如果实测发现通知不重复(可能 VS Code 已经按 workspace 去重):跳过 (b),改写 PRD 把 (b) 标 done

## 实施检查清单(实施时)

- [ ] 实测确认双窗口是否真的有通知重复
- [ ] 决定是否实现 (b) ownership 过滤
- [ ] 如果是: `notifier.notify` 加 ownership 参数,或 extension.ts callback 内判断
- [ ] 测试覆盖:跨窗口场景下的 notify 调用次数
- [ ] 更新 README / docs 说明行为