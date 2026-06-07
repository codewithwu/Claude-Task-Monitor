#!/usr/bin/env bash
set -e
dir="$HOME/.claude-task-monitor/sessions"
mkdir -p "$dir"
payload=$(cat)
session_id=$(echo "$payload" | jq -r '.session_id // empty')
event=$(echo "$payload" | jq -r '.hook_event_name // empty')
[ -z "$session_id" ] && exit 0
[ -z "$event" ] && exit 0

if [ "$event" = "SessionStart" ]; then
  echo "$payload" | jq -c --argjson pid "$PPID" '. + {ts: now, pid: $pid}' >> "$dir/$session_id.jsonl"
else
  echo "$payload" | jq -c '. + {ts: now}' >> "$dir/$session_id.jsonl"
fi

if [ "$event" = "SessionEnd" ]; then
  mkdir -p "$dir/.ended"
  mv "$dir/$session_id.jsonl" "$dir/.ended/$session_id-$(date +%s).jsonl" 2>/dev/null || true
fi
