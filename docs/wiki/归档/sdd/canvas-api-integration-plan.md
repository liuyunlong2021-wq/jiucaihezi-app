# 画布 API 连线方案

> **日期**: 2026-07-11
> **目标**: 画布工具栏 → AI 编辑能力

---

## 一、两条路线

根据 AGENTS.md，我们的核心是 OpenCode。画布有两种方式接 AI：

| 路线 | 走什么 | 适用场景 | 复杂度 |
|------|--------|---------|--------|
| **A. 直连 API** | `media-generation.ts` → NewAPI | 确定性编辑（去背景、扩图） | 低 |
| **B. Agent 驱动** | `useChat().sendMessage()` → OpenCode | 自然语言编辑（标注修图、文字改写） | 中 |

**Phase 1 用路线 A**——直连 API，不经过 Agent。因为去背景、扩图这些是确定性操作，不需要 Agent 理解自然语言。

## 二、路线 A：直连 API

### 流程图

```
用户在画布选中图片 → 点工具栏按钮（如"去背景"）
  → 获取选中图片 → 转 base64
  → 调 media-generation.ts 的 submitImageGen({
      model: 'gpt-image-2',
      prompt: 'remove background, transparent',
      image: base64,
    })
  → NewAPI 生成 → 轮询结果
  → 结果图片出现在画布（原图旁边）
```

### 代码骨架

```ts
// src/components/canvas/tools/removeBg.ts
import { submitImageGen, pollTask } from '@/api/media-generation'

export async function removeBackground(imageBase64: string): Promise<string> {
  const { taskId, pollUrl } = await submitImageGen({
    model: 'gpt-image-2',
    prompt: 'Remove the background, make it transparent, keep only the main subject',
    image: imageBase64,
    size: '1024x1024',
  })
  const resultUrl = await pollTask(pollUrl, 'image')
  return resultUrl
}
```

### 工具栏接线

```ts
// CreationPanel.vue canvasTool() 中：
case 'removeBg': {
  const selected = app?.editor?.list?.[0]
  if (!selected) break
  const base64 = await exportElementAsBase64(selected)
  const resultUrl = await removeBackground(base64)
  addImageToCanvas(resultUrl)
  break
}
```

### 各工具需要的 prompt 模板

| 工具 | model | prompt |
|------|-------|--------|
| ✂ 去背景 | gpt-image-2 | "Remove background, transparent, keep main subject" |
| ⬛ 扩图 | gpt-image-2 | "Expand image to {ratio}, fill edges naturally" |
| 📝 文字改写 | gpt-image-2 | "Keep style, change text from '{old}' to '{new}'" |
| 🎨 模板 | gpt-image-2 | 小红书封面/电商组图 的完整 prompt |

---

## 三、路线 B：Agent 驱动（Phase 2）

### 流程

```
用户在画布上画箭头标注 → 点"提交修图"
  → 收集原图 + 标注数据
  → 用 useChat().sendMessage() 发送给 OpenCode Agent:
     "按标注修改这张图：箭头1指向眼睛，文字'改大一点'，箭头2指向嘴巴，文字'微笑'"
  → Agent 调 NewAPI 生成 → 结果返回到聊天
  → 画布接收结果 → 显示在原图旁边
```

### 优势
- 标注修图需要自然语言理解 → Agent 比纯 API 强
- 复杂编辑（多步操作）Agent 可以自主规划

### 复杂度
- 需要等 Agent 回复，异步
- 结果需要从聊天消息中提取 URL
- 比路线 A 慢（Agent 思考 + 生成）

---

## 四、Phase 1 执行（先做去背景，最简最能验证）

### 第一步：去背景工具

1. 工具栏加「✂ 去背景」按钮
2. 选中图片 → 点按钮
3. 图片转 base64 → 调 NewAPI → 结果入画布

**改动文件**：
- `CreationPanel.vue` — canvasTool 加 `removeBg` case + 工具栏加按钮
- 新增 `src/components/canvas/tools/removeBg.ts` — API 调用封装

### 第二步：扩图工具

同上模式。

### 第三步：模板工具

Vue 表单 → 构造 prompt → 调 NewAPI → 结果入画布。

---

## 五、对应 OpenCode Agent 的部分（Phase 2）

```
画布暴露给 Agent 的接口（通过 MCP tools 或 event）:

canvas.getSelected()       → 返回选中图片的 path/base64
canvas.addImage(url)       → 添加图片到画布  
canvas.removeImage(id)     → 删除图片
canvas.getAnnotations()    → 返回标注数据

Agent 通过 sendMessage() 接收用户自然语言指令 →
  调用 MCP tools 操作画布 →
  调 NewAPI 生成 →
  结果回写画布
```
