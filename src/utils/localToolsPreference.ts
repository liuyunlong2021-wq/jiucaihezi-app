export const LOCAL_TOOLS_ENABLED_KEY = 'jc_local_tools_enabled'

export function readLocalToolsEnabled(store: Storage = localStorage): boolean {
  return store.getItem(LOCAL_TOOLS_ENABLED_KEY) !== '0'
}

export function writeLocalToolsEnabled(enabled: boolean, store: Storage = localStorage): void {
  store.setItem(LOCAL_TOOLS_ENABLED_KEY, enabled ? '1' : '0')
}
