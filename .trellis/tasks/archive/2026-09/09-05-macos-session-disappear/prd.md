# P0 #1 — macOS 上 session 大概率会自己消失

> 来源:`notes/improvement-backlog.md` 第 20 行(基线 v0.3.5 / commit `5df5303`)。
> 排序:止血项,#2 之后的第二优先级(当前最高未做 P0)。

## 1. 背景与现状

`resources/hook.sh` 的 PID 上溯循环只走 `/proc/$pid/comm`:

```bash
comm=$(cat /proc/"$current"/comm 2>/dev/null) || break
current=$(awk '/^PPid:/{print $2}' /proc/"$current"/status 2>/dev/null) || break
```

`/proc` 是 Linux 特有的虚拟文件系统,macOS / BSD 没有等价物。

### 现状问题链

```
hook.sh 在 macOS 上跑
  → cat /proc/<pid>/comm 失败 (No such file)
  → || break 退出上溯循环
  → claude_pid="" (空)
  → effective_pid=${claude_pid:-$PPID} = 那个 transient 的 node MainThread / sh 子壳
  → 5 秒后 src/liveness.ts:113 pruneDeadSessions 走 checkViaPsFallback
  → transient PPID 已死 → isProcessGone=true → setDyingAt → 2s 后归档+移除
```

净效果:macOS 用户每触发一次 hook,会话在 sidebar 闪现约 2s 后消失。这违背了
spec `.trellis/spec/liveness.md` 第 102-112 行「Conservative Defaults」
的首要原则——**unknown = alive, never proactively kill**。

## 2. 目标

- macOS 上 hook.sh 能正确沿进程树向上找到 comm=`claude` 的祖先并捕获其 PID。
- 若祖先链上没有 `claude`(用户手动跑 hook 测试等),**退化为 $PPID**(与 Linux 现状一致)。
- Linux / WSL 行为**完全不变**(`/proc` 路径优先级最高,不动)。
- 不引入新依赖,纯 bash + 系统自带 `ps`。

## 3. 非目标

- 不动 `src/liveness.ts` 的 `isProcessGone` 平台路由——它处理「判断 PID 是否还活」,
  与本任务的「找到正确的 PID」是两件事。
- 不重写 hook.sh 成更现代的形式(如 `hook.mjs`)——属于 #11 重构范围。
- 不优化 hook.sh 在 Windows 上的行为——Claude Code CLI 在 Windows 上以 WSL2 方式跑,
  走 Linux 路径。

## 4. 约束

- **平台差异**:`ps` 在 macOS 与 Linux 上语法差异:
  - macOS `ps -o ppid=,comm= -p <pid>` 输出格式 `<ppid> <comm>`,`comm` 最多 16 字符,可能含空格。
  - Linux `ps -o ppid=,comm= -p <pid>` 同样支持(非 GNU 扩展,POSIX 兼容),可用同一份代码。
- **可移植性**:`bash` 4+ on macOS 自带 `read -r`(macOS 默认 bash 3.2 也支持)。
  不依赖 `read -d` / `mapfile` 等 bash 4+ 特性。
- **不动 `set -e` 行为**:hook.sh 当前 `set -e`,失败应自然 break 而不是吞掉。
- **测试隔离**:`setSelfComm('/proc/self/comm')` Linux-only → 测试在 macOS 跳过的策略延续,
  但 bash 语法层可通过 `bash -n resources/hook.sh` 在任何平台做静态校验。

## 5. 验收标准

| # | 验收项 | 验证手段 |
|---|---|---|
| AC1 | `resources/hook.sh` 在 Linux 上行为不变 —— `/proc` 路径优先,上溯逻辑保持 | 跑现有 `src/test/hook.test.ts` 三个 PID 用例,全过 |
| AC2 | `resources/hook.sh` 在 macOS 上,祖先链中有 `claude` 时,捕获其 PID(而非 PPID) | macOS 手工跑 hook + claude CLI;或代码评审 + bash 静态校验 |
| AC3 | `resources/hook.sh` 在 macOS 上,祖先链中无 `claude` 时,降级为 $PPID | macOS 手工 `bash resources/hook.sh` <<< '<payload>' 验 |
| AC4 | 新增 macOS 分支的 `ps -o ppid=,comm= -p $current` 调用**失败**(进程已退出)时不挂死 | `bash -n` 静态语法 + 失败路径 break(沿用现有 `\|\| break` 模式) |
| AC5 | `pnpm test` 全绿,新增 ≥2 个针对 macOS 分支的 shell 单测 | 用 `bash -c` 模拟 macOS 环境(uname 拦截)或直接 host=macOS 跑 |
| AC6 | `pnpm build` 通过(`resources/hook.sh` 不是 tsup 入口,但要确保无副作用) | `pnpm build` 退出 0 |
| AC7 | macOS 用户跑 5 个 liveness tick(≥ 25s)后,sidebar 条目仍在 | macOS 手工验证 / CI 跑 macOS job |
| AC8 | `.trellis/spec/liveness.md` 的 §Source map 增加 hook.sh 行(若有) | spec 同步 |

## 6. 风险与回滚

- **风险 1**:`ps` 在 macOS 上的 `comm` 字段截断为 16 字符,`claude` 没问题(`claude` < 16),
  但 `claude-code` 这种就截断为 `claude-code\0...`,需要确认 Claude Code CLI 实际进程名。
  - **缓解**:`ps -o comm=` 在 macOS 上对短名不会截断;实测验证。退一步即便截断,`= claude*` prefix 匹配仍可命中。
- **风险 2**:macOS 默认 bash 3.2 与项目内 bash 4+ 写法不兼容。
  - **缓解**:`read -r ppid comm <<< "$(...)"` 在 bash 3.2 也支持,避免 bash 4+ 专属语法。
- **风险 3**:CI 无 macOS runner,新增测试在 Linux 上无法真跑 macOS 路径。
  - **缓解**:通过 stub `uname` / `OSTYPE` 或拆出独立函数 `walk_ancestors_for_claude`,
    在测试里直接调它并传 mock 出去的 `ps` 输出,Linux 主测 + macOS 单测可独立覆盖。
- **回滚**:`git revert` 单 commit 即可,Linux 路径不受影响。

## 7. 范围外但相关

- 完整重写 hook.sh 为 Node(`hook.mjs`)是 #11 任务,本任务不掺和。
- 增加 macOS CI runner 也不在本任务,留给后续基础设施决策。
