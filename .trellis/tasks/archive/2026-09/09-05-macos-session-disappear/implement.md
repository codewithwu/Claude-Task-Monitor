# Implement — P0 #1 hook.sh 跨平台 PID 上溯

## 0. 顺序

```
T1 [resources/hook.sh] 抽 get_comm / get_ppid + while 改用
        │
        ▼
T2 [src/test/hook.test.ts] 加 bash -n 语法校验 + Darwin 分支 dry-run
        │
        ▼
T3 [.trellis/spec/liveness.md] Source map 增 hook.sh,职责边界注明
        │
        ▼
T4 [notes/improvement-backlog.md] #1 标记完成
        │
        ▼
T5 [validation] pnpm test 全过,grep 校验,git commit + archive
```

## 1. T1 — `resources/hook.sh` 抽函数

当前循环(行 16-25):

```bash
claude_pid=""
current=$PPID
while [ -n "$current" ] && [ "$current" != "1" ]; do
  comm=$(cat /proc/"$current"/comm 2>/dev/null) || break
  if [ "$comm" = "claude" ]; then
    claude_pid=$current
    break
  fi
  current=$(awk '/^PPid:/{print $2}' /proc/"$current"/status 2>/dev/null) || break
done
```

替换为:

```bash
# 读取进程的 comm(短进程名)。失败返回非 0。
# Linux: /proc 直读,零 fork。macOS: ps -o comm=,可能带尾随空格,tr 去掉。
# Windows 不支持(走 WSL2 路径 → 走 Linux 分支)。
get_comm() {
  local pid=$1
  case "$(uname -s)" in
    Linux)  cat "/proc/$pid/comm" 2>/dev/null ;;
    Darwin) ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ' ;;
    *)      return 1 ;;
  esac
}

# 读取进程的父 PID。失败返回非 0。
# Linux: /proc/<pid>/status 的 PPid 字段。macOS: ps -o ppid=。
get_ppid() {
  local pid=$1
  case "$(uname -s)" in
    Linux)  awk '/^PPid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null ;;
    Darwin) ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' ;;
    *)      return 1 ;;
  esac
}

claude_pid=""
current=$PPID
while [ -n "$current" ] && [ "$current" != "1" ]; do
  comm=$(get_comm "$current") || break
  if [ "$comm" = "claude" ]; then
    claude_pid=$current
    break
  fi
  current=$(get_ppid "$current") || break
done
```

注释:职责变更说明 + 「Conservative Defaults」spec 引用。

## 2. T2 — 加 bash 语法校验测试

在 `src/test/hook.test.ts` 末尾新增:

```ts
import { execFileSync } from 'node:child_process'

describe('hook.sh bash 语法校验', () => {
  it('bash -n 通过 (任意平台)', () => {
    expect(() =>
      execFileSync('bash', ['-n', HOOK_SCRIPT], { stdio: 'pipe' })
    ).not.toThrow()
  })

  it('Linux 分支 source 出来可调 get_comm / get_ppid', () => {
    if (process.platform !== 'linux') return
    // 从 hook.sh 抽出 get_comm / get_ppid 函数定义,source 进当前 bash
    const src = execFileSync('bash', ['-c', `
      set -e
      HOOK="$1"
      # 取两个函数的定义行(从 ^get_comm 起,到第一个独立 ^} 止)
      sed -n '/^get_comm()/,/^}$/p; /^get_ppid()/,/^}$/p' "$HOOK"
    `, '_', HOOK_SCRIPT], { encoding: 'utf8' })

    const out = execFileSync('bash', ['-c', src + '\necho "ok: $(get_comm 1)"'], { encoding: 'utf8' })
    expect(out).toContain('ok:')
  })
})
```

> 第二条用例 Linux-only skip,跟现有 `setSelfComm` 跳非 Linux 的风格一致。

## 3. T3 — `.trellis/spec/liveness.md` 同步

两处改动:

### §Source map 增一行

在表格里加:
```
| `resources/hook.sh` | 11–32 | 上溯进程树捕获 claude PID(平台分支:Linux /proc;macOS ps) |
```

### §Platform Router 段落补一句

紧接「`isProcessGone` 路由 by platform」图后加:

> **PID capture is in `hook.sh`, not here.** `isProcessGone` only judges an *already-captured* PID; the work of finding the durable Claude Code CLI PID by walking up `$PPID` lives in `hook.sh` and is platform-split (Linux reads `/proc`; macOS falls back to `ps`). If the captured PID is the transient `sh` or `node MainThread` instead of `claude`, the 5s liveness tick will correctly identify it as gone — that's why hook.sh's lookup matters.

## 4. T4 — `notes/improvement-backlog.md`

- 行 20:`⏳ 待做` → `✅ 已完成`,涉及行改为 `resources/hook.sh (跨平台分支)`
- 行 11 进度快照:`#2 关窗口弹「移除 hook」对话框` 后追加 `#1 macOS session 消失(task 09-05-macos-session-disappear)`
- 行 12 剩余项:9 → 8

## 5. T5 — 验证

```bash
pnpm build                                       # 退出 0
pnpm test                                        # 286 → ≥ 288 全过
bash -n resources/hook.sh                        # 退出 0
grep -n "Darwin\|ps -o" resources/hook.sh        # 应有 Darwin 分支 + ps 调用
grep -n "get_comm\|get_ppid" resources/hook.sh   # 应有两个函数定义 + 调用
```

人工冒烟(若有 macOS):

```bash
# 在 Mac 上,terminal 1 跑 claude CLI(假设进程名是 claude)
# terminal 2 触发任意 hook
# tail -f ~/.claude-task-monitor/sessions/*.jsonl → 最后一条的 pid 字段应该是 claude 的 PID
# 等 30s,session 仍在 sidebar
```

## 6. 回滚

`git revert` 单 commit。Linux 路径不变,只撤掉 macOS 分支(→ 回到 break,fail-open 但用户体验差)。

## 7. 检查清单

- [ ] `hook.sh` 抽 `get_comm` / `get_ppid`,while 改用
- [ ] `hook.test.ts` 加 bash 语法校验
- [ ] `liveness.md` §Source map + 职责说明同步
- [ ] backlog #1 标记 ✅ + 快照同步
- [ ] `pnpm test` 全绿
- [ ] `bash -n resources/hook.sh` 通过
- [ ] `grep` 校验通过
- [ ] commit + archive task
