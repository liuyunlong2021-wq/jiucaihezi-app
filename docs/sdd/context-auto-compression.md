# 上下文自动压缩 — SDD

> 版本: V1 | 日期: 2026-05-29 | 状态: 执行中

## 一、问题

当前 system prompt 有 80K 硬截断，对话历史有 102K token 预算截断，413 错误返回用户不友好的提示。用户不知道这些限制的存在，看到截断/错误会认为产品有 bug。

## 二、目标

用户无限畅聊，产品自动处理上下文溢出——对标 ChatGPT 体验。

```
用户输入 → 全量发送 → API 返回 400/413 context overflow
  → 自动压缩（LLM 摘要旧消息）
  → 重试
  → 成功 → 用户无感知
  → 仍失败 → 提示"对话内容过多，请新建对话继续"
```

## 三、设计决策

| 决策 | 理由 |
|------|------|
| 不做预截断 | 用户看到截断 = 认为产品阉割。ChatGPT 不做预截断 |
| 溢出时自动压缩重试 | 用户无感知，符合零教育成本原则 |
| 不显示 Token 水位 | 已删除。用户不需要理解这个概念 |
| 压缩用 haiku-4-5 | 最快最便宜，摘要质量足够 |
| 保留最近 10 条原始消息 | 用户正在聊的上下文不丢失 |
| 压缩串行、不并发 | 两次 LLM 调用之间有依赖，压缩后才知道新 body 大小 |

## 四、修改文件

| 文件 | 改动 |
|------|------|
| `useChat.ts` | ①删除 80K 截断 ②删除 102K token 预算截断 ③删除 max_tokens 限制 ④添加 compressContext() + 溢出重试 |
| `api.ts` | 撤销 413 专属文案 |
| `modelContextWindows.ts` | 更新窗口值为 1M |

## 五、核心逻辑 - compressContext

```ts
async function compressContext(messages, modelId): Promise<Array> {
  // 1. 取前 50% 消息（最早的部分）用于压缩
  // 2. 调 haiku-4-5 生成摘要
  // 3. 返回: [{ role: 'user', content: '[历史摘要] ...' }, ...最近10条原始消息]
}
```

## 六、溢出检测

在 `runToolLoop` 和 `runResponsesChat` 的 error 处理中检测：

```ts
if (status === 400 || status === 413) {
  const errorText = raw.toLowerCase()
  if (errorText.includes('context') || errorText.includes('token') || errorText.includes('length')) {
    // 触发压缩重试
  }
}
```

## 七、验收标准

- [ ] 164 focused tests 全部通过
- [ ] vue-tsc 零错误
- [ ] vite build 成功
- [ ] system prompt 不再有 80K 截断
- [ ] 对话历史不再有 102K token 预算截断
- [ ] 413 错误不再显示专属文案
- [ ] compressContext 函数存在并可被溢出检测调用
