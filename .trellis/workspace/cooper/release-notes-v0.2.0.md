# v0.2.0 — UX 优化 (18 项)

**测试**:142 → 185 (+43 用例)
**代码**:+982 / -136 行
**变更文件**:20 修改 + 13 新增

---

## P0 — 影响最严重的 UX bug 修复 (3 项)

### 🐛 单击 Session 不再破坏 workspace
之前点击 Session 会替换当前窗口的 workspace,导致多任务并行时丢失上下文。
现在改为在**新窗口**打开 Session 项目(`forceNewWindow: true`),原有窗口完全不受影响。

### 🐛 Onboarding 可随时重入
- 卸载钩子后 Welcome View 自动出现,引导重新安装
- `showOnboarding` 命令随时调出引导卡片
- 引导文案跟随用户 locale

### 🐛 `jq` 缺失时显示常驻 banner
Onboarding 检测到 `jq` 未安装,会在视图顶部显示安装命令(brew / apt / winget),
点击**复制**按钮一键粘贴到终端。

---

## P1 — 专业用户效率提升 (3 项)

### 🎨 色盲友好的状态图标形状
| 状态 | 旧 | 新 |
|---|---|---|
| Running | `circle-filled` 蓝 | `sync~spin` 旋转 + 蓝色 |
| Idle | `circle-outline` 灰 | `circle-outline` 灰 |
| Waiting | `circle-filled` 黄 | `circle-outline` 黄 + ⚠ |
| Waiting ≥ 阈值 | 同上 | `alert` 红色 ⚠ |

形状 + 颜色双重编码,灰度截图也能区分状态。

### 🔔 通知模式可配置
新增 `claudeTaskMonitor.notifyMode`:
- `silent` — 完全不弹通知
- `single` — 每个 waiting 工具都弹(旧行为,默认)
- `aggregate` — 多个 waiting 合并成一条
- `legacy` — 旧版聚合格式(兼容性)

修复了 dedupe key 用 `sessionId` 导致同一 session 多工具只弹一次的 bug。
改为 `(sessionId, toolName)`,每个工具都正确收到通知。

### ⚙️ 长等阈值可配置
新增 `claudeTaskMonitor.longWaitingThresholdSec`(默认 300 秒)。
状态栏 tooltip 现在显示前 3 个 waiting session 的项目名 + 等待时长。

---

## P2 — 体验打磨 (12 项)

### ⌨️ 快捷键与右键菜单
- `Shift+Cmd+C` 聚焦 Session 视图(Windows/Linux: `Shift+Ctrl+C`)
- 右键 Session 行可执行 6 个上下文命令:
  - `Open in New Window` / `Open in Current Window`
  - `View Session File`(打开 raw JSONL)
  - `Copy Session ID`
  - `Toggle Pin` / `Toggle Mute`
- 命令面板新增 9 个命令覆盖上述操作

### 🎯 Session 分组与过滤
- 默认按状态分组(Running / Waiting / Idle / Dying)
- 新增 `defaultFilter` 配置 + `setFilter` 命令在状态栏切换
- Pinned Session 始终排第一

### 📋 配置入口与 Welcome 重构
- 4 个新配置项分类进命令面板(`longWaitingThresholdSec` / `defaultFilter` / `notifyMode` / `openBehavior`)
- Welcome View 重写,首次启动一键安装 hook

### 💀 Liveness 视觉反馈
Session 进程退出后不再立刻消失,会:
1. 立即显示 ⚠ `已退出 · 正在验证`(2 秒延迟)
2. 确认真的死后才归档

避免"诈尸"场景下的视觉跳变。

### 🌐 中英双语国际化
- 全部 UI 文案走 i18n 层
- 根据 `vscode.env.language` 自动切换中/英
- `package.nls.json`(en) + `package.nls.zh-cn.json` 双轨

---

## 升级建议

如果你在用 v0.1.x,**升级后重启 VS Code** 以确保新命令注册和 i18n 初始化生效。
无需重装 hook。

---

## 完整变更

```
be68481 feat: 0.1.9 → 0.2.0 UX 优化 (18 项,142 → 185 tests)
0973fd6 chore: bump version 0.1.9 → 0.2.0
```
