# Web 图标字体修复 · Phase 2A 执行文档

**前置**：Phase 1 已完成（`docs/handover/web-icon-font-fix-execution.md`），`.mso` 已加 visibility 闸门。

**本期目标**：
- 引入 `<JcIcon name="...">` 包装组件作为图标的**唯一对外 API**
- 通过 codemod 自动替换 596 处硬编码 `<span class="mso">NAME</span>` 为 `<JcIcon name="NAME" />`
- 包装组件**内部仍然渲染 `<span class="mso">`**——本期零渲染行为变化

**为什么这么做**：
- 把 596 个分散的图标调用统一到一个组件门面，Phase 2C 只需改 1 个文件就能把整个项目从字体切换到 SVG
- 本期改动量大（145+ 文件）但行为变化为零，review 时只要 git diff 看结构对就行，不必逐个跑视觉验证
- 动态用法（106 处 + PlatformIcon）是 Phase 2B 的事，本期不碰

---

## 0. 前置检查

```bash
cd /Users/by3/Documents/jiucaihezi-app
git status
```

- 当前分支应为 `media-creation-optimization`（或 Phase 1 之后的分支）
- worktree 应有 Phase 1 的 3 个改动 + 一些已有的未提交改动
- **不要 commit Phase 1 的改动**（让用户决定合并节奏）
- **不要 stash 任何东西**

---

## 1. 创建 `src/components/icons/JcIcon.vue`

目录 `src/components/icons/` 可能不存在，先创建。

文件完整内容：

```vue
<script setup lang="ts">
/**
 * 项目统一图标组件 · facade pattern
 *
 * 本期（Phase 2A）：内部仍渲染 <span class="mso">，使用 Material Symbols 字体。
 * 未来（Phase 2C）：内部切换为 Iconify SVG 渲染，对外 API 不变。
 *
 * 用法：
 *   <JcIcon name="add_circle" />          基础
 *   <JcIcon name="favorite" fill />        填充变体（等价于 .mso-fill）
 *   <JcIcon name="close" class="text-red" @click="..." />  其他属性正常透传
 */
defineProps<{
  name: string
  fill?: boolean
}>()
</script>

<template>
  <span class="mso" :class="{ 'mso-fill': fill }">{{ name }}</span>
</template>
```

---

## 2. 全局注册 JcIcon（修改 `src/main.ts`）

### 2.1 加 import

在文件顶部 import 区块末尾追加（与 Phase 1 的 `import { initIconFontGate }` 同一区域）：

```typescript
import JcIcon from '@/components/icons/JcIcon.vue'
```

### 2.2 在 `mountApp()` 函数体内注册

定位到 `mountApp()` 函数定义。当前形态（约 124-140 行）：

```typescript
function mountApp() {
  try {
    const app = createApp(App)
    app.use(createPinia())
    registerMcpStore(useMcpStore)
    app.mount('#app')
    ...
```

在 `app.mount('#app')` **之前**插入一行：

```typescript
    app.component('JcIcon', JcIcon)
```

修改后形态：

```typescript
function mountApp() {
  try {
    const app = createApp(App)
    app.use(createPinia())
    registerMcpStore(useMcpStore)
    app.component('JcIcon', JcIcon)
    app.mount('#app')
    ...
```

**不要**改 `mountApp()` 之外的任何代码。

---

## 3. 创建 `src/types/components.d.ts`

为了让 vue-tsc / IDE 识别全局注册的 `<JcIcon>` 组件，需要 TypeScript 类型声明。

如果 `src/types/` 目录不存在，先创建。

文件完整内容：

```typescript
/**
 * 全局注册组件的 TypeScript 类型声明
 * 让模板里直接使用 <JcIcon>（无需 import）时 vue-tsc 不报错
 */
export {}

declare module 'vue' {
  interface GlobalComponents {
    JcIcon: typeof import('@/components/icons/JcIcon.vue')['default']
  }
}
```

**注意**：检查 `tsconfig.json` 是否包含了 `src/types/**/*.d.ts`。一般 Vue 项目的 `tsconfig.app.json` 的 `include` 是 `["src/**/*"]` 或 `["src/**/*.ts", "src/**/*.d.ts", "src/**/*.vue"]`——通常会自动覆盖。如果不确定，运行 `pnpm exec vue-tsc -b` 验证：若 JcIcon 类型未识别，需要把 `src/types/components.d.ts` 显式加进 `tsconfig.app.json` 的 include。

---

## 4. 编写 codemod 脚本

### 4.1 创建 `scripts/codemod-mso-to-jcicon.mjs`

如果 `scripts/` 目录已存在则直接放进去；不存在则创建。

文件完整内容（可微调，但核心逻辑别变）：

```javascript
#!/usr/bin/env node
/**
 * Codemod: <span class="mso">NAME</span> → <JcIcon name="NAME" />
 *
 * 处理两种形态：
 *   1. <span class="mso">add_circle</span>                → <JcIcon name="add_circle" />
 *   2. <span class="mso mso-fill">favorite</span>          → <JcIcon name="favorite" fill />
 *      (也支持反向 class 顺序 "mso-fill mso")
 *
 * 跳过：
 *   - 含 Vue 插值的（{{ ... }}）—— 动态调用，Phase 2B 处理
 *   - 含额外属性的（class="mso" + 其它属性）—— 保守起见本期不动，由人工处理
 *   - PlatformIcon.vue（Phase 2B 处理）
 *
 * 用法：
 *   node scripts/codemod-mso-to-jcicon.mjs           # dry-run，只统计
 *   node scripts/codemod-mso-to-jcicon.mjs --write   # 实际改写
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')

const SRC_DIR = join(ROOT, 'src')
const SKIP_FILES = new Set([
  join(SRC_DIR, 'components/icons/JcIcon.vue'),
  join(SRC_DIR, 'components/skills/shared/PlatformIcon.vue'),
])

const SIMPLE_RE = /<span\s+class="mso"\s*>\s*([a-z][a-z0-9_]*)\s*<\/span>/g
const FILL_RE = /<span\s+class="mso\s+mso-fill"\s*>\s*([a-z][a-z0-9_]*)\s*<\/span>/g
const FILL_REV_RE = /<span\s+class="mso-fill\s+mso"\s*>\s*([a-z][a-z0-9_]*)\s*<\/span>/g

// 用来探测"还剩多少未处理的 mso 用法"
const ANY_MSO_RE = /<span\s+class="[^"]*\bmso\b[^"]*"[^>]*>/g

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, files)
    } else if (full.endsWith('.vue')) {
      files.push(full)
    }
  }
  return files
}

const files = walk(SRC_DIR)

let totalSimple = 0
let totalFill = 0
const filesChanged = []

// 第一遍：仅替换、统计
for (const file of files) {
  if (SKIP_FILES.has(file)) continue
  const src = readFileSync(file, 'utf8')
  let out = src

  out = out.replace(SIMPLE_RE, (_, name) => {
    totalSimple++
    return `<JcIcon name="${name}" />`
  })
  out = out.replace(FILL_RE, (_, name) => {
    totalFill++
    return `<JcIcon name="${name}" fill />`
  })
  out = out.replace(FILL_REV_RE, (_, name) => {
    totalFill++
    return `<JcIcon name="${name}" fill />`
  })

  if (out !== src) {
    filesChanged.push({ file: file.replace(ROOT + '/', ''), before: src, after: out })
    if (WRITE) writeFileSync(file, out, 'utf8')
  }
}

// 第二遍：扫剩余的 mso 用法，方便用户知道还有多少需要 Phase 2B 处理
let leftover = 0
const leftoverSamples = []
for (const file of files) {
  if (SKIP_FILES.has(file)) continue
  const src = WRITE && filesChanged.find(c => join(ROOT, c.file) === file)
    ? readFileSync(file, 'utf8')
    : readFileSync(file, 'utf8')
  const matches = src.match(ANY_MSO_RE) || []
  if (matches.length > 0) {
    leftover += matches.length
    if (leftoverSamples.length < 10) {
      const lines = src.split('\n')
      lines.forEach((ln, idx) => {
        if (ANY_MSO_RE.test(ln) && leftoverSamples.length < 10) {
          leftoverSamples.push(`${file.replace(ROOT + '/', '')}:${idx + 1}  ${ln.trim().slice(0, 100)}`)
        }
        ANY_MSO_RE.lastIndex = 0
      })
    }
  }
}

console.log('\n=== Codemod report ===')
console.log(`Mode: ${WRITE ? 'WRITE (files modified)' : 'DRY RUN (no files modified)'}`)
console.log(`Files scanned: ${files.length} .vue files under src/`)
console.log(`Files affected: ${filesChanged.length}`)
console.log(`Replacements:`)
console.log(`  <JcIcon name="X" />        ${totalSimple}`)
console.log(`  <JcIcon name="X" fill />   ${totalFill}`)
console.log(`  TOTAL                       ${totalSimple + totalFill}`)
console.log(`\nLeftover <span class="mso*"> (will be handled in Phase 2B):`)
console.log(`  Count: ${leftover}`)
if (leftoverSamples.length > 0) {
  console.log(`  Samples:`)
  leftoverSamples.forEach(s => console.log(`    ${s}`))
}
console.log('')
if (!WRITE) {
  console.log('Re-run with --write to apply changes.')
}
```

---

## 5. 跑 codemod · 先 dry-run

```bash
node scripts/codemod-mso-to-jcicon.mjs
```

**预期输出（数字仅供参考）**：

```
=== Codemod report ===
Mode: DRY RUN (no files modified)
Files scanned: ~XXX .vue files under src/
Files affected: ~145
Replacements:
  <JcIcon name="X" />        ~580
  <JcIcon name="X" fill />   ~16
  TOTAL                       ~596
Leftover <span class="mso*"> (will be handled in Phase 2B):
  Count: ~106
  Samples:
    src/components/.../McpSettings.vue:45  <span class="mso">{{ statusIcon(server.status) }}</span>
    ...
```

### 5.1 把统计结果汇报给用户

把 dry-run 的完整输出贴给用户，**等用户说「确认」之后再继续**。如果数字偏差很大（例如总替换数 <400 或 >700），停下来跟用户讨论，可能 regex 需要调整。

---

## 6. 跑 codemod · 真改写

用户确认后：

```bash
node scripts/codemod-mso-to-jcicon.mjs --write
```

跑完后立刻：

```bash
git diff --stat | head -50
```

记录受影响文件数。

---

## 7. 校验

### 7.1 grep 验证剩余的 `<span class="mso">` 都是动态形态

```bash
rg '<span class="mso[^"]*">[^{<]+</span>' src --type vue | wc -l
```

**预期**：0。如果非 0，说明 codemod 漏掉了某种静态字面量形态，列出来跟用户讨论。

```bash
rg '<span class="mso' src --type vue | wc -l
```

**预期**：等于上一步报的 leftover 数（约 106）。这些都是动态形态，Phase 2B 处理。

### 7.2 确认 JcIcon 调用出现

```bash
rg '<JcIcon' src --type vue | wc -l
```

**预期**：约等于 codemod 真跑时报告的 TOTAL（约 596）。

---

## 8. 4 步验证（与 Phase 1 同结构）

### 8.1 类型检查

```bash
pnpm exec vue-tsc -b
```

**通过标准**：无报错。

**最可能的报错**：JcIcon 类型未识别 → 检查 `src/types/components.d.ts` 是否被 tsconfig include。如果没有，把它加到 `tsconfig.app.json` 的 include 字段（**仅**在此场景下才能修改 tsconfig）。

### 8.2 Web Dev 验证

```bash
pnpm dev
```

打开浏览器（Dev URL 一般是 `http://localhost:1420/` 或 `5173/`）。

**预期现象**：
- 页面正常加载
- 所有图标显示正常（与 Phase 1 修复后完全一致）
- **零渲染差异**——本期就是结构重命名，不应该有任何视觉变化

**不要**做慢速网络测试——Phase 2A 不改变字体加载行为，慢速行为与 Phase 1 一致。

### 8.3 Web 生产构建

```bash
pnpm exec vite build
```

**通过标准**：无报错。

### 8.4 桌面 APP 回归测试

```bash
pnpm run tauri dev
```

确认 APP 正常启动，所有图标正常显示。

---

## 9. 完成后

- **不要** `git add` / `git commit`
- **不要** `git push`
- 跑 `git status --short` 把改动文件列表给用户
- 跑 `git diff --stat src/` 给一个改动概览
- 把 4 步验证结果逐项汇报
- 任何自主决策（codemod regex 调整、tsconfig 修改、etc.）单独列出来说明

---

## 10. 回滚

如果用户判断要回滚：

```bash
git checkout -- src/main.ts src/styles/base.css 'src/**/*.vue'
rm -f src/components/icons/JcIcon.vue
rm -f src/types/components.d.ts
rm -f scripts/codemod-mso-to-jcicon.mjs
```

**注意**：上面的 `git checkout -- 'src/**/*.vue'` 会把 codemod 的所有改动还原，但**会同时还原** Phase 1 之前已存在的其他 .vue 改动（CreationPanel.vue 等用户已有的工作）。如果用户在意，改为：

```bash
git stash -- src  # 把所有 src 改动暂存
# 用户人工分拣再恢复
```

或更稳的方式：用户单独 review，按需 `git checkout -- <具体文件>`。

---

## 11. 边界声明

本期**只解决「把静态硬编码图标调用统一到 JcIcon」**这一件事。

**不解决**：
- 动态图标调用（`{{ name }}` 形态）→ Phase 2B
- 6 个动态映射函数 → Phase 2B
- PlatformIcon.vue → Phase 2B
- 字体文件 3.52MB → Phase 2C
- 真正的 SVG 化、Iconify 接入 → Phase 2C
- 删除 `.mso` / `iconFontGate` → Phase 2C

如果用户在本期任务里追加要求做这些，**停下来问**，不要自行扩展。
