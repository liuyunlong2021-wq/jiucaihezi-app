# 图标系统最终修复执行文档（完整方案）

## 0. 现状

**已完成（不要回退）**：
- Phase 1：`mso-ready` 视觉闸门 — 后续会一起清掉
- Phase 2A/2B：596 + 106 处 `<span class="mso">` → `<JcIcon>`
- Phase 2C：JcIcon 内部切到 `@iconify/vue` 的 `<Icon>`，删字体/CSS/gate

**问题**：JcIcon.vue 当前从 `@iconify/vue` 导入 `Icon` 组件，**默认是 API mode**——运行时去 `https://api.iconify.design` 拉 SVG。这个域名：
- 没在 Tauri CSP 的 `connect-src` 白名单
- 没在 Web 部署服务器（jiucaihezi.studio）的 CSP 白名单
- 国内访问也不稳定

结果：所有图标失效。**桌面 APP 大概率也挂了**，只是 DeepSeek 在 `tauri dev` 没仔细确认。

## 1. 修复方向

切到 **offline mode + 本地 bundle**：
- 构建时把项目用到的所有 Material Symbols 图标 SVG 数据打包进 `src/assets/icons-bundle.json`
- JcIcon.vue 通过 `addCollection()` 在模块加载时一次性注入本地数据
- 运行时零外部请求 → CSP 不需要改 → 网络环境不影响

体积预估：228 个图标 × 约 250B ≈ 60KB raw / 15KB gzipped。

**不接受的替代方案**：
- ❌ 给 CSP 加 `api.iconify.design`：换了个 CDN 依赖，治标不治本
- ❌ 装 `unplugin-icons`：不支持动态 name prop
- ❌ 换图标库：现有 596+106 处调用结构已经对，没必要

---

## 2. 前置检查

```bash
cd /Users/by3/Documents/jiucaihezi-app
git status
git log --oneline -5
```

确认你在 Phase 2C 已 commit 的分支上，worktree 应该比较干净（DeepSeek 自己说"已 commit 未 push"）。

确认 `@iconify/vue` 当前版本：

```bash
node -e "console.log(require('./package.json').dependencies['@iconify/vue'])"
```

预期：`^5.0.1`。

---

## 3. Step 1：安装数据包

```bash
pnpm add -D @iconify-json/material-symbols
```

确认安装成功：

```bash
ls node_modules/@iconify-json/material-symbols/icons.json
node -e "const d=require('@iconify-json/material-symbols/icons.json'); console.log('icons:', Object.keys(d.icons).length, 'prefix:', d.prefix)"
```

预期输出：`icons: 几千个数字 prefix: material-symbols`

---

## 4. Step 2：编写 bundle 脚本

新建 `scripts/bundle-icons.mjs`，完整内容：

```javascript
#!/usr/bin/env node
/**
 * 扫描 src/ 所有 <JcIcon name="..."> 用法 + 6 个动态映射函数 + JcIcon.vue 的 ICON_ALIAS，
 * 提取所有图标名，从 @iconify-json/material-symbols 的完整数据集中提取子集，
 * 输出 src/assets/icons-bundle.json，供 JcIcon.vue 在运行时 addCollection() 使用。
 *
 * 用法：
 *   node scripts/bundle-icons.mjs           # 生成 bundle
 *   node scripts/bundle-icons.mjs --check   # 只检查覆盖率，不写文件
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const OUT_DIR = join(SRC, 'assets')
const OUT_PATH = join(OUT_DIR, 'icons-bundle.json')

const CHECK_ONLY = process.argv.includes('--check')

const msoData = require('@iconify-json/material-symbols/icons.json')

// <JcIcon name="add_circle" /> 或 <JcIcon ... name="add_circle" /> 或单引号
const STATIC_RE = /<JcIcon\b[^>]*\bname=["']([a-z][a-z0-9_]*)["']/g

// 任何引号字符串（用于扫 6 个映射函数所在文件的所有候选）
const STRING_RE = /["']([a-z][a-z0-9_]{2,})["']/g

// 6 个已知的动态映射函数名（用来识别需要全字符串扫描的文件）
const DYNAMIC_FUNC_RE = /\b(statusIcon|iconFor|getIcon|fileStatusIcon|toolLabel)\b/

// 与 JcIcon.vue 保持一致的 alias 映射
const ICON_ALIAS = {
  'collections': 'collections-bookmark',
  'file_import': 'file-download',
  'folder_search': 'folder-managed',
  'save_alt': 'save-as',
  'source': 'source-environment',
}

const collected = new Set()

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, files)
    } else if (full.endsWith('.vue') || full.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

const files = walk(SRC)

for (const file of files) {
  const src = readFileSync(file, 'utf8')

  // Pass 1：所有显式 <JcIcon name="X" />
  for (const m of src.matchAll(STATIC_RE)) {
    collected.add(m[1])
  }

  // Pass 2：含 6 个映射函数任意一个的文件，把所有"形似图标名"的字符串都做候选
  if (DYNAMIC_FUNC_RE.test(src)) {
    for (const m of src.matchAll(STRING_RE)) {
      const name = m[1]
      const resolved = ICON_ALIAS[name] ?? name
      const kebab = resolved.replace(/_/g, '-')
      if (msoData.icons[kebab]) {
        collected.add(name)
      }
    }
  }
}

// 强制收集 ICON_ALIAS 的所有 key（防 Pass 1/2 漏抓）
for (const userName of Object.keys(ICON_ALIAS)) {
  collected.add(userName)
}

// 构造 Iconify subset
const subset = {
  prefix: 'material-symbols',
  width: msoData.width ?? 24,
  height: msoData.height ?? 24,
  info: msoData.info,
  icons: {},
}

const unmapped = []

for (const name of [...collected].sort()) {
  const resolved = ICON_ALIAS[name] ?? name
  const kebab = resolved.replace(/_/g, '-')
  const iconData = msoData.icons[kebab]
  if (iconData) {
    subset.icons[kebab] = iconData
  } else {
    unmapped.push(name)
  }
}

const json = JSON.stringify(subset)
const sizeKB = (json.length / 1024).toFixed(1)

console.log('\n=== Icon bundle report ===')
console.log(`Files scanned:       ${files.length}`)
console.log(`Icon names collected: ${collected.size}`)
console.log(`Icons bundled:       ${Object.keys(subset.icons).length}`)
console.log(`Bundle size (raw):   ${sizeKB} KB`)

if (unmapped.length > 0) {
  console.log(`\n⚠️  ${unmapped.length} icon names NOT FOUND in Material Symbols:`)
  for (const name of unmapped) {
    console.log(`  - ${name}`)
  }
  console.log(`\nActions:`)
  console.log(`  1. Add a mapping in ICON_ALIAS (JcIcon.vue AND this script) pointing to a real MS name`)
  console.log(`  2. Or change the call site to a real MS name`)
  console.log(`  3. Or accept silent blank icon (not recommended)`)
}

if (CHECK_ONLY) {
  console.log('\n(--check mode: no file written)')
  process.exit(unmapped.length > 0 ? 1 : 0)
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_PATH, json)
console.log(`\n✅ Bundle written to: ${OUT_PATH.replace(ROOT + '/', '')}`)
```

---

## 5. Step 3：跑一次 bundle 脚本（**第一道确认关**）

```bash
node scripts/bundle-icons.mjs
```

**预期输出形态**：

```
=== Icon bundle report ===
Files scanned:       数百个
Icon names collected: 大约 220-240
Icons bundled:       大约 215-235
Bundle size (raw):   大约 50-80 KB

⚠️  N icon names NOT FOUND in Material Symbols:
  - some_name
  - another_name
  ...
```

### 5.1 把完整报告贴给用户，停下来等确认

**关键判断**：
- 如果 `Icons bundled` 数字 ≥ 200 且 unmapped < 15，多半正常，等用户拍板放行
- 如果 `Icons bundled` < 100，说明扫描逻辑漏了，停下来跟用户讨论
- unmapped 列表里每个名字都要让用户判断：是否加 alias，还是改调用处

**用户确认前不要进入 Step 4。**

### 5.2 处理 unmapped（用户确认后）

用户会给出每个 unmapped 名字的处理决策。两种动作：

**动作 A**：往 `JcIcon.vue` 的 `ICON_ALIAS` 加映射

例：`'some_name': 'some-existing-ms-icon'`

**同时**往 `scripts/bundle-icons.mjs` 的 `ICON_ALIAS` 加同样映射。两处必须一致。

**动作 B**：修改调用处，把图标名改为 Material Symbols 真名

只动调用处文件，不动 ICON_ALIAS。

处理完后**再跑一次** `node scripts/bundle-icons.mjs --check`，直到 unmapped 为 0 或用户接受残余空白。

---

## 6. Step 4：修改 `src/components/icons/JcIcon.vue`

当前文件内容（你 Phase 2C 写的）：

```vue
<script setup lang="ts">
/**
 * ...
 */
import { Icon } from '@iconify/vue'
import { computed } from 'vue'

const props = defineProps<{
  name: string
  fill?: boolean
}>()

function toKebab(name: string): string {
  return name.replace(/_/g, '-')
}

const ICON_ALIAS: Record<string, string> = {
  'collections': 'collections-bookmark',
  'file_import': 'file-download',
  'folder_search': 'folder-managed',
  'save_alt': 'save-as',
  'source': 'source-environment',
}

const iconId = computed(() => {
  const kebab = toKebab(props.name)
  const resolved = ICON_ALIAS[props.name] ?? kebab
  return props.fill
    ? `material-symbols:${resolved}?fill=1`
    : `material-symbols:${resolved}`
})
</script>

<template>
  <Icon :icon="iconId" />
</template>
```

### 6.1 改写为带 offline 注入的版本

完整替换为：

```vue
<script lang="ts">
/**
 * 模块加载时一次性注入本地图标 bundle，全局生效。
 * 这块用普通 <script>（非 setup），保证 addCollection 只跑一次。
 */
import { addCollection } from '@iconify/vue'
import iconBundle from '@/assets/icons-bundle.json'

addCollection(iconBundle as Parameters<typeof addCollection>[0])
</script>

<script setup lang="ts">
/**
 * 项目统一图标组件 · facade pattern
 *
 * Offline mode：所有图标 SVG 数据在 build 时打包进 src/assets/icons-bundle.json，
 * 运行时不发任何外部请求。CSP 不需要放行 api.iconify.design。
 *
 * 用法：
 *   <JcIcon name="add_circle" />            基础（outlined）
 *   <JcIcon name="favorite" fill />          填充变体
 *   <JcIcon name="close" class="text-red" /> 透传 class / style / 事件等
 */
import { Icon } from '@iconify/vue'
import { computed } from 'vue'

const props = defineProps<{
  name: string
  fill?: boolean
}>()

/**
 * Material Symbols 在 Iconify 中使用 kebab-case 命名。
 * 例：add_circle → add-circle
 */
function toKebab(name: string): string {
  return name.replace(/_/g, '-')
}

/**
 * Material Symbols 命名与 Iconify 不完全对齐的极少数图标。
 * ⚠️ 修改此处时必须同步修改 scripts/bundle-icons.mjs 的 ICON_ALIAS，否则 bundle 里没有该图标数据。
 */
const ICON_ALIAS: Record<string, string> = {
  'collections': 'collections-bookmark',
  'file_import': 'file-download',
  'folder_search': 'folder-managed',
  'save_alt': 'save-as',
  'source': 'source-environment',
}

const iconId = computed(() => {
  const kebab = toKebab(props.name)
  const resolved = ICON_ALIAS[props.name] ?? kebab
  return props.fill
    ? `material-symbols:${resolved}?fill=1`
    : `material-symbols:${resolved}`
})
</script>

<template>
  <Icon :icon="iconId" />
</template>
```

### 6.2 确认 tsconfig 允许导入 JSON

如果 `pnpm exec vue-tsc -b` 报 `Cannot find module '@/assets/icons-bundle.json' or its corresponding type declarations`，检查 `tsconfig.json` / `tsconfig.app.json` 里有没有：

```json
{
  "compilerOptions": {
    "resolveJsonModule": true,
    "esModuleInterop": true
  }
}
```

如果没 `resolveJsonModule`，加上。这是本次任务**唯一允许动 tsconfig 的场景**。

---

## 7. Step 5：把 bundle 生成接入 build 流程

修改 `package.json` 的 `build` 和 `build:desktop` 脚本：

**当前**：

```json
"build": "pnpm run test:focused && vue-tsc -b && vite build && node scripts/prune-web-dist.mjs && pnpm run audit:web-dist",
"build:desktop": "pnpm run test:focused && vue-tsc -b && vite build && node scripts/prune-desktop-dist.mjs && pnpm run audit:desktop-dist",
```

**改为**：

```json
"build": "pnpm run test:focused && node scripts/bundle-icons.mjs && vue-tsc -b && vite build && node scripts/prune-web-dist.mjs && pnpm run audit:web-dist",
"build:desktop": "pnpm run test:focused && node scripts/bundle-icons.mjs && vue-tsc -b && vite build && node scripts/prune-desktop-dist.mjs && pnpm run audit:desktop-dist",
```

加在 `vue-tsc -b` 之前——确保类型检查时 bundle 文件已存在。

> dev 阶段不需要每次重新生成 bundle（图标变化不频繁，手动跑 `node scripts/bundle-icons.mjs` 即可）。如果用户后面想加 watch 模式，再补。

---

## 8. Step 6：四步验证

### 8.1 类型检查

```bash
pnpm exec vue-tsc -b
```

**通过标准**：无报错。最可能的报错：JSON import 类型未识别 → 检查 `resolveJsonModule`。

### 8.2 Web Dev 验证

```bash
pnpm dev
```

打开浏览器（`http://localhost:1420/` 或 `5173/`）。

DevTools → Network 面板，**确认**：
- 没有任何对 `api.iconify.design` / `api.simplesvg.com` / `api.unisvg.com` 的请求
- 所有图标正常显示

如果还能看到对 iconify API 的请求，说明 addCollection 没生效或 bundle 没覆盖那个图标。

### 8.3 Web 生产构建 + 模拟生产 preview

```bash
pnpm exec vite build
pnpm exec vite preview
```

preview 默认在 `http://localhost:4173/`。

DevTools → Network → 同样确认零 iconify.design 请求 + 所有图标正常。

**这一步比 dev 重要**——生产构建的产物才反映真实部署后的行为。

### 8.4 桌面 APP 回归

```bash
pnpm run tauri dev
```

**重点检查**：所有图标必须正常显示。Phase 2C 跑完后桌面端本来也是坏的（CSP 拦截），本次修复必须把桌面端也救回来。

DevTools（Tauri 窗口右键 → Inspect）→ Network → 确认零 iconify.design 请求。

---

## 9. Step 7：完成后

- **不要** `git add` / `git commit`
- **不要** `git push`
- 列出所有改动文件（git status + git diff --stat）
- 把 4 步验证逐项结果汇报
- bundle 体积（实际写入 `src/assets/icons-bundle.json` 的字节数）
- 任何自主决策（tsconfig 调整等）单独说明

---

## 10. 回滚

```bash
git checkout -- package.json src/components/icons/JcIcon.vue tsconfig.json tsconfig.app.json 2>/dev/null
rm -f src/assets/icons-bundle.json
rm -f scripts/bundle-icons.mjs
pnpm install  # 还原 lockfile
```

回滚后回到 Phase 2C 完成时状态（图标仍然挂，但代码结构是 DeepSeek 之前的版本）。

---

## 11. 边界声明

本期**只解决**：
- 把图标渲染从外部 API 切换到本地 bundle
- 让 CSP 不需要为图标放行任何外部域名
- 修复 Web + 桌面所有图标失效

**不解决** / 不应该顺手做：
- 不要更换图标库或图标体系
- 不要把 bundle 改成全量 Material Symbols 数据集（会膨胀到几 MB）
- 不要回退 Phase 1/2A/2B/2C 已经做的代码迁移
- 不要在 CSP 里放行任何 iconify 域名
- 不要碰 src-tauri/lib.rs、capabilities/
- 不要顺手优化无关代码

如果用户在本任务里临时追加其它修复需求，**停下来问**，不要扩展。
