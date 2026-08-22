// 中文文案 (主语言,因为用户用中文交流)。
// Key 必须与 en.ts 完全对齐 —— 添加新 key 时两边一起加。

export const zh: Record<string, string> = {
  // ─── status bar / sidebar 状态 ───
  'status.label': 'CTM',
  'status.tooltip.empty': 'Claude Task Monitor · {0} 个会话',
  'status.tooltip.waitingOne': '1 个等待权限：{0}',
  'status.tooltip.waitingMany': '{0} 个等待权限：{1}',
  'status.tooltip.waitingManyTruncated': '{0} 个等待权限：{1} 等 {2} 个',
  'status.waitingSuffix': '{0}⚠',

  // ─── sidebar badge tooltip ───
  'badge.tooltip.one': '1 个会话正在等待权限确认',
  'badge.tooltip.many': '{0} 个会话正在等待权限确认',

  // ─── row presentation status ───
  'status.label.waiting': '等待权限',
  'status.label.running': '运行中',
  'status.label.idle': '待命',

  // ─── notifications row / sidebar 状态 (single / aggregate) ───
  'notify.single': '{0} 等待权限确认：{1}',
  'notify.aggregate.short': '{0} 个会话正在等待：{1}',
  'notify.aggregate.long': '{0} 个会话正在等待：{1} 等 {2} 个',
  'notify.action.openProject': '打开项目',
  'notify.action.viewSidebar': '查看侧边栏',

  // ─── onboarding ───
  'onboarding.card.ok': '🎉 Claude Task Monitor 已激活\n\n三步开始使用：\n\n1️⃣ 安装 hook（点下方按钮）\n2️⃣ 打开终端运行 claude\n3️⃣ 等待权限时，红点会出现在侧边栏',
  'onboarding.card.jqMissing': '⚠️ Claude Task Monitor 需要先安装 jq\n\nhook 依赖 jq 解析 Claude Code 事件载荷。按系统选其一：\n\n• macOS：brew install jq\n• Debian/Ubuntu：sudo apt install jq\n• Windows：从 stedolan.github.io/jq/download/ 下载二进制加入 PATH\n\n安装完 jq 后重启 VS Code。',
  'onboarding.button.installHook': '安装 hook',
  'onboarding.button.skip': '跳过',
  'onboarding.button.copyBrew': '复制 brew 命令',
  'onboarding.button.copyApt': '复制 apt 命令',
  'onboarding.toast.installed': 'Claude Task Monitor：hook 已安装。现在启动 claude，有 waiting 时侧边栏会出现红点。',
  'onboarding.toast.copied': '已复制：{0}。粘贴到终端运行，装好后重启 VS Code。',

  // ─── sidebar banner (jq missing) ───
  'banner.jqMissing': '⚠️ Claude Task Monitor 需要 `jq` 才能工作。\n\n[复制安装命令](command:claudeTaskMonitor.copyJqInstallCommand) · [查看 onboarding](command:claudeTaskMonitor.showOnboarding)',

  // ─── hook install / reinstall toast ───
  'hook.install.ok': 'Claude Task Monitor：hook 已安装。现在启动 claude，有 waiting 时侧边栏会出现红点。',
  'hook.install.fail': 'Claude Task Monitor：hook 安装失败：{0}',

  // ─── mute / / pin ───
  'mute.on': 'Claude Task Monitor：{0} 通知已静音',
  'mute.off': 'Claude Task Monitor：{0} 通知已恢复',

  // ─── filter / / quickPick ───
  'filter.title': 'Claude Task Monitor：选择过滤模式',
  'filter.placeholder': '全部 / 等待 / 运行 / 待命',
  'filter.label.all': '全部 (All)',
  'filter.label.waiting': '等待权限 (Waiting)',
  'filter.label.running': '运行中 (Running)',
  'filter.label.idle': '待命 (Idle)',

  // ─── session noSelection warning ───
  'warn.noSelection': 'Claude Task Monitor：请先在侧边栏选中一个 session',

  // ─── jq install command (label only) ───
  'jqInstall.darwin': 'brew install jq',
  'jqInstall.linux': 'sudo apt install jq',
  'jqInstall.win32': 'winget install jqlang.jq',

  // ─── lang toggle status bar (08-23 ui-lang-toggle) ───
  // 短文本图标 (A/中/EN) 写在 LangToggle.ts,这里只放状态名 + tooltip 模板。
  // {0} = 当前状态名, {1} = 下次点击会切到的状态名
  'lang.toggle.state.auto': '自动',
  'lang.toggle.state.zh': '中文',
  'lang.toggle.state.en': '英文',
  'lang.toggle.tooltip': '界面语言: {0}\n点击切换到 {1}\n命令面板名称跟随 VS Code display language'
}