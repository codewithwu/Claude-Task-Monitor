#!/usr/bin/env bash
set -e
dir="$HOME/.claude-task-monitor/sessions"
mkdir -p "$dir"
payload=$(cat)
session_id=$(echo "$payload" | jq -r '.session_id // empty')
event=$(echo "$payload" | jq -r '.hook_event_name // empty')
[ -z "$session_id" ] && exit 0
[ -z "$event" ] && exit 0

# Walk up the process tree to find the durable Claude Code CLI process.
# $PPID is the immediate parent of bash (a transient Node MainThread or
# sh subshell spawned per hook event). Recording that would make the
# liveness check 5s later see a dead PID and incorrectly clear the
# still-running session from the dashboard.
#
# 09-05 P0 #1: macOS 没有 /proc,旧版只走 /proc → cat 失败 → break → 回落到
# $PPID → session 闪现 2s 后被 pruneDeadSessions 误杀。现在按平台分支:
#   Linux  走 /proc/<pid>/comm + /proc/<pid>/status 的 PPid (零 fork,直读)
#   Darwin 走 ps -o comm=,ppid= (POSIX 兼容,macOS ps 字段可能带尾随空格)
# spec:.trellis/spec/liveness.md#pid-capture-lives-in-hooksh-not-livenessts

# 读取进程的 comm (短进程名)。失败返回非 0 让 caller break。
get_comm() {
  local pid=$1
  case "$(uname -s)" in
    Linux)  cat "/proc/$pid/comm" 2>/dev/null ;;
    Darwin) ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ' ;;
    *)      return 1 ;;
  esac
}

# 读取进程的父 PID。失败返回非 0。
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
# Fallback when no claude ancestor exists (e.g., hook run manually for tests).
effective_pid=${claude_pid:-$PPID}

echo "$payload" | jq -c --argjson pid "$effective_pid" '. + {ts: now, pid: $pid}' >> "$dir/$session_id.jsonl"

if [ "$event" = "SessionEnd" ]; then
  mkdir -p "$dir/.ended"
  mv "$dir/$session_id.jsonl" "$dir/.ended/$session_id-$(date +%s)-$$.jsonl" 2>/dev/null || true
fi
