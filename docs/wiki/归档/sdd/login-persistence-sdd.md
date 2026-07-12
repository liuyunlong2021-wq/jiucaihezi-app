# SDD: 登录状态持久化 — 重启 APP 自动恢复登录

> **状态**: 方案设计 | **日期**: 2026-07-06 | **分支**: 0706-cangkuyouhua
> **原则**: 最小改动，抄袭 OpenCode 的懒加载模式但补充全局响应式

---

## 一、问题

用户一键登录后关闭 APP，再打开 APP，设置面板仍显示登录框——因为 `gatewayLoggedIn` 是 SettingsPanel 局部 ref，不知道 Key 已从 Keychain 读取完毕。

### 根因

```
main.ts boot():
  initApiKey()  ← fire-and-forget，读 Keychain (3s)
  结果写入 newApiClient 内存缓存

SettingsPanel onMounted:
  apiKey = getApiKey()  ← 直接读内存缓存
  → 如果 initApiKey() 还没跑完 → 空 → 显示登录框 ❌
  → 如果 initApiKey() 跑完了   → 有值 → 显示已登录 ✅
```

时间窗口：boot() 不等待 initApiKey()（对标 OpenCode 懒鉴权），但 SettingsPanel 可能在 initApiKey() 完成前挂载。

---

## 二、方案

### 核心思路

给 `newApiClient.ts` 加一个**全局 reactive ref**，`initApiKey()` 完成后写入。SettingsPanel 不再自己调 `initApiKey()`，改为订阅这个 ref。

```
改前:
  initApiKey() → 内存缓存 → getApiKey() → 谁调谁拿（可能空）
  SettingsPanel: getApiKey() || await initApiKey()  ← 重复逻辑

改后:
  initApiKey() → apiKeyReady.value = 'sk-xxx'  ← 全局 reactive
  SettingsPanel: watch(apiKeyReady, ...)          ← 订阅，自动响应
```

### 为什么用全局 ref 而不是 Pinia store

- 改动面最小：只加一个 export 到 `newApiClient.ts`，不需要新建文件
- `newApiClient.ts` 已经有 `apiKeyMemoryCache`，加一个 reactive 版本是自然延伸
- 对照 OpenCode：OpenCode 也没有 store，只是每次调 `auth.all()` 读文件。我们比他们多一个缓存层

---

## 三、改动

### 3.1 `src/services/newApiClient.ts`

新增一行 export：

```ts
// 已有
let apiKeyMemoryCache = ''

// 新增：全局 reactive ref，供 UI 订阅
import { ref } from 'vue'
export const apiKeyReady = ref('')

// 修改 setApiKey：写入时同步更新 reactive ref
export async function setApiKey(apiKey: string) {
  const clean = (apiKey || '').trim()
  apiKeyMemoryCache = clean
  apiKeyReady.value = clean          // ← 新增
  // ... 原有 Keychain 写入逻辑不变
}

// 修改 initApiKey：完成后更新 reactive ref
export async function initApiKey(): Promise<string> {
  // ... 原有读取逻辑不变
  // 在 return key 之前：
  apiKeyReady.value = key            // ← 新增
  return key
}
```

**不改** `getApiKey()`（同步读缓存）、不改 Keychain 读写、不改 boot() 流程。

### 3.2 `src/components/settings/SettingsPanel.vue`

**不改** `onMounted` 的结构，只在里面增加 `watch` 订阅。保持 `localStorage.setItem`、本地模型计数等逻辑不变。

```ts
// 新增 import
import { watch } from 'vue'
import { apiKeyReady } from '@/services/newApiClient'

onMounted(async () => {
  // 首次同步：先读缓存（可能已就绪），再兜底调 initApiKey
  const key = getApiKey() || await initApiKey()
  syncKeyState(key)

  // 订阅后续异步更新：Key 稍后到达时自动刷新 UI
  watch(apiKeyReady, (val) => {
    if (val) syncKeyState(val)
  })

  // 以下不变
  localStorage.setItem('jcApiBase', API_BASE)
  if (!isWebRuntime.value) {
    installedLocalModelCount.value = getLocalOllamaModels().length
    if (installedLocalModelCount.value > 0) {
      localModelStatus.value = `已识别 ${installedLocalModelCount.value} 个模型`
    }
  }
})

// 新增：统一的 Key 状态同步函数
function syncKeyState(key: string) {
  apiKey.value = key
  gatewayLoggedIn.value = Boolean(key)
  advancedApiKeyOpen.value = Boolean(key)
  if (key) agentStore.fetchModels().catch(() => {})
}
```

**改动**：3 行新增（import/watch/syncKeyState 函数），0 行删除。

### 3.3 `src/main.ts`

不改。`initApiKey()` 仍然在 boot() 中 fire-and-forget，不需要 await。

---

## 四、用户体验

```
第一天：
  打开 APP → 点设置 → 填账号 → 一键登录 → 关闭 APP

第二天：
  打开 APP → 点设置 → 0.3s 后自动变成「已登录 ✅」
  （什么都不用点）

一周后：
  打开 APP → 点设置 → 「已登录 ✅」
  永远不用再登录
```

---

## 五、改动文件清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `src/services/newApiClient.ts` | +1 行 import vue ref，+1 行 export ref，`setApiKey` +2 行，`initApiKey` +1 行 |
| 2 | `src/components/settings/SettingsPanel.vue` | `onMounted` 删 5 行，加 `watch(apiKeyReady)` 6 行 |

---

## 六、验证

```bash
pnpm exec vue-tsc -b && cargo check --manifest-path src-tauri/Cargo.toml
```

手动：
1. 一键登录 → 关闭 APP → 重开 → 打开设置 → 自动显示「已登录」
2. 一键登录 → 关闭 APP → 第二天重开 → 设置面板自动显示「已登录」
3. 从未登录过 → 打开设置 → 显示登录框（不变）
