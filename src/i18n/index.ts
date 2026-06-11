import { computed, ref } from 'vue'

export type Locale = 'zh-CN' | 'en-US'

const STORAGE_KEY = 'jc_locale'

const messages = {
  'zh-CN': {
    common: {
      chinese: '中文',
      english: 'EN',
      processing: '处理中...',
      cancel: '取消',
      loading: '加载中...',
    },
    rail: {
      brand: '韭菜盒子',
      createAgent: 'Skill缔造',
      agents: '对话 Skill',
      skillsManage: 'Skill管理',
      createVault: '创建知识库',
      vaults: '知识库仓库',
      tools: '工具仓库',
      mcp: 'MCP管理',
      canvas: '画布',
      editor: '编辑区',
      creation: '创作面板',
      files: '文件',
      userCenter: '用户中心',
      help: '帮助 / 教程中心',
      loginRequired: '请先登录',
      memberOnly: '需要登录',
    },
    settings: {
      title: '用户中心',
      login: '登录',
      register: '注册',
      loginTitle: '登录韭菜盒子账号',
      registerTitle: '创建韭菜盒子账号',
      username: '用户名',
      email: '邮箱',
      verificationCode: '邮箱验证码',
      sendCode: '发送验证码',
      sendingCode: '发送中',
      password: '密码',
      inviteCodeOptional: '邀请码（选填）',
      loginSubmit: '登录',
      registerSubmit: '注册并登录',
      availableAfterLogin: '会员可用',
      currentAccount: '当前账号',
      balance: '账户余额',
      creditsRate: '100 韭菜花 = 1 元',
      membership: '会员等级',
      memberOpen: '开通',
      memberOpened: '已开通',
      memberProcessing: '处理中...',
      memberInsufficient: '余额不足，去充值',
      memberUntil: '有效期至 {date}',
      memberSynced: '有效期已同步',
      openMembership: '开通韭菜盒子会员',
      membershipCost: '将消耗 999 韭菜花，开通后有效期 30 天。',
      openingMember: '开通中...',
      confirmOpen: '确认开通',
      checkin: '签到',
      checkingIn: '签到中',
      checkedIn: '已签到',
      invite: '邀请',
      redeem: '兑换',
      logs: '明细',
      topup: '充值',
      yuan: '元',
      custom: '自定义',
      customAmount: '自定义金额',
      wechat: '微信',
      alipay: '支付宝',
      creating: '创建中...',
      createTopupQr: '创建充值二维码',
      generatedPayQr: '支付二维码',
      openPayLink: '打开支付链接',
      openPayLinkPrimary: '打开支付页面',
      payQrImageHint: '请使用手机扫码付款，付款后点击刷新余额',
      payScanHint: '请使用手机扫码付款，付款后点击刷新余额',
      payLinkOnlyHint: '当前通道只返回支付页面，请点击下方按钮完成付款',
      refreshBalance: '刷新余额',
      inviteUsers: '邀请新用户',
      inviteCode: '邀请码',
      syncing: '同步中',
      copyInviteLink: '复制邀请链接',
      inviteCount: '邀请人数',
      rewardCredits: '奖励韭菜花',
      redeemCode: '兑换码',
      enterRedeemCode: '输入兑换码',
      redeeming: '兑换中...',
      creditLogs: '韭菜花明细',
      time: '时间',
      item: '项目',
      change: '变化',
      current: '当前使用',
      switching: '切换中...',
      logout: '退出登录',
      appearance: '外观',
      language: '语言',
      themeWhite: '白色',
      themeLight: '浅色',
      themeDark: '黑夜',
      themeGreen: '护眼',
      fontSize: '字号',
      bigFontOn: '大字模式已开启',
      bigFont: '大字模式',
      dataMigration: '数据迁移',
      community: '社群交流',
      communityText: '欢迎加群互相学习交流',
      version: '韭菜盒子 V7.0 · 桌面版',
    },
    help: {
      eyebrow: 'OpenCode 工作台指南',
      title: '帮助 / 教程中心',
      openAccount: '打开用户中心',
      dismiss: '关闭',
      chatTitle: '开始对话',
      chatText: '第 4 列始终是对话区。选择Skill、知识库或模型后，直接输入任务即可。',
      agentTitle: 'Skill',
      agentText: '从对话 Skill 启用现成工作流，也可以创建自己的Skill沉淀成 SKILL.md。',
      vaultTitle: '知识库',
      vaultText: '知识库会优先作为你的标准答案，适合项目资料、写作规则和长期记忆。',
      accountTitle: '账户和韭菜花',
      accountText: '用户中心里登录账号，同步余额、会员、本地 Ollama 和网页版备份。',
      toolsTitle: '工具',
      toolsText: '工具仓库、文件、编辑区和画布都保留在桌面端，适合本地资料处理和成品输出。',
      desktopLocal: '桌面版保留本地 Ollama、文件、画布和编辑区能力。',
    },
    chat: {
      newChat: '新建对话',
      send: '发送',
      placeholder: '给Skill发指令...',
      fileAttach: '上传文件',
      dropFiles: '拖拽文件到此处上传',
      copy: '复制',
      copied: '已复制',
      retry: '重发',
      delete: '删除',
      edit: '编辑',
      regenerate: '重新生成',
      reply: '引用回复',
      speak: '朗读',
      stopSpeak: '停止',
      continueWriting: '继续写',
      export: '导出',
      thinking: '查看思考过程',
      hideThinking: '收起思考',
      codeCopy: '复制',
      codeCopied: '已复制',
      searchRefs: '搜索引用',
      tempChat: '临时对话',
      saveMode: '保存',
      parallelMode: '多模型对比',
      parallelActive: '对比中',
      parallelSelected: '已选 {n} 个模型',
      userLabel: '你',
      assistantLabel: '助手',
      toolLabel: '工具',
      justNow: '刚刚',
      minutesAgo: '{n}分钟前',
      hoursAgo: '{n}小时前',
      yesterday: '昨天',
      replyContext: '回复',
    },
  },
  'en-US': {
    common: {
      chinese: '中文',
      english: 'EN',
      processing: 'Processing...',
      cancel: 'Cancel',
      loading: 'Loading...',
    },
    rail: {
      brand: 'Jiucai Studio',
      createAgent: 'Create Skill',
      agents: 'Chat Skills',
      skillsManage: 'Skill Manager',
      createVault: 'Create Knowledge',
      vaults: 'Knowledge',
      tools: 'Tools',
      mcp: 'MCP Manager',
      canvas: 'Canvas',
      editor: 'Editor',
      creation: 'Creation',
      files: 'Files',
      userCenter: 'Account',
      help: 'Help / Tutorials',
      loginRequired: 'Login required',
      memberOnly: 'Members only',
    },
    settings: {
      title: 'Account',
      login: 'Log In',
      register: 'Sign Up',
      loginTitle: 'Log in to Jiucai Studio',
      registerTitle: 'Create a Jiucai Studio account',
      username: 'Username',
      email: 'Email',
      verificationCode: 'Verification code',
      sendCode: 'Send code',
      sendingCode: 'Sending',
      password: 'Password',
      inviteCodeOptional: 'Invite code (optional)',
      loginSubmit: 'Log In',
      registerSubmit: 'Sign Up & Log In',
      availableAfterLogin: 'Available for members',
      currentAccount: 'Account',
      balance: 'Balance',
      creditsRate: '100 Jiucai Credits = ¥1',
      membership: 'Membership',
      memberOpen: 'Open',
      memberOpened: 'Active',
      memberProcessing: 'Processing...',
      memberInsufficient: 'Insufficient balance',
      memberUntil: 'Valid until {date}',
      memberSynced: 'Membership synced',
      openMembership: 'Open Jiucai Studio Membership',
      membershipCost: 'This will consume 999 Jiucai Credits and activate membership for 30 days.',
      openingMember: 'Opening...',
      confirmOpen: 'Confirm',
      checkin: 'Check in',
      checkingIn: 'Checking in',
      checkedIn: 'Checked in',
      invite: 'Invite',
      redeem: 'Redeem',
      logs: 'Logs',
      topup: 'Top up',
      yuan: 'Yuan',
      custom: 'Custom',
      customAmount: 'Custom amount',
      wechat: 'WeChat',
      alipay: 'Alipay',
      creating: 'Creating...',
      createTopupQr: 'Create payment QR',
      generatedPayQr: 'Payment QR',
      openPayLink: 'Open payment link',
      openPayLinkPrimary: 'Open payment page',
      payQrImageHint: 'Scan with your phone, then refresh balance after payment',
      payScanHint: 'Scan with your phone, then refresh balance after payment',
      payLinkOnlyHint: 'This channel returned a payment page only. Open it to finish payment.',
      refreshBalance: 'Refresh balance',
      inviteUsers: 'Invite users',
      inviteCode: 'Invite code',
      syncing: 'Syncing',
      copyInviteLink: 'Copy invite link',
      inviteCount: 'Invites',
      rewardCredits: 'Reward credits',
      redeemCode: 'Redeem code',
      enterRedeemCode: 'Enter redeem code',
      redeeming: 'Redeeming...',
      creditLogs: 'Credit logs',
      time: 'Time',
      item: 'Item',
      change: 'Change',
      current: 'Current',
      switching: 'Switching...',
      logout: 'Log Out',
      appearance: 'Appearance',
      language: 'Language',
      themeWhite: 'White',
      themeLight: 'Light',
      themeDark: 'Dark',
      themeGreen: 'Eye Care',
      fontSize: 'Font Size',
      bigFontOn: 'Large text enabled',
      bigFont: 'Large text',
      dataMigration: 'Data Migration',
      community: 'Community',
      communityText: 'Join the community to learn and exchange ideas.',
      version: 'Jiucai Studio V7.0 · Desktop',
    },
    help: {
      eyebrow: 'OpenCode Workbench Guide',
      title: 'Help / Tutorials',
      openAccount: 'Open Account',
      dismiss: 'Close',
      chatTitle: 'Start Chatting',
      chatText: 'The fourth column is always your chat area. Pick a skill, knowledge base, or model, then enter the task.',
      agentTitle: 'Skills',
      agentText: 'Enable ready-made workflows from Chat Skills, or create your own skill as a SKILL.md workflow.',
      vaultTitle: 'Knowledge',
      vaultText: 'Knowledge bases act as your source of truth for project material, writing rules, and long-term memory.',
      accountTitle: 'Account and Credits',
      accountText: 'Use Account to sign in, sync credits, membership, local Ollama, and web backups.',
      toolsTitle: 'Tools',
      toolsText: 'The desktop app keeps tools, files, editor, and canvas for local processing and final outputs.',
    },
    chat: {
      newChat: 'New Chat',
      send: 'Send',
      placeholder: 'Send a message...',
      fileAttach: 'Attach file',
      dropFiles: 'Drop files to upload',
      copy: 'Copy',
      copied: 'Copied',
      retry: 'Retry',
      delete: 'Delete',
      edit: 'Edit',
      regenerate: 'Regenerate',
      reply: 'Reply',
      speak: 'Read aloud',
      stopSpeak: 'Stop',
      continueWriting: 'Continue',
      export: 'Export',
      thinking: 'Thinking process',
      hideThinking: 'Hide thinking',
      codeCopy: 'Copy',
      codeCopied: 'Copied',
      searchRefs: 'Search references',
      tempChat: 'Temporary',
      saveMode: 'Save',
      parallelMode: 'Compare models',
      parallelActive: 'Comparing',
      parallelSelected: '{n} models selected',
      userLabel: 'You',
      assistantLabel: 'Assistant',
      toolLabel: 'Tool',
      justNow: 'Just now',
      minutesAgo: '{n}m ago',
      hoursAgo: '{n}h ago',
      yesterday: 'Yesterday',
      replyContext: 'Replying to',
    },
  },
} as const

type MessageTree = typeof messages['zh-CN']
type DotPrefix<T extends string, U extends string> = '' extends U ? T : `${T}.${U}`
type DotKeys<T> = T extends object
  ? { [K in keyof T & string]: T[K] extends object ? DotPrefix<K, DotKeys<T[K]>> : K }[keyof T & string]
  : ''

export type I18nKey = DotKeys<MessageTree>

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'zh-CN' || stored === 'en-US' ? stored : null
  } catch (_) {
    return null
  }
}

function detectDefaultLocale(): Locale {
  const stored = readStoredLocale()
  if (stored) return stored
  return 'zh-CN'
}

const locale = ref<Locale>(detectDefaultLocale())

function syncLocaleFromStorage() {
  const stored = readStoredLocale()
  const next = stored || 'zh-CN'
  if (next !== locale.value) locale.value = next
}

function lookup(localeKey: Locale, key: string): string {
  const parts = key.split('.')
  let current: any = messages[localeKey]
  for (const part of parts) current = current?.[part]
  if (typeof current === 'string') return current

  current = messages['zh-CN']
  for (const part of parts) current = current?.[part]
  return typeof current === 'string' ? current : key
}

export function t(key: I18nKey, params: Record<string, string | number> = {}): string {
  syncLocaleFromStorage()
  let text = lookup(locale.value, key)
  for (const [name, value] of Object.entries(params)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

export function setLocale(next: Locale): Locale {
  locale.value = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
    document.documentElement.lang = next
  } catch (_) {}
  return next
}

export function toggleLocale(): Locale {
  syncLocaleFromStorage()
  return setLocale(locale.value === 'en-US' ? 'zh-CN' : 'en-US')
}

export function getLocale(): Locale {
  syncLocaleFromStorage()
  return locale.value
}

export function currentLocale(): Locale {
  return getLocale()
}

export function currentAiLanguage(): '中文' | 'English' {
  return getLocale() === 'en-US' ? 'English' : '中文'
}

export function useLocale() {
  const isEnglish = computed(() => locale.value === 'en-US')
  const languageLabel = computed(() => locale.value === 'en-US' ? 'EN' : '中')
  return {
    locale,
    isEnglish,
    languageLabel,
    t,
    setLocale,
    toggleLocale,
  }
}
