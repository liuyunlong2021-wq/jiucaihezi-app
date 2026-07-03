# Web 图标字体修复执行文档 · Phase 1（1 小时止血）

**修复目标**：Web 端 (https://jiucaihezi.studio/) 首屏打开时，因 Material Symbols 字体（3.52MB）尚未下载完成，浏览器把 ligature 暗号字符（如 `add_circle` `chat` `forum`）当成普通文本渲染出来，看起来像一堆英文乱码。

**修复手段**：给所有 `.mso` 图标加一个"字体没准备好就先隐藏"的开关。字体加载完成（或 5 秒兜底超时）后再统一显示。

**为什么这样修**：
- 字体已经是本地打包了（见 `src/styles/base.css:9`），问题不在 CDN，在文件太大导致首屏窗口期太长。
- 替换全部 596 处图标调用为 SVG 是 Phase 2 的事，本期不做。
- 本期是「让用户看不到丢人的英文文字」，不是「根治体积问题」。

---

## 0. 前置检查

```bash
cd /Users/by3/Documents/jiucaihezi-app
git status
```

- 当前分支应为 `media-creation-optimization`
- worktree 可能有少量未提交改动，不要碰它们，做完一起留给用户 review

## 1. 修改 `src/styles/base.css`

### 1.1 找到 `.mso` class 定义

文件第 43-60 行附近：

```css
/* Material Symbols helper */
.mso {
  font-family: 'Material Symbols Outlined';
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
  font-feature-settings: 'liga';
  font-style: normal;
  font-weight: normal;
  letter-spacing: normal;
  text-transform: none;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  font-size: inherit;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

### 1.2 在 `.mso` 块内追加 `visibility: hidden;`

在 `justify-content: center;` 后面、闭合 `}` 之前加一行：

```css
  visibility: hidden;
```

完整修改后 `.mso` 块应为：

```css
.mso {
  font-family: 'Material Symbols Outlined';
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
  font-feature-settings: 'liga';
  font-style: normal;
  font-weight: normal;
  letter-spacing: normal;
  text-transform: none;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  font-size: inherit;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  visibility: hidden;
}
```

### 1.3 紧接着 `.mso-fill` 那行下方添加新规则

原文件第 61 行：

```css
.mso-fill { font-variation-settings: 'FILL' 1, 'wght' 400; }
```

在这行下方插入：

```css

/* 图标字体加载完成前，由 iconFontGate.ts 在 <html> 上加 .mso-ready 后再显示 */
html.mso-ready .mso {
  visibility: visible;
}
```

### 1.4 不要动的内容

- `@font-face` 已经有 `font-display: block`（第 8 行），不要改
- Noto Serif SC / Inter 等其他字体声明不要动
- 滚动条、selection、toast 等其他样式不要动

## 2. 新建 `src/utils/iconFontGate.ts`

文件不存在，直接 Write。完整内容：

```typescript
/**
 * 图标字体加载闸门：
 * 默认 .mso 元素 visibility: hidden（见 base.css）。
 * 字体加载完成（或 5s 兜底超时）后，给 <html> 加 .mso-ready 释放显示。
 * 防止 Material Symbols 3.5MB woff2 未到位时，ligature 暗号文本（如 "add_circle"）露馅。
 */
export function initIconFontGate(): void {
  if (typeof document === 'undefined') return

  const reveal = () => {
    document.documentElement.classList.add('mso-ready')
  }

  // 兜底：5 秒后无论如何释放，避免字体加载彻底失败时图标永远空白
  const hardTimeout = window.setTimeout(reveal, 5000)

  if ('fonts' in document && document.fonts) {
    document.fonts.ready
      .then(() => {
        window.clearTimeout(hardTimeout)
        reveal()
      })
      .catch(() => {
        window.clearTimeout(hardTimeout)
        reveal()
      })
  } else {
    window.clearTimeout(hardTimeout)
    reveal()
  }
}
```

## 3. 修改 `src/main.ts`

### 3.1 加 import

在文件顶部 import 区块末尾（第 11 行 `consumeApiKeyCallbackUrl` 那行下方）追加一行：

```typescript
import { initIconFontGate } from '@/utils/iconFontGate'
```

### 3.2 在 `mountApp()` 调用之前调用一次

定位到第 142 行 `mountApp()` 调用：

```typescript
mountApp()
```

在这一行**之前**插入一行（与 `mountApp()` 之间空一行）：

```typescript
initIconFontGate()

mountApp()
```

### 3.3 不要动的内容

- 不要改 `boot()` / `initBackend()` / `mountApp()` 函数体
- 不要加任何 `bootLog(...)` 调用
- 不要碰 `__JC_BOOT_LOG__` / `__JC_FETCH_PATCHED__` / `__JC_STORAGE_*` 等启动标志

---

## 4. 验证（4 步，必须全部跑）

### 4.1 类型检查

```bash
pnpm exec vue-tsc -b
```

**通过标准**：无报错。如果有报错，必须只来自你刚加的代码；不要改其他文件来"修"无关报错。

### 4.2 Web Dev 慢速网络验证（最关键）

```bash
pnpm dev
```

等输出 `Local: http://localhost:5173/`（或其他端口）。

操作：
1. 浏览器打开该地址
2. F12 → DevTools → **Network 面板** → 下拉选择 **Slow 3G**（如果没有，选 "Slow 4G" 或 "Custom" 限到 200kb/s）
3. **Ctrl+Shift+R** 硬刷新

**预期现象（修复成功）**：
- 页面布局先出现
- 图标位置是**空白**（不是英文文字）
- 1-10 秒后字体加载完成，所有图标**一次性涌现**

**失败现象（修复未生效）**：
- 仍能看到 "add_circle"、"chat"、"forum" 等英文文字
- 排查：DevTools Console 输入 `document.documentElement.classList`，看是否有 `mso-ready`。如果没有，说明 JS 没跑到 reveal。如果有但仍显示文字，说明 CSS 改错了。

### 4.3 Web 生产构建

```bash
pnpm exec vite build
```

**通过标准**：无报错，`dist/` 正常生成。

### 4.4 桌面 APP 回归测试

```bash
pnpm dev
```

另开一个终端：

```bash
pnpm run tauri dev
```

操作：
- 等 Tauri 窗口起来
- 检查所有图标是否正常显示
- 不应该有任何空白延迟（桌面端字体是本地的，`document.fonts.ready` 应该秒解析）

**预期现象**：APP 体验与修复前完全一致。

**失败现象**：APP 图标空白超过 1 秒，或者永远不出现。排查：是不是 5s 兜底没生效，或者 `document.fonts` API 在 Tauri WebView 里行为异常。如果遇到，停下问用户。

---

## 5. 完成后

- **不要** `git add` / `git commit`
- **不要** `git push`
- 运行 `git diff src/styles/base.css src/utils/iconFontGate.ts src/main.ts`，把完整 diff 输出给用户
- 把第 4 节 4 步验证的实际结果一项一项汇报给用户
- 任何文档里没明说、你自己做了决策的地方（比如插入位置稍有偏移、变量命名等），单独列出来说明

---

## 6. 回滚

如果用户判断要回滚：

```bash
git checkout -- src/styles/base.css src/main.ts
rm src/utils/iconFontGate.ts
```

本次改动**零数据迁移、零依赖变更、零 schema 改动**，回滚干净。

---

## 7. 边界声明

本次**只解决「Web 端首屏看到英文文字」**这一个问题。

**不解决**：
- 字体文件 3.52MB 体积大、首屏慢 → Phase 2 改用 unplugin-icons + Iconify 才能根治
- 596 处硬编码 `<span class="mso">` 用法 → Phase 2 才动
- 6 个动态图标映射函数 → Phase 2 才动

如果用户在本次任务里追加要求做这些，**停下来问**，不要自行扩展范围。
