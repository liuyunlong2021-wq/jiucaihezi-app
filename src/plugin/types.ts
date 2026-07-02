/**
 * plugin/types.ts — 插件系统类型定义
 *
 * 对齐 OpenCode @opencode-ai/plugin/v2 的 define() / PluginContext 接口。
 * 用 async/await 替代 Effect，用 Pinia store 替代 Service 层。
 */

// ─── 核心定义 ───

/** 插件注册（对齐 OpenCode Plugin.Registration） */
export interface PluginRegistration {
  readonly dispose: () => void
}

/** 插件定义（对齐 OpenCode plugin.ts define()） */
export interface PluginDefinition {
  readonly id: string
  readonly name?: string
  readonly version?: string
  readonly description?: string
  /** 插件入口：接收 PluginContext，注册 hooks/transforms */
  readonly setup: (ctx: PluginContext) => void | Promise<void>
}

/** 插件定义工厂（对齐 OpenCode define()） */
export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def
}

// ─── 可变换域（Transform Domain） ───

/** 变换域：注册回调修改领域对象（对齐 OpenCode transform） */
export interface TransformDomain<Draft> {
  /**
   * 注册变换回调。每次 rebuild 时回调会被调用。
   * @returns 可 dispose 的 Registration
   */
  transform(callback: (draft: Draft) => void | Promise<void>): PluginRegistration
  /** 触发所有已注册的变换 */
  rebuild(): void | Promise<void>
}

// ─── 钩子域（Hook Domain） ───

/** 钩子域：注册事件回调（对齐 OpenCode hook） */
export interface HookDomain<EventPayload> {
  /**
   * 注册钩子回调。每次事件触发时调用。
   * @returns 可 dispose 的 Registration
   */
  hook(callback: (payload: EventPayload) => void | Promise<void>): PluginRegistration
}

// ─── 插件上下文 ───

/**
 * 插件上下文（对齐 OpenCode PluginContext）。
 * 插件通过 ctx 访问宿主能力，注册 hooks/transforms。
 */
export interface PluginContext {
  /** 当前插件的 id */
  readonly pluginId: string

  // ── 领域 hooks ──

  /** 聊天消息钩子 */
  readonly chat: {
    /** 用户发送消息前 */
    readonly onSendBefore: HookDomain<ChatSendBeforePayload>
    /** AI 回复完成后 */
    readonly onReceiveAfter: HookDomain<ChatReceiveAfterPayload>
  }

  /** 工具执行钩子 */
  readonly tool: {
    /** 工具执行前 */
    readonly onExecuteBefore: HookDomain<ToolExecutePayload>
    /** 工具执行后 */
    readonly onExecuteAfter: HookDomain<ToolExecutePayload & { result: unknown }>
  }

  /** 系统事件钩子 */
  readonly event: {
    /** 订阅任意 eventBus 事件 */
    readonly subscribe: (eventName: string, callback: (...args: unknown[]) => void) => PluginRegistration
  }

  // ── 领域 transforms ──

  /** 模型目录变换（增删改模型） */
  readonly catalog: TransformDomain<CatalogDraft>

  /** 命令变换（增删改命令） */
  readonly command: TransformDomain<CommandDraft>

  /** Skill 变换（增删改 skill） */
  readonly skill: TransformDomain<SkillDraft>

  // ── 宿主能力 ──

  /** 获取宿主配置 */
  readonly config: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }

  /** 文件系统（Tauri 环境可用） */
  readonly fs: {
    readText(path: string): Promise<string>
    writeText(path: string, content: string): Promise<void>
    exists(path: string): Promise<boolean>
  }
}

// ─── 负载类型 ───

export interface ChatSendBeforePayload {
  text: string
  modelId: string
  sessionId: string
  /** 修改发送文本 */
  modifyText: (newText: string) => void
}

export interface ChatReceiveAfterPayload {
  content: string
  modelId: string
  sessionId: string
}

export interface ToolExecutePayload {
  toolName: string
  args: Record<string, unknown>
  sessionId: string
  /** 修改参数 */
  modifyArgs: (newArgs: Record<string, unknown>) => void
}

// ─── 变换草稿类型 ───

export interface CatalogDraft {
  /** 添加模型 */
  addModel(model: ModelInfo): void
  /** 更新模型 */
  updateModel(id: string, update: (model: ModelInfo) => void): void
  /** 移除模型 */
  removeModel(id: string): void
  /** 列出所有模型 */
  listModels(): ModelInfo[]
}

export interface ModelInfo {
  id: string
  name?: string
  providerId?: string
  capability?: 'text' | 'image' | 'video' | 'audio'
  contextWindow?: number
  supportsVision?: boolean
  [key: string]: unknown
}

export interface CommandDraft {
  addCommand(cmd: CommandInfo): void
  updateCommand(name: string, update: (cmd: CommandInfo) => void): void
  removeCommand(name: string): void
  listCommands(): CommandInfo[]
}

export interface CommandInfo {
  name: string
  title?: string
  description?: string
  template?: string
  [key: string]: unknown
}

export interface SkillDraft {
  addSkill(skill: SkillInfo): void
  updateSkill(id: string, update: (skill: SkillInfo) => void): void
  removeSkill(id: string): void
  listSkills(): SkillInfo[]
}

export interface SkillInfo {
  id: string
  name: string
  description?: string
  content?: string
  [key: string]: unknown
}
