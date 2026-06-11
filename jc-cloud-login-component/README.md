# JC Cloud Login Component

韭菜盒子云端账号的一键登录组件，可复制到其他 Vue 3 项目中使用。

## 文件

- `JcCloudLoginBox.vue`：完整登录 UI，含一键登录、API Key 输入、常用账号入口。
- `jcCloudAuth.ts`：纯 TypeScript 登录服务和响应解析函数，不依赖 Pinia、Tauri 或当前项目。

## 基础用法

```vue
<script setup lang="ts">
import { ref } from 'vue'
import JcCloudLoginBox from './JcCloudLoginBox.vue'
import type { JcCloudLoginResult } from './jcCloudAuth'

const apiKey = ref('')
const loggedIn = ref(false)
const status = ref('')

function handleLoginSuccess(result: JcCloudLoginResult) {
  apiKey.value = result.apiKey
  loggedIn.value = true
  status.value = '已登录，可直接使用'
}

function saveKey() {
  localStorage.setItem('jc_api_key', apiKey.value.trim())
  status.value = '已保存'
}
</script>

<template>
  <JcCloudLoginBox
    v-model:api-key="apiKey"
    api-base="https://api.jiucaihezi.studio"
    :logged-in="loggedIn"
    :status="status"
    @login-success="handleLoginSuccess"
    @save-key="saveKey"
  />
</template>
```

## 自定义登录

如果目标项目不是调用 `/auth/login`，可以传入自己的登录函数：

```vue
<JcCloudLoginBox
  v-model:api-key="apiKey"
  :login="customLogin"
  @login-success="handleLoginSuccess"
/>
```

```ts
import type { JcCloudLoginPayload, JcCloudLoginResult } from './jcCloudAuth'

async function customLogin(payload: JcCloudLoginPayload): Promise<JcCloudLoginResult> {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  return {
    apiKey: data.apiKey,
    user: data.user,
    raw: data,
  }
}
```

## 事件

- `update:apiKey`：API Key 输入变化。
- `update:advancedOpen`：高级 API Key 区域展开/收起变化。
- `login-success`：账号登录成功，返回 `{ apiKey, user?, baseUrl?, raw? }`。
- `login-error`：账号登录失败，返回 `Error`。
- `save-key`：用户点击保存设置。

## 迁移注意

- 组件只要求 Vue 3。
- 图标使用 `mso` class；如果目标项目没有 Material Symbols 字体，会显示英文图标名，不影响功能。
- 桌面端如需系统浏览器打开外链，可传入 `open-url`，例如 Tauri 的 `openExternal`。
