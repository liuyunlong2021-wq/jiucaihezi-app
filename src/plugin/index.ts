/**
 * plugin/index.ts — 插件系统入口
 */
export { definePlugin, type PluginDefinition, type PluginRegistration, type PluginContext } from './types'
export type {
  TransformDomain,
  HookDomain,
  CatalogDraft,
  CommandDraft,
  SkillDraft,
  ChatSendBeforePayload,
  ChatReceiveAfterPayload,
  ToolExecutePayload,
} from './types'
export { createPluginHost, getPluginHost, __resetPluginHost, type PluginHost } from './pluginHost'
export {
  parsePluginSpecifier,
  readPluginManifest,
  checkPluginCompatibility,
  resolvePluginTarget,
  readInstalledManifest,
  installPlugin,
  type PluginSpecifier,
  type PluginTarget,
  type PluginManifest,
} from './install'
export {
  targetsToCapabilities,
  createSandboxedContext,
  validatePluginForLoading,
  type PluginCapability,
  type SandboxValidation,
} from './sandbox'
export {
  readPluginConfig,
  writePluginConfig,
  getPluginEntryList,
  addPluginToConfig,
  removePluginFromConfig,
  setPluginEnabled,
  getEnabledPlugins,
  type PluginConfigEntry,
  type PluginConfig,
} from './config'
