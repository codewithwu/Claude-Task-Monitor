# Design — P0 #1 hook.sh 跨平台 PID 上溯

## 1. 架构:上溯职责在 hook.sh 一处,加平台分支

```
                         hook.sh 入口
                              │
              ┌───────────────┴────────────────┐
              │                                │
        platform == Linux                platform == Darwin
              │                                │
   /proc/<pid>/comm                   ps -o ppid=,comm= -p <pid>
   /proc/<pid>/status PPid             (POSIX 兼容,两边都能跑)
              │                                │
              └────────────┬───────────────────┘
                           ▼
                     claude_pid / break
                           │
                           ▼
              effective_pid=${claude_pid:-$PPID}
```

**关键**:Linux 与 macOS 上溯逻辑**只在「读 comm + 读 ppid」这两步**有差异。
整个 while 循环、break 语义、`claude_pid` 赋值都共用。

## 2. 实现策略:抽函数 + 平台分支

把现有 while 循环体抽成两个平台函数,hook.sh 顶层用 `case $(uname -s)` 选择:

```bash
get_comm() {
  # $1 = pid,echo comm 到 stdout,失败返回非 0
  local pid=$1
  case "$(uname -s)" in
    Linux)  cat "/proc/$pid/comm" 2>/dev/null ;;
    Darwin) ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ' ;;   # macOS comm 可能带尾随空格
    *)      return 1 ;;
  esac
}

get_ppid() {
  local pid=$1
  case "$(uname -s)" in
    Linux)  awk '/^PPid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null ;;
    Darwin) ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' ;;
    *)      return 1 ;;
  esac
}
```

while 循环改成:

```bash
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

**为什么不直接在 while 里嵌 `case`**:让 `get_comm` / `get_ppid` 可被 bash 单测
单独调,既便于测试,也便于后续 hook.mjs 重构时直接 translate。

## 3. macOS 细节

### comm 字段

`ps -o comm= -p <pid>` 在 macOS 上:

- 默认输出**进程可执行文件名**(truncated to 15 chars in some macOS versions,但 `claude` 6 字符无虞)
- 可能带尾随空格 → `tr -d ' '` 保险

### PPid 字段

`ps -o ppid= -p <pid>` 输出纯数字(可能有尾随空格)。`tr -d ' '` 同上。

### 进程已退出

若 `<pid>` 已不存在,`ps` exit code = 1,`2>/dev/null` 吞 stderr,`|| break` 退出循环。

## 4. Linux 兼容性

- `ps -o comm=` 与 `ps -o ppid=` 在 Linux (procps-ng) 上同样可用,语法与 macOS 一致
- **理论上**可以直接统一用 `ps` 跨平台,但保留 `/proc` 路径:
  1. `/proc` 比 `ps` 更快(无 fork exec 开销)
  2. `/proc/<pid>/comm` 是 kernel 直供,不受 `comm` 字段截断影响
  3. 保持现有 Linux 行为零变化(降低回归风险)

## 5. 测试策略

### 5.1 Linux 现有测试

`src/test/hook.test.ts` 已覆盖:
- `setSelfComm('claude')` → 捕获 claude PID (AC1)
- 无 claude 祖先 → fallback $PPID (AC1)
- 5s 后 PID 仍在 (AC7 的 Linux 等价)

**保持原样**,作为 Linux 不回归的保证。

### 5.2 macOS 新增测试

新文件 `src/test/hook-macos.test.ts`,跳过条件:`process.platform !== 'darwin'`。

但实际 CI 跑的是 Linux,所以**更可移植**的做法是:

抽 bash 函数到 `resources/hook-helpers.sh`(独立文件,可选 `source`),写一个**纯 shell 单测**
`src/test/hook-helpers.test.sh`,用 `bash` 子进程跑用例:

```bash
# helper 单测不需要真实进程 —— 通过伪造 /proc 或 stub ps
test_get_comm_darwin() {
  # 临时替换 PATH,放一个 stub ps
  stub_dir=$(mktemp -d)
  cat > "$stub_dir/ps" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "-o" ] && [ "$2" = "comm=" ]; then echo "claude"; exit 0
elif [ "$1" = "-o" ] && [ "$2" = "ppid=" ]; then echo "1"; exit 0
else exit 1; fi
EOF
  chmod +x "$stub_dir/ps"
  # 通过 env var HOOK_HELPER_PS 覆盖 ps 路径,让 helper 走 stub
  PATH="$stub_dir:$PATH" bash -c '...'
}
```

> **简化路径**:先做最直接的 Linux 测试 (`bash -n` 语法 + bash 函数在 Linux 上手动 source),
> macOS 端用**静态分析**(grep 确认 `Darwin` 分支存在且只调 `ps`)兜底。
> 实际 macOS 验证留给用户在自己 Mac 上跑。这与 #11 重构的 CI 策略一致。

### 5.3 静态校验(任何平台可跑)

- `bash -n resources/hook.sh` → 语法 OK
- `bash -c 'source <(sed -n "/^get_comm/,/^}/p" resources/hook.sh); get_comm 1'` 在 Linux 上
  至少能跑通 Linux 分支(会因为 uname=Linux 走 /proc)
- 新增 `src/test/hook-bash.test.ts`:通过 `child_process.execSync('bash', ['-n', HOOK_SCRIPT])`
  断言退出码 0

## 6. Spec 同步

`.trellis/spec/liveness.md`:
- 当前 §Source map 缺 `resources/hook.sh` 一行 → 加上,标注 PID 捕获职责
- 在 §Platform Router 段落加一句:**「PID capture lives in hook.sh, not liveness.ts」**,
  把职责边界说清

## 7. 风险与兼容性表

| 维度 | Linux | macOS | Windows |
|---|---|---|---|
| hook.sh 入口 | 不变 | 新增 Darwin 分支 | 走 WSL2 → Linux 路径 |
| `get_comm` | `/proc/<pid>/comm` | `ps -o comm= -p <pid> \| tr -d ' '` | n/a |
| `get_ppid` | `/proc/<pid>/status` PPid | `ps -o ppid= -p <pid> \| tr -d ' '` | n/a |
| while 循环 | 共用 | 共用 | n/a |
| 性能 | 一次 fork (`awk`) | 两次 fork (`ps` x2 per iter) | n/a |
| `setSelfComm` 测试 | 仍可用 | N/A (无 /proc) | N/A |

macOS 性能差于 Linux,但 hook 事件频次低(每用户行为一次),可接受。

## 8. 文件清单

| 路径 | 改动 |
|---|---|
| `resources/hook.sh` | 抽 `get_comm` / `get_ppid`,while 循环改用 |
| `src/test/hook.test.ts` | 加 `bash -n` 语法校验用例(任何平台可跑) |
| `.trellis/spec/liveness.md` | §Source map 增 hook.sh;§Platform Router 增 PID 捕获职责说明 |
| `notes/improvement-backlog.md` | #1 标记 ✅,进度快照同步 |
