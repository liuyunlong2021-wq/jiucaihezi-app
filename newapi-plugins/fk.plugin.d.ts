// App 只读取插件的面板目录；其余导出由 NewAPI 宿主调用。
import type { PluginCatalog } from '../src/runtime/creation/pluginCatalog'

export const catalog: PluginCatalog
