# v0.3.0 — UI 语言运行时切换 (auto / 中文 / English)

**测试**:186 → 204 (+18 用例)
**代码**:新增 ~250 行 (LangStore + LangToggle + 18 个测试)
**变更文件**:4 修改 + 2 新增 (`src/util/langStore.ts`、`src/ui/langToggle.ts`)

---

## 核心特性:status bar 语言切换按钮

之前想在中英文 UI 之间切换,只能改 VS Code 的 `displayLanguage` (全局生效,且要重启)。
v0.3.0 在右下角 CTM pulse 紧邻位置新增一个 `$(globe) 🌐` 按钮,点击在三态间循环:

```
auto  →  zh  →  en  →  auto
 ↓       ↓     ↓
跟随  强制   强制
VS Code 中文  英文
display lang
```

### 设计取舍

- **范围限定**:仅动态 UI 文案 (status bar / sidebar / toast / notification /
  onboarding / badge / quickPick) 受切换影响
- **不可切换** (平台硬限制,运行时无法改变):
  - Command Palette 命令标题
  - 视图标题 / 容器标题
  - Welcome View 内容 (这些走 VS Code `package.nls.*` 系统)
- **按钮 tooltip 显式告知** 哪些能切 / 哪些不能切,避免用户误解为失效

### 实现要点

- `LangStore` (`src/util/langStore.ts`) —— 偏好持久化 (Global scope workspaceState)
  + 三态切换逻辑 + 配置同步
- `LangToggle` (`src/ui/langToggle.ts`) —— 独立 `StatusBarItem` (`priority 99`),
  与 CTM pulse (`priority 100`) 视觉相邻,点击不抢焦点
- i18n 模块新增 `setLangOverride()` / `getLangOverride()` 模块级 hook,
  `detectLang()` 优先返回 override 值
- `onDidChangeConfiguration` 监听器扩展,切换时调 `statusBar.update` /
  `applyBadge` / `treeDataProvider.refresh()`,UI 立即重画

### 新增配置

`claudeTaskMonitor.language` (enum: `auto` | `zh` | `en`, 默认 `auto`)

直接编辑 settings.json 也可,与按钮同步。

### 新增命令

`Claude Task Monitor: Switch UI Language (Auto / 中文 / English)`
(Command Palette 可调,效果同按钮点击)

---

## 测试

- 新增 14 个 `LangStore` 单测:三态切换顺序 / 持久化回放 / 监听器触发 /
  边界 (空值 / 非法 enum / 缺失 workspaceState)
- 新增 4 个 i18n override 单测:auto/zh/en 三态 → 模块级 override →
  `detectLang` 返回值
- 全套 `pnpm test` 通过 (204/204)
- `pnpm build` 通过 (tsup CJS Build success)

---

## 升级路径

无需任何操作,VS Code / Open VSX 会自动更新已安装的扩展。
已有配置 / hook / workspaceState 不受影响。
