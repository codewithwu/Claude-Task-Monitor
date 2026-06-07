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
# Fallback when no claude ancestor exists (e.g., hook run manually for tests).
effective_pid=${claude_pid:-$PPID}

echo "$payload" | jq -c --argjson pid "$effective_pid" '. + {ts: now, pid: $pid}' >> "$dir/$session_id.jsonl"

if [ "$event" = "SessionEnd" ]; then
  mkdir -p "$dir/.ended"
  mv "$dir/$session_id.jsonl" "$dir/.ended/$session_id-$(date +%s).jsonl" 2>/dev/null || true
fi
