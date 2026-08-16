# VSCode 扩展开发经验指南

> 适用范围:基于 Claude Task Monitor (CTM, `codewithwu-cn/claude-task-monitor`) 仓库提炼的开发 SOP,用于后续开发其他 VSCode 扩展。
> 整理日期:2026-08-16 · CTM 当前版本:v0.1.4
> 受众:**个人参考** — 保留踩坑记录与决策原因,不追求对外通用化。
> 与本仓库的关系:本指南放在仓库根目录,只读。后续开新扩展时直接复制本文件的结构,然后清空业务相关章节。

---

## 0. 选型一句话总结

| 维度 | 选择 | 一句话理由 |
|---|---|---|
| 语言 | TypeScript | VSCode 扩展官方一等公民,类型即文档 |
| 包管理 | **pnpm** | `pnpm-lock.yaml` 单文件、可重现;`pnpm-workspace.yaml` 留好为以后开 monorepo |
| 打包 | **tsup** (esbuild 后端) | 零配置 / 单文件产物 / 自动 external `vscode` / sourcemap 内建 |
| 单元测试 | **vitest** | 与 jest API 兼容、watch 快、ESM 原生 |
| 集成测试 | **@vscode/test-electron** | 拉真实 VS Code 二进制、跑扩展宿主内的 Mocha 套件 |
| 打包 CLI | **vsce** | VSCode 官方打包工具;输出 `.vsix`(Open VSX 与 MS Marketplace 通吃) |
| Open VSX 发布 CLI | **ovsx** | Eclipse 官方,吃 `.vsix` + PAT |
| 文件监听 | **chokidar** | 比 `fs.watch` 跨平台稳 |
| CI | **无**(CTM) | 手动 `pnpm package` + 上传。进阶方案见附录 B |

何时**不要**用这套:
- 扩展要发布到 **Microsoft Marketplace** — 那条路要注册 Azure DevOps + PAT,流程不同(`vsce publish` 直发)
- 扩展需要 **Webview UI** — 加一个前端构建链(vite/webpack),不在本指南范围
- 扩展是 **workspace trust / language server protocol** 一类重型特性 — 那是另一套工程量

---

## 1. 项目结构与初始化

### 1.1 仓库骨架(CTM 现状)

```
.
├── package.json                    # 扩展元数据 + scripts + deps
├── pnpm-workspace.yaml             # 占位,留 monorepo 余地
├── tsconfig.json                   # src 用,node16 模块解析
├── tsconfig.integration.json       # 集成测试用,extends 上一个,outDir 不同
├── tsup.config.ts                  # 构建入口
├── vitest.config.ts                # 单元测试入口
├── .vscodeignore                   # 打进 .vsix 时排除的路径
├── .vscode/
│   ├── launch.json                 # F5 调试
│   └── tasks.json                  # IDE 内 build/watch 任务
├── src/
│   ├── extension.ts                # activate / deactivate 入口
│   ├── *.ts                        # 业务模块
│   ├── util/                       # 纯函数工具
│   └── test/                       # 单元测试(与 src 同级,不进 .vsix)
│       └── integration/            # 集成测试,被 vitest exclude
├── resources/                      # 静态资源(hook.sh, icon, sidebar.svg)
├── dist/                           # tsup 产物(打 .vsix 时打进去)
├── dist-test/                      # 集成测试 tsc 产物(不进 .vsix)
├── packages/                       # 收集 .vsix 产物(不进 .vsix)
├── notes/                          # 个人笔记(不进 .vsix)
└── CHANGELOG.md                    # Keep a Changelog 格式
```

**约定**:
- `src/test/` 与业务代码平级,但不进 `.vsix` —— 见 `.vscodeignore`
- `dist/` 与 `dist-test/` 都是 `.vscodeignore` 排除的源(由 tsup/tsc 生成);但 `dist/` 进 `.vsix`,因为 `package.json` 的 `"main": "./dist/extension.js"`
- `resources/` 进 `.vsix`,因为扩展运行时要用 `hook.sh` / 图标
- `packages/` 不进 `.vsix`,只用于收集发布物

### 1.2 `package.json` 关键字段

最小必需(发布用):

```json
{
  "name": "<extension-name-kebab-case>",
  "displayName": "<人类可读名>",
  "description": "<一行话,会出现在扩展市场>",
  "version": "<semver>",                    // 见 §4.5
  "publisher": "<open-vsx-namespace>",
  "engines": { "vscode": "^1.85.0" },      // 与测试宿主版本对齐
  "main": "./dist/extension.js",           // tsup 产物
  "activationEvents": ["onStartupFinished"], // 或具体事件
  "categories": ["Other"],                 // 必须,否则 VSIX 校验失败
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/<owner>/<repo>.git"
  },
  "icon": "resources/icons/icon.png",      // 128x128 推荐
  "contributes": {
    "viewsContainers": { ... },
    "views": { ... },
    "configuration": { "title": "...", "properties": { ... } }
  },
  "scripts": {
    "build": "tsup",
    "watch": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "build:integration": "tsc -p tsconfig.integration.json",
    "test:integration": "pnpm build && pnpm build:integration && node ./dist-test/runTest.js",
    "package": "vsce package --no-dependencies && mkdir -p packages && mv *.vsix packages/",
    "vscode:prepublish": "pnpm build"
  }
}
```

**关键决策**:
- `"publisher"` 字段同时是 Open VSX 的命名空间(通常带 `-cn` / `-io` 等后缀,见 §4.2)
- `"categories"` 必填,否则 `vsce package` 报错
- `"vscode:prepublish": "pnpm build"` — `vsce` 默认会跑这个钩子再打包,确保产物是新的
- `"main"` 路径指向 tsup 产物,不是源文件
- **`--no-dependencies`** — 关键!不打 `node_modules` 进 `.vsix`,运行时通过 `external: ['vscode']` + tsup 的 bundling 把依赖全部 inline 到 `dist/extension.js`,产物是单文件

### 1.3 TypeScript 配置

`tsconfig.json`(扩展本体):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "node16",                     // 配 moduleResolution
    "moduleResolution": "node16",          // Node.js 16+ 解析:相对 import 必须带 .js 后缀
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/test/integration"]
}
```

**注意**:
- 用了 `module: "node16"` 后,所有 `import './foo'` 必须写 `import './foo.js'`(即使源文件是 `.ts`)。漏写就 runtime 找不到模块
- 不要加 `"type": "module"` —— 否则 tsup 要切 ESM,产物会和 VSCode 扩展宿主不兼容
- `strict: true` 是默认;以后想加 `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 等更严格的也行

`tsconfig.integration.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist-test",
    "rootDir": "src/test/integration"
  },
  "include": ["src/test/integration/**/*"],
  "exclude": []
}
```

集成测试要单独的 `outDir` 与 `rootDir`,因为 `rootDir` 是继承的 `src/`,但集成测试只想编 `src/test/integration/`。

### 1.4 `.vscodeignore`

控制什么**不**打进 `.vsix`(注意:VSIX 校验会扫这个文件,语法类似 `.gitignore`):

```gitignore
.vscode/**
.vscode-test/**
src/**                        # 源代码不打(产物 dist 才会被包含)
dist-test/**                  # 集成测试产物
.claude/**
.trellis/**
.github/**
.devcontainer/**
.gitignore
.gitattributes
**/tsconfig*.json             # 暴露工程结构,不打
**/*.map                      # sourcemap 不打,产物自带 inline map
**/*.ts                       # 全部 .ts 都不打
node_modules/**
coverage/**
docs/**
notes/**
index.html
AGENTS.md
*.vsix                        # 避免把之前的 vsix 嵌进去
```

**陷阱**:漏掉 `**/*.map` 会让 `.vsix` 体积翻倍;漏掉 `src/**` 会让用户拿到源码。

---

## 2. 开发流程

### 2.1 构建(`tsup`)

`tsup.config.ts`:

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/extension.ts'],
  outDir: 'dist',
  format: ['cjs'],                          // VSCode 扩展宿主吃 CJS
  external: ['vscode'],                     // 关键:不打包 vscode 模块
  noExternal: ['chokidar'],                 // 把运行时依赖 inline 进单文件
  target: 'node18',                         // VSCode 1.85 内嵌 Node 18+
  sourcemap: true,                          // 生产环境的 stack trace 仍可读
  clean: true                               // 每次构建先清空 dist/
})
```

执行:

```bash
pnpm build          # 单次构建
pnpm watch          # watch 模式,src/* 改动自动重建
```

产物:

```
dist/
├── extension.js
└── extension.js.map
```

**为什么不用 webpack**:webpack 配置成本高、产物大、对 `vscode` external 的支持没 tsup 干净。
**为什么不用 esbuild 直接调**:tsup 是 esbuild 的封装,等于零成本拿到 watch/format/sourcemap 等好用的开关。

### 2.2 本地调试(Extension Host)

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "build"
    }
  ]
}
```

按下 **F5** = 启动一个全新的 VSCode 窗口,加载当前仓库作为"开发中扩展"。原窗口不受影响。

**注意**:`preLaunchTask` 引用了 `.vscode/tasks.json` 里 label=`"build"` 的任务。改了 `tsup.config.ts` 后记得 `pnpm build` 一次,再按 F5。

### 2.3 监听模式

`pnpm watch` 是日常开发的主力 —— 改代码 → 自动重建 → 调试窗口里 `Ctrl+R`(或 `Developer: Reload Window`)即可。

```bash
# 终端 1
pnpm watch

# 在调试窗口里
Cmd/Ctrl+R  # 重载扩展宿主
```

### 2.4 资源文件

放在 `resources/`:

- **扩展图标**: `resources/icons/icon.png`,128×128 PNG。会出现在扩展市场卡片
- **侧边栏/活动栏图标**: `resources/icons/sidebar.svg`。`package.json` 的 `viewsContainers.activitybar[*].icon` 引用它
- **运行时需要的脚本/配置**: 如 `resources/hook.sh`(扩展首次激活时复制到 `~/.claude-task-monitor/hook.sh`)

**加载资源**用 `context.extensionPath`(扩展安装根目录):

```ts
const resourceHook = path.join(context.extensionPath, 'resources', 'hook.sh')
```

`context.extensionPath` 在开发模式下指向仓库根,在生产模式下指向 VSCode 扩展安装目录,统一路径。

---

## 3. 测试

CTM 测试栈分两层:**vitest 跑单元测试** + **@vscode/test-electron 跑集成测试**。

### 3.1 单元测试(`vitest`)

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    exclude: ['src/test/integration/**'],   // 关键:把集成测试从这里赶出去
    environment: 'node'                      // 扩展本身是 Node 进程,不要 jsdom
  }
})
```

执行:

```bash
pnpm test                # 单跑 vitest
pnpm test:watch          # watch
pnpm vitest run src/test/stateManager.test.ts        # 单文件
pnpm vitest run -t "状态切换"                          # 按名字
```

**约定**:
- 文件命名 `src/test/foo.test.ts` 与源 `src/foo.ts` 对应
- `describe` 按**行为**而非文件路径命名(`describe('isProcessGone 平台路由', ...)` 而不是 `describe('liveness.ts', ...)`)
- 尽量**不 mock**:能起真实子进程就起真实子进程,真实文件系统就用 `mkdtempSync`
- 必须 mock 的:`node:child_process` 的 `execFileSync`(Windows 分支测试)、`process.platform`(同)
- `as any` 在测试里**可以**,因为 watcher 给 reducer 喂的是 `unknown`,测试断言的是行为不是穷举类型
- 默认 timeout 5s 不够,起子进程的 case 用 `it(..., 10000)` 或 `15000`

### 3.2 集成测试(`@vscode/test-electron`)

集成测试**不是** vitest 跑的,它在真实的 VSCode 宿主里跑 Mocha 套件。

`src/test/integration/runTest.ts`(由 `pnpm test:integration` 用 `tsc` 编进 `dist-test/`,再 `node` 跑):

```ts
import * as path from 'node:path'
import { runTests } from '@vscode/test-electron'

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..')   // 仓库根
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js')
  await runTests({ extensionDevelopmentPath, extensionTestsPath })
}
main().catch(err => { console.error(err); process.exit(1) })
```

`src/test/integration/suite/index.ts`:Mocha 的 `TDD`/`BDD` 引导。

`pnpm test:integration` 全流程:

1. `pnpm build` —— tsup 出 `dist/`
2. `pnpm build:integration` —— tsc 出 `dist-test/`
3. `node ./dist-test/runTest.js` —— `@vscode/test-electron` 下载 VSCode、启动、跑测试

**特点**:
- 慢(单次 ~30s,首次 ~1min 含下载 VSCode)
- 需要网络(下载 VSCode 二进制)
- 在 CI 里加 `--reporter dot` 可以减少输出

**何时用**:只有"必须有 VSCode 宿主才看得到"的行为(扩展激活、view 注册、command palette)。其它一律走单元测试。

### 3.3 测试约定(CTM 经验)

来自 `src/test/liveness.test.ts` / `src/test/hook.test.ts` 的实际教训:

| 陷阱 | 后果 | 解决 |
|---|---|---|
| 启子进程不清理 | 孤儿 `node` 进程占满机器 | 测试末尾 `await alive.kill(); fs.rmSync(dir, { recursive: true, force: true })` |
| hook 测试不删 session 文件 | 文件留在 `~/.claude-task-monitor/sessions/`,污染真实侧边栏 | `cleanup()` 助手,每个 hook 测试必调 |
| 把 mock 写 `import` 之后 | vitest 不 hoist,导致 mock 失败 | `vi.mock()` 放在 `import` 之前 |
| 默认 timeout 5s | 真实子进程启动 ~200ms + 业务 5000ms | 用 `it(..., 10000)` 显式给 |
| Linux-only 行为(macOS/Windows CI 必崩) | CI 绿一片红一片 | `if (procState === ...) { ... } else { 至少不杀活的 }` 两层断言 |

### 3.4 手动验收清单(发布前必跑)

不放进自动化测试的"人肉 case",放进 README / CHANGELOG 的"Verification"段落:

- [ ] 多窗口并发:3 个目标对象并发,UI 正确显示 3 行
- [ ] 通知防骚扰:同一对象短时间内多次触发,只弹一次
- [ ] 异常退出:杀一个进程,重启后该项被归档
- [ ] 跳转:点击条目,正确跳到目标
- [ ] 持续时间:等 1 分钟,数字从 `30s` 滚到 `1m`
- [ ] 排序:某色永远在最前,同色按时间倒序
- [ ] 卸载:扩展卸载后用户原有配置保留

---

## 4. 发布到 Open VSX

Open VSX 是 Eclipse 基金会运营的开源扩展市场,VS Codium / Gitpod / Eclipse Theia 默认用它。VSCode / Cursor / Windsurf 等**不**直连 Open VSX,要走 §5 的 `.vsix` 离线安装。

### 4.1 准备工作

1. **注册 Open VSX 账号**: https://open-vsx.org/login(用 GitHub OAuth)
2. **创建 Personal Access Token (PAT)**: 登录后 → Settings → Access Tokens → New Token → 勾 `Publish Extensions` 作用域
3. **本地保存 token**:

```bash
# 环境变量
export OVSX_PAT="<your-token>"

# 或写到 ~/.bashrc / ~/.zshrc
echo 'export OVSX_PAT="..."' >> ~/.zshrc
```

### 4.2 命名空间(namespace)

**Open VSX 的发布者 = 命名空间**,命名空间一旦创建就是你的:

- `package.json` 的 `"publisher"` 必须与 Open VSX 命名空间**完全一致**
- 命名空间 = GitHub 用户名是常见情况,但**不一定**:CTM 的 GitHub 用户是 `codewithwu`,命名空间是 `codewithwu-cn`(带后缀避免重名)
- 创建命名空间:登录后访问 `https://open-vsx.org/user/<namespace>` —— 如果不存在会提示创建

**为什么带后缀**:Open VSX 不允许同名命名空间;先到先得。GitHub 用户 `codewithwu` 不带后缀时可能已被他人认领(虽然概率低)。

### 4.3 打 `.vsix`

```bash
pnpm package
```

`pnpm package` 等价于:

```bash
vsce package --no-dependencies && mkdir -p packages && mv *.vsix packages/
```

- `--no-dependencies` 把 `node_modules` 排除(否则 .vsix 体积爆炸)
- 产物移到 `packages/` 而不是留在根目录(避免下次 commit 把 .vsix 误提交)
- 产物文件名:`<name>-<version>.vsix`(例:`claude-task-monitor-0.1.4.vsix`)

**注意**:`packages/` 已经在 `.vscodeignore` 里,不会被打进 `.vsix` 里(避免 .vsix 套 .vsix)。

### 4.4 上传到 Open VSX

两种方式:

**A. CLI(推荐)**:

```bash
# 装一次
npm install -g ovsx

# 发布
ovsx publish packages/claude-task-monitor-0.1.4.vsix -p $OVSX_PAT
```

`ovsx` 是 Eclipse 官方 CLI,接受 `.vsix` + PAT。也可一行:

```bash
npx ovsx publish packages/claude-task-monitor-0.1.4.vsix -p $OVSX_PAT
```

**B. Web UI(应急)**:

访问 `https://open-vsx.org/namespace/<your-namespace>/publish` → 拖入 `.vsix` → 提交。

### 4.5 版本号与 changelog

- 版本号遵循 **SemVer 2.0**:`MAJOR.MINOR.PATCH`
- 改完代码后:
  1. `CHANGELOG.md` 在 `[Unreleased]` 段写本次变更
  2. 发版时把 `[Unreleased]` 内容移到 `[X.Y.Z] - YYYY-MM-DD`,并加对比链接
  3. `package.json` 的 `"version"` 同步
  4. `git tag vX.Y.Z`
  5. `pnpm package && ovsx publish ...`

**约定**(来自 `CHANGELOG.md`):

```markdown
## [Unreleased]

## [0.1.4] - 2026-08-16

### Changed
- 说明本次变更

[Unreleased]: https://github.com/<owner>/<repo>/compare/v0.1.3...HEAD
[0.1.4]: https://github.com/<owner>/<repo>/compare/v0.1.3...v0.1.4
```

每段固定四种 subsection:**Added / Changed / Deprecated / Removed / Fixed / Security / Docs / Testing**。可裁剪,但分类要清晰。

### 4.6 命名空间认领(踩坑)

**新场景**:命名空间创建了但未声明所有权 → Open VSX 在扩展详情页显示 ⚠️ 警告。

Eclipse 提供 4 种验证路径,**走哪条取决于你有什么**:

| 选项 | 适用情况 | 是否走 |
|---|---|---|
| 1. Marketplace + 仓库 | 同时发布到 MS Marketplace | ❌(没 MS 账号) |
| 2. Marketplace 无仓库 | 同上但无 GitHub | ❌ |
| 3a. 命名空间 = GitHub ID | 命名空间与 GitHub 用户名完全一致 | ❌(`codewithwu-cn` ≠ `codewithwu`) |
| 3b. DNS TXT 域名匹配 | 拥有对应域名 | ❌(没 `codewithwu.cn`) |
| 3c. 域名邮箱发邮件 | 同上 | ❌ |
| **4. 其他(commit URL 证据)** | 都没 | ✅ |

**走 Option 4 的步骤**:

1. 自检 GitHub 账号年龄 ≥ 12 个月(不够直接拒)
   - `curl -s https://api.github.com/users/<id> | grep created_at`
2. 去 https://github.com/EclipseFdn/open-vsx.org/issues/new/choose 提 issue
3. 标题: `Claiming namespace <your-namespace>`
4. 勾选项:**Ownership**(确认不属于 Open VSX 所有) + **Account age**(≥12 个月) + **选项选择:Other**
5. 主张证据 Markdown 模板:

```markdown
## Namespace
`<your-namespace>`

## Background
I am the creator and maintainer of the `<extension>` extension. I created
the `<namespace>` namespace on Open VSX and have published versions ...

## Why Options 1–3 do not apply
- **Option 1 & 2 (VS Code Marketplace)**: not published to MS Marketplace
- **Option 3a (Namespace matches GitHub ID)**: my GitHub is `<id>`, namespace is `<namespace>` (no match)
- **Option 3b/3c (Domain verification)**: I do not own a matching domain

## Identity Evidence
- **GitHub profile**: https://github.com/<id>
- **Repository**: https://github.com/<id>/<repo>
- **Initial commit by `<id>`**: <commit URL>
- `grep publisher package.json` → `"publisher": "<namespace>"`

## Why granting ownership is safe
- The GitHub account `<id>` is the sole owner of the source repository
- The namespace has no other contributors, so granting does not displace anyone
```

6. 等几天到一周审核,通过后 namespace 状态变 verified
7. **重新发布**一次(同版本号也行,会重新走验证),扩展详情页 ⚠️ → 🛡️

**VPN 提醒**(国内用户):访问 `open-vsx.org` 与 `github.com` 都要挂 VPN,否则容易跳转到营销页或被风控。

详细笔记见 `notes/open-vsx-namespace-claim.md`。

---

## 5. 发布到 GitHub Release

GitHub Release 是 `.vsix` 的"分发备份",因为:
1. **VSCode/Cursor/Windsurf 等市场闭源 IDE 直连 Open VSX,需手动装 .vsix** —— Release 提供下载链接
2. **保留历史版本** —— 用户想回滚时可下载
3. **CHANGELOG 公开版** —— GitHub Release notes 比 CHANGELOG.md 更显眼

### 5.1 打 tag

```bash
git tag v0.1.4
git push origin v0.1.4
```

### 5.2 用 gh CLI 创建 Release

```bash
gh release create v0.1.4 \
  packages/claude-task-monitor-0.1.4.vsix \
  --title "v0.1.4" \
  --notes-file RELEASE_NOTES.md \
  --latest
```

- `--latest` 把这条标为 latest,旧的自动降级
- `--notes-file` 从文件读 release notes(可以复用 `CHANGELOG.md` 的 `[X.Y.Z]` 段)

如果没有 `gh` CLI 也没事:`https://github.com/<owner>/<repo>/releases/new` → 选 tag → 拖入 `.vsix` → 写 notes → Publish。

### 5.3 附 `.vsix` 资产

`gh release create` 的多文件参数直接接文件路径,**Release 创建后追加资产**:

```bash
gh release upload v0.1.4 packages/claude-task-monitor-0.1.4.vsix
```

或一次性:

```bash
gh release create v0.1.4 packages/claude-task-monitor-0.1.4.vsix --generate-notes
```

`--generate-notes` 让 GitHub 自动从 PR 标题生成 release notes(适合 changelog 自动化的项目)。

### 5.4 与 Open VSX 同步策略

发布顺序建议:

1. `git tag` + `git push`
2. `gh release create` + 上传 `.vsix` ← 此时 Release 公开
3. `ovsx publish packages/...vsix` ← Open VSX 公开

**为什么这个顺序**:Release 一旦发布,用户就能下载 `.vsix`,但 Open VSX 可能因为审核/网络延迟要几分钟后才能搜到扩展。如果你先 Open VSX 再 Release,有个窗口期用户能在 GitHub 拿到 .vsix 但在 Open VSX 还搜不到 —— 不影响功能,但 README 的"在 Open VSX 安装"链接可能跳 404。

CHANGELOG.md 的对比链接写法:

```markdown
[Unreleased]: https://github.com/<owner>/<repo>/compare/vX.Y.Z...HEAD
[X.Y.Z]: https://github.com/<owner>/<repo>/compare/vX.Y.(Z-1)...vX.Y.Z
[X.Y.(Z-1)]: https://github.com/<owner>/<repo>/releases/tag/vX.Y.(Z-1)
```

---

## 6. 工具栈清单

### 6.1 运行时依赖(`dependencies`)

| 包 | 用途 | 在 CTM 中的用法 |
|---|---|---|
| `chokidar` | 跨平台文件监听 | `src/watcher.ts` 监听 `~/.claude-task-monitor/sessions/*.jsonl` 的写入 |

**为什么 inline 到单文件**:tsup 配置 `noExternal: ['chokidar']` 把 chokidar 打进 `dist/extension.js`。结果:
- 单文件产物,debug 简单
- 不依赖运行时 `node_modules`,扩展宿主无需解析路径

**为什么选 chokidar 而不是 `fs.watch`**:`fs.watch` 在 Linux/macOS/Windows 上行为不一致;chokidar 用事件聚合屏蔽了差异。

### 6.2 开发依赖(`devDependencies`)

| 包 | 用途 | 一句话理由 |
|---|---|---|
| `typescript` ^5.4 | 类型检查 | 必备 |
| `@types/node` ^20 | Node 全局类型 | 必备 |
| `@types/vscode` ^1.85 | VSCode API 类型 | 与 `engines.vscode` 对齐 |
| `tsup` ^8 | 打包 | 见 §2.1 |
| `vitest` ^1.6 | 单元测试 | 见 §3.1 |
| `mocha` ^10 | 集成测试 | `@vscode/test-electron` 默认用 Mocha |
| `@types/mocha` | 同上类型 | 必备 |
| `@vscode/test-electron` ^2.3 | 集成测试宿主 | 见 §3.2 |
| `glob` ^9 | (可选) | `vsce` 间接依赖 |
| `vsce` ^2.15 | `.vsix` 打包 | 见 §4.3 |

### 6.3 全局工具(可选)

| 工具 | 安装 | 用途 |
|---|---|---|
| `pnpm` | `npm i -g pnpm` 或 corepack | 包管理 |
| `ovsx` | `npm i -g ovsx` | Open VSX 发布 CLI(可 npx 代替) |
| `gh` | 各系统包管理器 | GitHub Release 创建 |
| `jq` | `brew install jq` / `apt install jq` | 如果扩展运行时需要解析 JSON(CTM 在 `hook.sh` 里用) |
| `bash` | 系统自带 | 同上 |

### 6.4 IDE 侧工具

- **VSCode 工作区推荐扩展**:ESLint(若用)、Vitest(测试面板)。CTM 没装 ESLint,但加一个不强求
- **`.vscode/tasks.json`** —— 把 `pnpm build` / `pnpm watch` 暴露成 IDE 任务面板(Cmd+Shift+B 触发 build)

### 6.5 不在依赖里但要知道

- **ESLint + Prettier**:CTM 没配置,但建议新项目加上(`pnpm dlx create-eslint-config@latest --typescript`)
- **changesets / release-please**:自动化 changelog + 版本号管理。CTM 手动写;若扩展频繁发版,加一个值得
- **typedoc**:API 文档生成。CTM 公共面小,不需要

---

## 附录 A:最小骨架文件清单(新建扩展时的 checklist)

```bash
my-new-extension/
├── package.json               # 见 §1.2,改 name/publisher/description
├── pnpm-workspace.yaml        # 占位
├── tsconfig.json              # 见 §1.3
├── tsup.config.ts             # 见 §2.1
├── vitest.config.ts           # 见 §3.1
├── tsconfig.integration.json  # 见 §1.3
├── .vscodeignore              # 见 §1.4
├── .gitignore                 # node_modules, dist, dist-test, packages, *.vsix
├── .vscode/
│   ├── launch.json            # 见 §2.2
│   └── tasks.json             # 见 §2.2
├── src/
│   ├── extension.ts           # 最小骨架:
│   │                         #   import * as vscode from 'vscode'
│   │                         #   export function activate(ctx: vscode.ExtensionContext) {}
│   │                         #   export function deactivate() {}
│   └── test/
│       └── extension.test.ts  # 占位
├── resources/
│   └── icons/
│       ├── icon.png           # 128x128
│       └── sidebar.svg        # 活动栏图标
├── CHANGELOG.md               # 见 §4.5
└── README.md                  # 至少一段"它做什么" + "怎么用"
```

**必跑命令序列**(从零到 .vsix):

```bash
# 1. 初始化
pnpm install

# 2. 写代码 + 单元测试
# ... (src/extension.ts + src/test/*.test.ts)

# 3. 跑测试
pnpm test

# 4. 打包
pnpm build
pnpm package               # 产出 packages/<name>-<version>.vsix

# 5. 本地试装
code --install-extension packages/<name>-<version>.vsix

# 6. 发布(首次需要 namespace 认领,见 §4.6)
ovsx publish packages/<name>-<version>.vsix -p $OVSX_PAT
gh release create v<version> packages/<name>-<version>.vssix --generate-notes
```

---

## 附录 B:GitHub Actions 发布工作流示例(进阶)

CTM 暂未启用。下面是**模式模板**,复制到 `.github/workflows/release.yml` 即可启用:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'        # 触发条件:打了 v* tag

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm build
      - run: pnpm package

      - name: Extract version
        id: ver
        run: echo "version=$(node -p "require('./package.json').version")" >> "$GITHUB_OUTPUT"

      - uses: actions/upload-artifact@v4
        with:
          name: vsix
          path: packages/*.vsix

  publish-open-vsx:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: vsix
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install -g ovsx
      - run: ovsx publish *.vsix -p ${{ secrets.OVSX_PAT }}
        env:
          OVSX_PAT: ${{ secrets.OVSX_PAT }}

  publish-github-release:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: vsix
      - run: gh release create v${{ needs.build.outputs.version }} *.vsix --generate-notes
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**前置配置**:
1. GitHub 仓库 Settings → Secrets and variables → Actions → New repository secret
2. `OVSX_PAT` 设为 Open VSX 的 PAT(见 §4.1)
3. 第一次发布时手动 `git tag v0.1.0 && git push origin v0.1.0` 触发

**注意**:
- Open VSX PAT 给了 publish 权限,但 Open VSX 还会要求**命名空间已 verified**(否则发布会被拒)
- 命名空间认领是**人工流程**,必须先在 §4.6 走完,再启用 CI
- 如果你想让机器人账号也能发布,把机器人账号加为 namespace 的 **Contributor**(不是 Owner),给机器人 PAT

---

## 附录 C:发布路径决策树

```
你要把扩展发到哪些市场?
│
├─ Microsoft VS Code Marketplace
│   └─ 走 vsce publish 流程
│      ├─ 先在 https://aka.ms/vscodepat 创建 PAT
│      ├─ 改名 publisher 为你的 Marketplace publisher(可能与 Open VSX 不同)
│      ├─ vsce login <publisher>
│      └─ vsce publish (或 vsce publish --packagePath packages/*.vsix)
│      └─ 注意:Marketplace 有审核,首次提交可能拒
│
└─ Open VSX(VS Codium / Gitpod / Theia 默认市场)
   │
   ├─ 你想自动化?
   │   │
   │   ├─ 有 PAT 且 namespace 已 verified ──→ ovsx publish
   │   │
   │   └─ 没 PAT 或 namespace 未 verified ──→ 先 §4.6 走认领
   │
   ├─ 你想要 VSCode / Cursor / Windsurf 用户也能装?
   │   │
   │   └─ 是 ──→ 必须同时发布到 GitHub Release(§5)
   │            用户下载 .vsix → "Extensions: Install from VSIX"
   │
   └─ 你是想偷懒 / 应急 / 不常用?
      │
      └─ Web UI ──→ https://open-vsx.org/namespace/<ns>/publish 拖入 .vsix
```

**踩坑对比**:

| 路径 | 优点 | 缺点 |
|---|---|---|
| `vsce publish` (MS Marketplace) | VSCode 原生市场,一键安装 | 需 Azure DevOps 账号 + Marketplace 审核;首次常被拒;闭源 |
| `ovsx publish` (Open VSX) | 开源、Eclipse 运营、PAT 即可;Open VSX 多数 IDE 默认 | 命名空间需人工认领;VSCode 不直连 |
| 手动 Web UI 上传 | 零工具依赖 | 容易出错(忘了改版本号、传错文件);无审计日志 |
| GitHub Release 附 .vsix | 不依赖市场;VSCode/Cursor/Windsurf 通用 | 用户需手动装,无自动更新 |

**CTM 当前选择**:**Open VSX + GitHub Release**(两份产物,同一 `.vsix`)。理由:
- Open VSX 是开源默认市场,与项目 MIT 协议气质一致
- GitHub Release 是"补救市场"——VSCode 系列 IDE 用户的唯一通路

---

## 踩坑记录(CTM 实战)

按时间倒序,从 CHANGELOG / git log / 实操笔记中提取。每条踩坑都给出**症状 + 修复**。

### 2026-08 — `packages/` 路由 .vsix

- **症状**:打完的 `.vsix` 散落根目录,容易误 commit 到 git
- **修复**:`pnpm package` 加 `&& mkdir -p packages && mv *.vsix packages/`
- **教训**:`packages/` 加入 `.vscodeignore`,否则会自己嵌自己

### 2026-08 — node16 模块解析迁移

- **症状**:TypeScript 7.0 计划移除 `module: "node"` (node10),控制台 deprecation 警告
- **修复**:`tsconfig.json` 把 `module` / `moduleResolution` 改成 `"node16"`;`src/` 下所有相对 import 加 `.js` 后缀
- **教训**:`node16` 解析规则是"运行时实际怎么解析"——源文件是 `.ts` 也要写 `.js`。一旦改了,别让 ESLint / IDE 帮你"自动修正"回 `.ts`,会运行时崩

### 2026-08 — `Notifier.reset` Map 泄漏

- **症状**:`lastNotifiedAt` Map 按 session 总数线性增长
- **原因**:之前有人删了 `Notifier.reset()`(觉得"无调用方"),但没补上 SessionEnd 时的清理
- **修复**:重新引入 `reset`,让 `SessionStore` 通过构造注入 `onSessionRemoved` 回调,在 SessionEnd / `removeByPid` 时调
- **教训**:**删 API 前先做结构性 grep**:任何 `Notifier.reset(` / `notifier.reset(` 都要全仓库扫一遍,不只看直接调用

### 2026-08 — strace/gdb 附着的 Claude CLI 永远不判定为死

- **症状**:CLI 被 strace 跟踪后,侧边栏永远显示"运行中"
- **原因**:`liveness.ts` 的正则 `\w+` 抓不到多词状态名 `t (tracing stop)`;常量 `'tracing_stop'`(下划线)与内核输出 `'tracing stop'`(空格)对不上
- **修复**:三平台分支统一判定 `c === 'T' || c === 't' || c === 'Z' || c === 'X'`
- **教训**:**liveness 检测 = 真理表**。先把内核/平台的标准字段列出来当真理表,代码只是查表,不要在代码里"按平台分别思考"

### 2026-08 — WSL2 会话被误杀

- **症状**:Windows 上跑扩展时,WSL2 内的所有 Claude 会话在 5s 内全部误清空
- **原因**:`process.kill(wslPid, 0)` 在 Windows 进程表查不到 Linux PID,抛 ESRCH,被当成"已死"
- **修复**:平台路由——Linux/WSL guest 走 `/proc/${pid}/status`,macOS 走 `ps`,Windows 优先 `wsl.exe ps`,失败再降级到 `tasklist`
- **教训**:**跨平台进程检测不是"统一函数加 try/catch"**。WSL 是独立命名空间,Windows 进程表查不到 Linux PID

### 2026-08 — 归档文件名同秒撞名

- **症状**:同秒内多次归档,后写的覆盖先写的
- **修复**:`hook.sh` 加 `$$`(PID)后缀,TS 路径加 `randomUUID().slice(0, 8)`
- **教训**:`Date.now()` 在并发归档场景不够;至少叠 PID 或 UUID

### 2026-08 — `execSync` 字符串拼接注入风险

- **症状**:`ps -o stat= -p ${pid}` 里 PID 是用户控制的,有 shell 注入风险
- **修复**:改用 `execFileSync('ps', [...])` 走数组参数
- **教训**:**任何 spawn/exec 优先 `execFile` + 数组参数**,而不是字符串拼接

### 2026-06 — Open VSX 命名空间未认领

- **症状**:扩展详情页显示 ⚠️ unverified 警告
- **原因**:创建了命名空间 + 发布了扩展,但未声明所有权
- **修复**:见 §4.6,走 Option 4(commit URL 证据)
- **教训**:**发布第一版前先认领命名空间**,否则后期认领还要 GitHub ≥12 个月账号,新号会被直接拒

### 2026-06 — Hook 用 `$PPID` 误抓瞬时 PID

- **症状**:hook 抓到的 PID 5s 后查不到了,真正还在跑的会话被误清
- **原因**:`$PPID` 是 hook bash 的直接父进程(transient Node MainThread 或 sh subshell),不是 durable 的 claude 进程
- **修复**:`hook.sh` 沿进程树向上找 `comm == "claude"` 的祖先,作为 durable PID
- **教训**:**永远不要信 `$PPID`**,要从 `/proc/<pid>/comm` 沿进程树找业务标识

### 早期 — 集成测试 `ours` 类型过宽

- **症状**:`tsc --noEmit` 在集成测试里过不去
- **原因**:`ours` 字段类型太宽,无法与真实返回类型对齐
- **修复**:缩窄类型
- **教训**:**集成测试不是"放宽标准"**。生产代码类型严格,集成测试 mock 也必须严格

### 早期 — 扩展图标是空 PNG

- **症状**:扩展市场卡片显示占位灰块
- **修复**:基于 `sidebar.svg` 渲染 428×428 PNG(5 根柱状图)
- **教训**:**图标在扩展市场是脸面**。哪怕只画一个方块 + 字母,也别空着

---

## 引用

- CTM 仓库: https://github.com/codewithwu/Claude-Task-Monitor
- CTM Open VSX: https://open-vsx.org/extension/codewithwu-cn/claude-task-monitor
- 命名空间认领笔记: `notes/open-vsx-namespace-claim.md`
- VSCE 文档: https://github.com/microsoft/vscode-vsce
- OVSX 文档: https://github.com/eclipse/openvsx/wiki/Publishing-Extensions
- @vscode/test-electron: https://github.com/microsoft/vscode-test
- Keep a Changelog: https://keepachangelog.com/zh-CN/1.1.0/
- SemVer: https://semver.org/lang/zh-CN/

---

**变更记录**(本文件自身的):

- 2026-08-16 初版,基于 CTM v0.1.4 仓库状态