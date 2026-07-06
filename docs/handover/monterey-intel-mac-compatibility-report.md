# macOS Monterey (Intel Mac) 兼容性修复报告

> **日期**: 2026-07-06
> **作者**: GitHub Copilot + 用户协作
> **目标**: 向仓库维护者说明 Intel Mac + macOS Monterey 无法启动的原因及完整修复方案

---

## 一、问题概述

**现象**: 韭菜盒子 Studio 桌面端（Tauri v2）在 macOS 12.7.6 Monterey（Intel Mac）上启动后白屏，无法使用。控制台报错：

```
SyntaxError: Invalid regular expression: invalid group specifier name
```

**影响范围**: 所有运行 macOS 12.x Monterey 的 Intel Mac 用户（含 2015-2019 年款 MacBook Pro/Air/iMac 等）。M 芯片 Mac 不受影响（macOS 13+）。

**根因**: macOS Monterey 内置的 WKWebView 使用 Safari 15 内核，**不支持正则表达式 lookbehind 断言** `(?<=...)` / `(?<!...)`。该语法从 Safari 16.4（macOS 13.3 Ventura）才开始支持。

---

## 二、受影响的代码（共 5 处）

### 2.1 项目源码（2 处）

| 文件 | 行号 | 原始代码 | 问题 |
|------|------|----------|------|
| `src/utils/mathRenderer.ts` | 46 | `/\$(?=\S)(.+?)(?<=\S)\$/g` | `(?<=\S)` lookbehind |
| `src/runtime/conversationContext/oversizedInput.ts` | 189 | `text.split(/(?<=。\|！\|？\|\n\n)/)` | `(?<=...)` lookbehind |

### 2.2 node_modules 依赖（3 处）

| 包 | 文件 | 原始代码 | 问题 |
|----|------|----------|------|
| `@tiptap/extension-mathematics` | `dist/index.js:282` | `/(?<!\$)(\$\$...)(?!\$)/` | `(?<!\$)` lookbehind |
| `marked` (v16/17/18) | `marked.esm.js` | `new RegExp("(?<=1)(?<!1)")` | esbuild 将其转为字面量 `/ (?<=1)(?<!1)/` |
| `marked` (v16/17/18) | 同上 | esbuild 预打包时破坏 try/catch | 特性检测代码被"优化" |

---

## 三、排查过程

### 3.1 环境搭建（6 个步骤）

在空白 Intel Mac 上从头搭建开发环境：

```bash
# 1. 安装 pnpm
npm install -g pnpm

# 2. 安装依赖
pnpm install

# 3. 安装 Rust（Tauri 编译需要）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 4. 获取 OpenCode sidecar 二进制
node scripts/update-opencode-runtime.mjs

# 5. 启动
pnpm tauri dev
# → 白屏
```

### 3.2 定位 lookbehind 源（关键方法）

**步骤 1 — 创建最小测试桩**

修改 `index.html` 加载 `src/main-quick.ts`，逐个导入模块，二分法缩小范围：

```typescript
// 测试某个模块是否导致白屏
import { SomeModule } from 'some-package'
console.log('OK')
document.getElementById('app')!.innerHTML = '<div>OK</div>'
```

**步骤 2 — 逐模块排除**

| 测试 | 结果 | 结论 |
|------|------|------|
| 空测试（无 import） | ✅ OK | Vue/基础没问题 |
| `@tiptap/markdown` | ❌ 报错 | marked 依赖有问题 |
| `katex` 独立 import | ✅ OK | katex 本身没问题 |
| `@tiptap/extension-mathematics` | ❌ 报错 | 扩展本身有问题 |
| 其余 8 个 suspect 扩展批量 | ✅ REST OK | 只有 Mathematics 有问题 |

**步骤 3 — 深入 esbuild 缓存**

`@tiptap/extension-mathematics` 的 dist 源码中无 lookbehind，但 esbuild 预打包后缓存文件 `.vite/deps/@tiptap_extension-mathematics.js` 第 40721 行发现：

```javascript
find: /(?<!\$)(\$\$([^$\n]+?)\$\$)(?!\$)/,
```

**根因链**: `@tiptap/extension-mathematics@3.27.1` 的 InlineMath InputRule 使用了 `(?<!\$)` lookbehind → esbuild 预打包时将 40,814 行的依赖全量合并 → WKWebView 加载时解析报错。

### 3.3 关键发现

1. **esbuild 的"优化"是帮凶**: `marked` 用 `try { new RegExp("(?<=1)(?<!1)") } catch` 做浏览器特性检测，安全且正确。但 esbuild 在预打包时将 `new RegExp("(?<=...)")` **优化为正则字面量** `/(?<=...)/`，导致 JS 解析阶段就报 SyntaxError（try/catch 无法捕获解析错误）。

2. **Safari 15 只不支持 lookbehind，lookahead 正常**: `(?=...)` / `(?!...)` 完全可用。这让我们能保留 `(?!\$)` 而仅移除 `(?<!\$)`。

---

## 四、修复方案

### 4.1 修复 1：`mathRenderer.ts` — 用捕获组替代 lookbehind

```diff
- /\$(?=\S)(.+?)(?<=\S)\$/g
+ /\$(\S(?:.*?\S)?)\$/g
```

**语义等价**: `\S` 确保第一个字符非空白，`(?:.*?\S)?` 可选部分确保最后一个字符非空白。

### 4.2 修复 2：`oversizedInput.ts` — 逐字符遍历替代 split

```typescript
// 新增辅助函数，手动查找分隔符并保留在前一段末尾
function splitOnDelimiters(text: string): string[] {
  const result = []
  let lastIndex = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '。' || ch === '！' || ch === '？') {
      result.push(text.slice(lastIndex, i + 1))
      lastIndex = i + 1
    } else if (ch === '\n' && text[i + 1] === '\n') {
      result.push(text.slice(lastIndex, i + 2))
      lastIndex = i + 2; i++
    }
  }
  if (lastIndex < text.length) result.push(text.slice(lastIndex))
  return result.length > 0 ? result : [text]
}
```

### 4.3 修复 3：`@tiptap/extension-mathematics` — 移除 lookbehind，保留 lookahead

```diff
- find: /(?<!\$)(\$\$([^$\n]+?)\$\$)(?!\$)/
+ find: /(\$\$([^$\n]+?)\$\$)(?!\$)/,
```

**分析**: lookahead `(?!\$)` 已足够防止 `$$$latex$$$` 误匹配：
- 输入 `$$$latex$$$` → 匹配到 `$$latex$$` → 右侧 `$` 触发 lookahead 失败 → 正确拒绝 ✓
- 输入 `$$latex$$` → 正常匹配 ✓

`match[2]` 索引不变，handler 逻辑无需任何修改。

### 4.4 修复 4：`marked` — 硬编码 lookbehind 检测结果为 `false`

```diff
- return!!new RegExp("(?<=1)(?<!1)")
+ false/*LB-fixed*/
```

因 Safari 15 确实不支持 lookbehind，硬编码 `false` 是正确的；marked 会 fallback 到无 lookbehind 的替代实现。

### 4.5 修复 5：`vite.config.ts` — 排除预打包

```typescript
optimizeDeps: {
  exclude: ['@tiptap/markdown'],
},
```

防止 esbuild 在预打包时二次处理已修复的 marked。

---

## 五、自动化补丁（postinstall 脚本）

修复 3 和 4 位于 `node_modules/`，每次 `pnpm install` 会丢失。因此创建了 **postinstall 自动补丁脚本**：

**文件**: `scripts/patch-monterey-compat.mjs`

```bash
# package.json
"postinstall": "node scripts/patch-monterey-compat.mjs"
```

脚本每次 `pnpm install` 后自动执行，检测并修复：
- `@tiptap/extension-mathematics` 的 3 个文件（dist/index.js, dist/index.cjs, src/extensions/InlineMath.ts）
- `marked` 的 3 个版本（v16.4.2, v17.0.6, v18.0.3）

---

## 六、验证结果

| 验证项 | 结果 | 说明 |
|--------|------|------|
| `vue-tsc -b` | ✅ 通过 | TypeScript 类型检查无错误 |
| `vite build` | ✅ 通过 | 4.13s 构建成功 |
| 空测试（无 import） | ✅ OK | 基础环境正常 |
| `@tiptap/markdown` | ✅ OK | marked 补丁生效 |
| `katex` 独立 | ✅ OK | katex 本身兼容 |
| 其余 8 个 Tiptap 扩展 | ✅ REST OK | Audio/TrailingNode/Details/TableOfContents/FileHandler/UniqueID/DragHandle/NodeRange 全部正常 |
| `@tiptap/extension-mathematics` | ✅ MATH OK | 核心修复生效 |
| 完整应用 `pnpm tauri dev` | ✅ 正常启动 | 完整 UI 加载，窗口可拖动 |

---

## 七、给维护者的建议

### 7.1 短期（已实施）

以上修复方案已验证有效，可直接合入主分支。

### 7.2 中期（建议）

1. **CI 增加 macOS 12 测试**: 在 GitHub Actions 中增加 macOS 12 的构建和冒烟测试，防止回归。
2. **考虑升级 `@tiptap/extension-mathematics`**: 向 tiptap 上游提交 PR 移除 lookbehind，或等待官方修复。
3. **esbuild 行为**: 关注 esbuild 的 [issue](https://github.com/evanw/esbuild/issues) 关于 `new RegExp` 优化破坏 try/catch 的问题——这是 `marked` 的根因。

### 7.3 长期

- Safari 15 的 lookbehind 限制不影响现代浏览器（Chrome 62+/Firefox 78+/Safari 16.4+ 均支持）。但目前仍有大量 Intel Mac 用户停留在 Monterey（macOS 12 是最后一个支持部分旧款 Intel Mac 的系统）。
- 建议在编码规范中禁止使用 lookbehind，或用 `eslint-plugin-no-unsupported-browser-features` 在 CI 中拦截。

---

## 八、修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/utils/mathRenderer.ts` | 修改 | 移除 lookbehind |
| `src/runtime/conversationContext/oversizedInput.ts` | 修改 | 逐字符分割替代 split |
| `vite.config.ts` | 修改 | optimizeDeps.exclude 排除 @tiptap/markdown |
| `package.json` | 修改 | 添加 postinstall 钩子 |
| `scripts/patch-monterey-compat.mjs` | 新增 | 自动补丁脚本 |
| `docs/sdd/regex-lookbehind-compat-monterey-sdd.md` | 新增 | 详细 SDD 文档 |

---

*本报告由 GitHub Copilot 与用户在 macOS 12.7.6 Intel Mac 上实地排查生成，所有修复均已完成并验证通过。*
