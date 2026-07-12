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

## 九、实测发现的新问题（P0 设计缺陷）

在完成 lookbehind 修复、成功打包 DMG 后，进行了完整的端到端测试（使用 JC-taijianskill-creator 创建 Skill）。期间发现两个严重的设计缺陷，会导致用户**损失金钱和进度**。

### 9.1 缺陷 A：ad-hoc 签名 → TCC 权限永久拒绝

#### 场景

```
用户打开 ad-hoc 签名的 DMG → macOS 弹窗「韭菜盒子想访问文件」→ 用户点「拒绝」
→ 之后再打开 app，macOS 不再弹窗询问 → 文件访问权限永久被拒
→ opencode 武模式无法写入文件 → 卡住
```

#### 根因

macOS 对不同类型的应用有不同策略：

| 签名类型 | 拒绝权限后行为 |
|----------|---------------|
| App Store 应用 | 下次仍弹窗 ✅ |
| Developer ID 签名 | 下次仍弹窗 ✅ |
| **ad-hoc 签名**（本地打包） | **永久拒绝，永不弹窗** ❌ |

本机打包时因无开发者证书，签名被改为 ad-hoc（`signingIdentity: "-"`），导致 macOS 将其视为不可信应用。

#### 修复

```bash
# 手动重置权限
tccutil reset All com.jiucaihezi.desktop
```

**正式发布用 Developer ID 证书签名即可解决。** 本地测试环境可保留此命令作为排障知识。

### 9.2 缺陷 B：WKWebView SSE 断连 + 重启丢失会话 = 用户损失金钱

#### 场景（真实发生）

```
1. 用户用 JC-taijianskill-creator 创建 Skill，opencode 跑武模式
2. opencode 执行到 step 8，提出 5 个问题
3. 用户花了 2+ 分钟仔细回答
4. opencode 继续执行 step 9-10，此时触发 external_directory 权限弹窗
5. 在等待用户点击权限弹窗期间，WKWebView 的 SSE 长连接因空闲超时断开
6. 前端显示「OpenCode 内核连接失败：Load failed」
7. 用户重启 app
8. ❌ 新的 opencode 进程启动（新端口），不会重连旧会话
9. ❌ 旧会话数据在 SQLite 中完整保存，但前端无恢复机制
10. ❌ 用户只能重来，损失 10 步的 API 调用费用
```

#### 根因分析

**根因 1 — WKWebView SSE 空闲断连**：
- opencode 通过 SSE 推送事件到前端
- 当 opencode 等待用户回复权限弹窗时，SSE 无新事件
- WKWebView（Safari 15）在空闲一段时间后关闭 SSE 连接
- `useChat.ts:2021` 捕获到 HTTP 错误，显示"Load failed"
- **但 opencode 后端进程完全正常**，仍在等待权限回复

**根因 2 — 重启后无法恢复会话**：
- `opencode_ensure_server` 总是启动**新的** opencode 进程（新随机端口）
- 前端 `sessionStore` 不感知 opencode SQLite 中的已有会话
- 没有"检测已有 opencode 进程并重连"的逻辑
- 没有"从 SQLite 恢复上次会话"的机制

**验证**：通过 `sqlite3` 直接查询 opencode 数据库，确认会话数据完整保留：
```
session: ses_0ca8d9739ffeRwVOmWyfalwRWK
  10 steps completed
  questions asked & replied
  permission asked (pending)
  title: "@skill-creator 把/Volumes/我的电脑/韦一/文档/Antigravity/..."
```

#### 建议修复（P0，回 M 芯片 Mac 后优先做）

| 优先级 | 修复项 | 方案 |
|:------:|--------|------|
| P0 | SSE 断连自动重连 | `useChat.ts` 的 `subscribeOpenCodeEvents` 加断连检测 + 指数退避重试（1s/2s/5s），重连成功后恢复事件订阅，不清空 messages |
| P0 | 启动时恢复已有 opencode 进程 | `opencode_ensure_server` 启动前先扫描 `lsof -iTCP -sTCP:LISTEN` 检测是否有遗留 opencode，如有则直接连接而非启动新进程 |
| P0 | 启动时恢复上次会话 | 启动时从 opencode SQLite 读取最新 session，提供"恢复上次会话"选项，或自动重连 |
| P1 | 权限等待期间保持 SSE 活跃 | opencode 侧或前端侧定期发送 heartbeat/ping 保持连接 |

#### 临时 workaround（开发测试用）

```bash
# 断连后不要重启 app！先检查 opencode 是否还活着：
ps aux | grep opencode | grep -v grep

# 如果活着，刷新前端页面重连（不是重启 app）：
# 在 app 中 Cmd+R 或关闭窗口再打开

# 如果必须重启，先确认会话数据还在：
sqlite3 ~/.jiucaihezi/opencode-runtime/data/jiucaihezi-opencode.db \
  "SELECT id, title, time_created FROM session ORDER BY time_created DESC LIMIT 5;"
```

---

*本报告由 GitHub Copilot 与用户在 macOS 12.7.6 Intel Mac 上实地排查生成，所有修复均已完成并验证通过。*
