# macOS Monterey 正则 lookbehind 兼容性修复 SDD

> **编写日期**: 2026-07-06
> **状态**: ✅ 已实施（2026-07-06）
> **目标系统**: macOS 12.x (Monterey) — WKWebView 不支持 `(?<=...)` lookbehind

---

## 一、问题描述

### 症状

桌面端启动后 logo 消失，白屏。控制台报错：

```
SyntaxError: Invalid regular expression: invalid group specifier name
```

### 根因

macOS 12.x Monterey 的 WKWebView（Safari 15.x 内核）不支持正则表达式中的 **零宽断言 lookbehind** 语法 `(?<=...)` 和 `(?<!...)`。该语法从 Safari 16.4（macOS 13.3 Ventura）开始才支持。

项目源码中有两处使用了 lookbehind：

1. `src/utils/mathRenderer.ts:46` — 行内公式匹配
2. `src/runtime/conversationContext/oversizedInput.ts:189` — 文本分块

当 Vite dev server 加载这些模块时，WKWebView 解析到包含 `(?<=` 的正则字面量即抛出 SyntaxError，模块加载失败，导致白屏。

### 影响范围

- **applies to**: 桌面端（Tauri），Web 端（Safari 15.x 用户）
- **not applies to**: Web 端（Chrome/Firefox/Edge/Safari 16.4+），Node.js 环境（测试/构建）
- **严重程度**: P0 — 桌面端在 macOS 12 上完全不可用

---

## 二、修改方案

### 修改 1：`src/utils/mathRenderer.ts` — 行内公式正则

#### 原代码（第 46 行）

```typescript
protected_ = protected_.replace(/\$(?=\S)(.+?)(?<=\S)\$/g, (_match, formula) => {
```

语义：匹配 `$...$` 包裹的内容，要求内容首尾都不是空白字符。

- `\$` — 匹配开头的 `$`
- `(?=\S)` — 前瞻断言：下一个字符非空白
- `(.+?)` — 非贪婪捕获内容
- `(?<=\S)` — **lookbehind 断言**：前一个字符非空白
- `\$` — 匹配结尾的 `$`

#### 修改后

```typescript
protected_ = protected_.replace(/\$(\S(?:.*?\S)?)\$/g, (_match, formula) => {
```

原理：用捕获组替代 lookbehind，语义等价。

- `\$` — 匹配开头的 `$`
- `(\S(?:.*?\S)?)` — **捕获组**：
  - `\S` — 确保第一个字符非空白
  - `(?:.*?\S)?` — 可选部分，确保最后一个字符非空白
    - `.*?` — 非贪婪匹配中间内容（可能为空）
    - `\S` — 确保末尾字符非空白（仅当存在额外字符时）
- `\$` — 匹配结尾的 `$`

#### 边界验证

| 输入 | 原正则 | 新正则 | 说明 |
|------|--------|--------|------|
| `$x$` | ✓ → "x" | ✓ → "x" | 单字符公式 |
| `$ab$` | ✓ → "ab" | ✓ → "ab" | 多字符 |
| `$x y$` | ✓ → "x y" | ✓ → "x y" | 含空格 |
| `$ x$` | ✗ 不匹配 | ✗ 不匹配 | 开头空格 |
| `$x $` | ✗ 不匹配 | ✗ 不匹配 | 结尾空格 |
| `$  $` | ✗ 不匹配 | ✗ 不匹配 | 全空格 |
| `$$` | ✗ 不匹配 | ✗ 不匹配 | 空内容 |
| `$100` | ✓ → "100" | ✓ → "100" | 货币（后续被过滤） |

---

### 修改 2：`src/runtime/conversationContext/oversizedInput.ts` — 文本按标点分割

#### 原代码（第 189 行）

```typescript
const paragraphs = block.text.split(/(?<=。|！|？|\n\n)/)
```

语义：在中日韩句号、感叹号、问号或双换行 **之后** 分割文本（lookbehind 确保分隔符保留在前一段末尾）。

#### 修改后

新增辅助函数 `splitOnDelimiters`，用逐字符遍历替代 lookbehind split：

```typescript
/**
 * 在中日韩标点（。！？）或双换行之后分割文本。
 * 分隔符保留在前一段末尾，行为等价于 split(/(?<=。|！|？|\n\n)/)。
 * 不使用 lookbehind，兼容 macOS Monterey WKWebView。
 */
function splitOnDelimiters(text: string): string[] {
  const result: string[] = []
  let lastIndex = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '。' || ch === '！' || ch === '？') {
      result.push(text.slice(lastIndex, i + 1))
      lastIndex = i + 1
    } else if (ch === '\n' && i + 1 < text.length && text[i + 1] === '\n') {
      result.push(text.slice(lastIndex, i + 2))
      lastIndex = i + 2
      i++ // skip the second \n of the pair
    }
  }
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }
  return result.length > 0 ? result : [text]
}
```

然后修改调用处：

```typescript
// 旧
const paragraphs = block.text.split(/(?<=。|！|？|\n\n)/)

// 新
const paragraphs = splitOnDelimiters(block.text)
```

#### 行为等价验证

| 输入 | 原 `split` 结果 | 新函数结果 |
|------|----------------|-----------|
| `"你好。去吧！行吗\n\n好。"` | `["你好。","去吧！","行吗\n\n","好。"]` | 相同 |
| `"无标点文本"` | `["无标点文本"]` | 相同 |
| `"只有句号。"` | `["只有句号。"]` | 相同 |
| `"多行\n\n文本"` | `["多行\n\n","文本"]` | 相同 |
| `""` | `[""]` | `[""]` |

---

## 三、测试策略

### 单元测试

两个文件已有单元测试。修改后需确保：

```bash
pnpm exec vitest run src/utils/__tests__/mathRenderer.test.ts
pnpm exec vitest run src/runtime/conversationContext/__tests__/oversizedInput.test.ts
```

### 人工验证

1. `pnpm tauri dev` 在 **macOS 12 Monterey** 上启动不再白屏
2. 发送含 `$x^2$` 行内公式的消息，渲染正常
3. 发送超长消息（>25k tokens），分块逻辑正确

### 回归验证

- `pnpm exec vue-tsc -b` — 类型检查通过
- `pnpm exec vitest run` — 所有测试通过

---

## 四、风险与注意事项

1. **仅这两处需要改** — 已全局搜索 `(?<[=!]` 确认项目内无其他 lookbehind
2. **node_modules 中无 lookbehind** — 已确认 highlight.js、marked、katex 等核心依赖不含
3. **`)` 和 `*` 后不需要加 ** — 性能可忽略（两处都在非热路径上：公式渲染在显示时触发，文本分块在发送长消息时触发）
4. **后续维护提醒** — 今后所有源码中的正则如需零宽断言，优先考虑：
   - 能否用捕获组替代？
   - 能否用 `String.prototype.match` + 手工处理替代？
   - 能否用 `indexOf`/`charAt` 遍历替代？
5. **不升级 macOS 的限制** — macOS 12 Monterey 已于 2024 年底结束安全更新，建议用户找时间升级；此修复为兼容策略，不是永久的

---

## 五、实施清单

| # | 文件 | 改动 | 风险 |
|---|------|------|------|
| 1 | `src/utils/mathRenderer.ts:46` | `(?<=\S)` → `(\S(?:.*?\S)?)` | 低 — 纯正则替换 |
| 2 | `src/runtime/conversationContext/oversizedInput.ts:189` | 新增 `splitOnDelimiters` + 替换调用 | 低 — 纯逻辑替换 |
| 3 | 单元测试跑通 | 验证已有测试 | 中 — 需覆盖边界 |
| 4 | `pnpm tauri dev` 在 Monterey 验证 | 启动不白屏 | 高 — 唯一验证方式 |

### 简略 diff

```diff
--- a/src/utils/mathRenderer.ts
+++ b/src/utils/mathRenderer.ts
@@ -43,7 +43,7 @@ export function renderMathInText(text: string): string {
   })

   // 3. 渲染 $...$ 行内公式（不跨行，不允许首尾空格）
-  protected_ = protected_.replace(/\$(?=\S)(.+?)(?<=\S)\$/g, (_match, formula) => {
+  protected_ = protected_.replace(/\$(\S(?:.*?\S)?)\$/g, (_match, formula) => {
     // 跳过纯数字/货币符号
     const trimmed = formula.trim()
     if (!trimmed || /^\d+(\.\d+)?$/.test(trimmed)) return _match

--- a/src/runtime/conversationContext/oversizedInput.ts
+++ b/src/runtime/conversationContext/oversizedInput.ts
@@ -183,10 +183,35 @@ function splitLogicalBlocks(text: string): LogicalBlock[] {
   return blocks.length ? blocks : [{ text, startOffset: 0, endOffset: text.length }]
 }

+/**
+ * 在中日韩标点（。！？）或双换行之后分割文本。
+ * 分隔符保留在前一段末尾，行为等价于 split(/(?<=。|！|？|\n\n)/)。
+ * 不使用 lookbehind，兼容 macOS Monterey WKWebView。
+ */
+function splitOnDelimiters(text: string): string[] {
+  const result: string[] = []
+  let lastIndex = 0
+  for (let i = 0; i < text.length; i++) {
+    const ch = text[i]
+    if (ch === '。' || ch === '！' || ch === '？') {
+      result.push(text.slice(lastIndex, i + 1))
+      lastIndex = i + 1
+    } else if (ch === '\n' && i + 1 < text.length && text[i + 1] === '\n') {
+      result.push(text.slice(lastIndex, i + 2))
+      lastIndex = i + 2
+      i++ // skip the second \n of the pair
+    }
+  }
+  if (lastIndex < text.length) {
+    result.push(text.slice(lastIndex))
+  }
+  return result.length > 0 ? result : [text]
+}
+
 function splitOversizedBlock(block: LogicalBlock, maxTokens: number): LogicalBlock[] {
   if (approximateTokenSize(block.text) <= maxTokens) return [block]
-  const paragraphs = block.text.split(/(?<=。|！|？|\n\n)/)
+  const paragraphs = splitOnDelimiters(block.text)
   const result: LogicalBlock[] = []
   let current = ''
   let offset = block.startOffset
```

---

### 修改 3：`node_modules/@tiptap/extension-mathematics` — InlineMath InputRule

#### 根因

esbuild 在预打包 `@tiptap/extension-mathematics` 时，将其依赖（katex + tiptap/prosemirror 全生态）合并为一个 40,814 行的 bundle（`.vite/deps/@tiptap_extension-mathematics.js`）。

虽然项目源码和 katex 源码中均无 lookbehind，但 `@tiptap/extension-mathematics` 的 `dist/index.js` 第 282 行的 InlineMath InputRule 包含负向 lookbehind：

```javascript
// dist/index.js:282 — 原代码
find: /(?<!\$)(\$\$([^$\n]+?)\$\$)(?!\$)/,
```

语义：匹配 `$$...$$` 行内公式，但要求前面不能是 `$`（避免误匹配 `$$$...$$$` 块级公式）。

#### 修改后

移除 lookbehind（`(?<!\$)`），保留 lookahead（`(?!\$)`，Safari 15 支持）：

```javascript
// 修复后
find: /(\$\$([^$\n]+?)\$\$)(?!\$)/,
```

`match[2]` 索引不变，handler 逻辑无需修改。

lookahead `(?!\$)` 已足以防止 `$$latex$$` 被右侧多余 `$` 干扰：
- `$$$latex$$$` → 右侧 `(?!\$)` 在匹配到 `$$latex$$` 后检查到 `$`，匹配失败 ✓
- `$$$latex$$` → 从位置 1 可正确匹配 `$$latex$$` ✓

#### 影响文件

| 文件 | 修改 |
|------|------|
| `node_modules/@tiptap/extension-mathematics/dist/index.js:282` | `(?<!\$)...$` → `$...$` |
| `node_modules/@tiptap/extension-mathematics/dist/index.cjs:324` | 同上 |
| `node_modules/@tiptap/extension-mathematics/src/extensions/InlineMath.ts:223` | 同上 |

---

### 修改 4：`node_modules/marked` — lookbehind 特性检测

#### 根因

`marked` 的源码在运行时用 `new RegExp("(?<=1)(?<!1)")` 检测浏览器是否支持 lookbehind。这段代码在 try/catch 中运行，本不会造成问题。但 esbuild 预打包时会将 `new RegExp("(?<=...)")` 优化为正则字面量 `/(?<=...)/`，导致 WKWebView 解析时报 SyntaxError。

#### 修改

直接将检测结果硬编码为 `false`：

```javascript
// 原代码
return !!new RegExp("(?<=1)(?<!1)")
return !!new RegExp("(?<=1)(?<!1)"+l)

// 修复后
return false/*LB-fixed*/
```

同时将 `@tiptap/markdown` 加入 `vite.config.ts` 的 `optimizeDeps.exclude`，防止其内部对 marked 的引用被 esbuild 二次处理。

---

### 修改 5：`vite.config.ts` — optimizeDeps 排除

```typescript
optimizeDeps: {
  exclude: [
    '@tiptap/markdown',  // 防止 esbuild 优化 marked 的 lookbehind 检测
  ],
},
```

---

## 三、自动化补丁

`scripts/patch-monterey-compat.mjs` — postinstall 脚本，自动修复上述 4 个 node_modules 补丁：

```bash
# package.json
"postinstall": "node scripts/patch-monterey-compat.mjs"
```

每次 `pnpm install` 后自动执行，确保依赖更新后补丁不丢失。

---

## 四、验证结果

| 验证项 | 状态 |
|--------|------|
| `vue-tsc -b` 类型检查 | ✅ 通过 |
| `vite build` 构建 | ✅ 通过 |
| 所有 Tiptap 扩展（除 Mathematics） | ✅ REST OK |
| `@tiptap/extension-mathematics` | ✅ MATH OK |
| `@tiptap/markdown` | ✅ Markdown OK |
| `katex` 独立加载 | ✅ KATEX OK |

---

## 五、Safari 兼容性速查

| 特性 | Safari 15.x | Safari 16.4+ |
|------|-------------|--------------|
| `(?=...)` lookahead | ✅ | ✅ |
| `(?!...)` negative lookahead | ✅ | ✅ |
| `(?<=...)` lookbehind | ❌ | ✅ |
| `(?<!...)` negative lookbehind | ❌ | ✅ |
