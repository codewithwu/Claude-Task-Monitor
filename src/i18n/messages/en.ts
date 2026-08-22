// English strings (fallback locale).
// Key 命名:<area>.<context>.<id> —— 同 area 内聚,易于查找。

export const en: Record<string, string> = {
  // ─── status bar / sidebar 状态 ───
  'status.label': 'CTM',
  'status.tooltip.empty': 'Claude Task Monitor · {0} sessions active',
  'status.tooltip.waitingOne': '1 waiting session: {0}',
  'status.tooltip.waitingMany': '{0} waiting sessions: {1}',
  'status.tooltip.waitingManyTruncated': '{0} waiting sessions: {1} and {2} more',
  'status.waitingSuffix': '{0}⚠',

  // ─── sidebar badge tooltip ───
  'badge.tooltip.one': '1 session waiting for permission',
  'badge.tooltip.many': '{0} sessions waiting for permission',

  // ─── row presentation status (sidebar row description) ───
  'status.label.waiting': 'Waiting',
  'status.label.running': 'Running',
  'status.label.idle': 'Idle',

  // ─── notifications row / sidebar 状态 (single / aggregate) ───
  'notify.single': '{0} waiting for permission: {1}',
  'notify.aggregate.short': '{0} sessions waiting: {1}',
  'notify.aggregate.long': '{0} sessions waiting: {1} and {2} more',
  'notify.action.openProject': 'Open Project',
  'notify.action.viewSidebar': 'View Sidebar',

  // ─── onboarding ───
  'onboarding.card.ok': '🎉 Claude Task Monitor is active\n\nThree steps to start:\n\n1️⃣ Install hook (click the button below)\n2️⃣ Run `claude` in a terminal\n3️⃣ Red dot appears in sidebar when a session is waiting',
  'onboarding.card.jqMissing': '⚠️ Claude Task Monitor needs `jq` first\n\nThe hook relies on jq to parse Claude Code event payloads. Pick your system:\n\n• macOS: brew install jq\n• Debian/Ubuntu: sudo apt install jq\n• Windows: download binary from stedolan.github.io/jq and add to PATH\n\nAfter installing jq, restart VS Code.',
  'onboarding.button.installHook': 'Install hook',
  'onboarding.button.skip': 'Skip',
  'onboarding.button.copyBrew': 'Copy brew command',
  'onboarding.button.copyApt': 'Copy apt command',
  'onboarding.toast.installed': 'Claude Task Monitor: hook installed. Run `claude` now; the red dot appears in the sidebar when a session is waiting.',
  'onboarding.toast.copied': 'Copied: {0}. Paste in a terminal, then restart VS Code after jq is installed.',

  // ─── sidebar banner (jq missing) ───
  'banner.jqMissing': '⚠️ Claude Task Monitor needs `jq` to work.\n\n[Copy command](command:claudeTaskMonitor.copyJqInstallCommand) · [Show onboarding](command:claudeTaskMonitor.showOnboarding)',

  // ─── hook install / reinstall toast ───
  'hook.install.ok': 'Claude Task Monitor: hook installed. Run `claude` now; the red dot appears in the sidebar when a session is waiting.',
  'hook.install.fail': 'Claude Task Monitor: hook install failed: {0}',

  // ─── mute / / pin ───
  'mute.on': 'Claude Task Monitor: {0} notifications muted',
  'mute.off': 'Claude Task Monitor: {0} notifications resumed',

  // ─── filter / / quickPick ───
  'filter.title': 'Claude Task Monitor: Select Filter',
  'filter.placeholder': 'All / Waiting / Running / Idle',
  'filter.label.all': 'All',
  'filter.label.waiting': 'Waiting for permission',
  'filter.label.running': 'Running',
  'filter.label.idle': 'Idle',

  // ─── session noSelection warning ───
  'warn.noSelection': 'Claude Task Monitor: please select a session in the sidebar first',

  // ─── jq install command (label only) ───
  'jqInstall.darwin': 'brew install jq',
  'jqInstall.linux': 'sudo apt install jq',
  'jqInstall.win32': 'winget install jqlang.jq'
}