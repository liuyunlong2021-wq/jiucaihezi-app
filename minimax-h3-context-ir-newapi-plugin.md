# MiniMax H3-Context-IR New API Task Plugin

## 结论

这个插件只做一件事：将粗糙视频提示词提交到 MiniMax H3-Context-IR，轮询任务并返回 `task.content.prompt`。它不生成视频。

上游：
- `POST https://api.minimax.cn/v2/h3_context_ir`
- `GET https://api.minimax.cn/v2/query/video_generation/{task_id}`

## 插件源码

保存为 `minimax-h3-context-ir.js`，上传到 New API：系统管理 → Task Plugins / 任务插件。

```js
function s(v) { return String(v || '').trim(); }
function taskOf(b) { const t = b && b.task; return t && typeof t === 'object' && !Array.isArray(t) ? t : null; }
function apiError(b) {
  const e = b && b.error;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  return { message: s(e.message) || 'MiniMax request failed', statusCode: Number(e.http_code || e.code || 0) };
}
function inputText(input) {
  if (typeof input === 'string') return s(input);
  if (!Array.isArray(input)) return '';
  return input.map(function (x) {
    if (typeof x === 'string') return x;
    if (!x || typeof x !== 'object') return '';
    if (typeof x.text === 'string') return x.text;
    if (typeof x.content === 'string') return x.content;
    if (Array.isArray(x.content)) return x.content.map(function (p) {
      if (typeof p === 'string') return p;
      return p && (p.type === 'input_text' || p.type === 'text') ? p.text || '' : '';
    }).join('\n');
    return '';
  }).filter(function (x) { return s(x); }).join('\n').trim();
}

export const meta = {
  apiVersion: 1,
  key: 'minimax-h3-context-ir',
  name: 'MiniMax H3 Context IR',
  description: { zh: '将普通视频提示词增强为 MiniMax H3 专业视频提示词', en: 'Enhance rough video prompts with MiniMax H3 Context IR' },
  version: '1.0.0',
  author: { name: 'local' },
  channelTypes: [35],
  models: ['MiniMax-H3-Context-IR'],
  fetchMode: 'per_task',
  protocols: ['openai_responses'],
};

export function buildSubmitRequest(ctx) {
  const r = ctx.requestBody || {};
  const prompt = s(r.prompt);
  if (!prompt) throw new Error('prompt is required');
  return {
    url: ctx.baseUrl + '/v2/h3_context_ir', method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + ctx.apiKey },
    body: {
      model: 'MiniMax-H3',
      content: Array.isArray(r.content) && r.content.length ? r.content : [{ type: 'text', text: prompt }],
      duration: Number(r.duration || 5), ratio: s(r.ratio) || '16:9',
    },
    action: 'text_to_video',
  };
}

export function parseSubmitResponse(ctx, resp) {
  const b = resp.body || {}, e = apiError(b);
  if (e) throw new Error(e.message);
  if (!b.task_id) throw new Error('MiniMax response does not contain task_id');
  return { taskId: b.task_id, taskData: b };
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + '/v2/query/video_generation/' + encodeURIComponent(ctx.taskId),
    method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + ctx.apiKey },
  };
}

export function parseTaskResult(ctx, body) {
  const e = apiError(body);
  if (e) {
    if (e.statusCode === 408 || e.statusCode === 429 || e.statusCode >= 500) throw new Error(e.message);
    return { status: 'FAILURE', progress: '100%', reason: e.message };
  }
  const t = taskOf(body);
  if (!t) return { status: 'UNKNOWN', reason: 'MiniMax response does not contain task' };
  const map = { queued: 'QUEUED', running: 'IN_PROGRESS', succeeded: 'SUCCESS', failed: 'FAILURE', cancelled: 'FAILURE' };
  const status = map[t.status];
  if (!status) return { status: 'UNKNOWN', reason: 'Unknown MiniMax task status: ' + String(t.status || '') };
  const out = { status: status, progress: status === 'QUEUED' ? '30%' : status === 'IN_PROGRESS' ? '60%' : '100%' };
  if (status === 'SUCCESS') {
    const prompt = s(t.content && t.content.prompt);
    if (!prompt) return { status: 'FAILURE', progress: '100%', reason: 'task.content.prompt is empty' };
    out.data = { prompt: prompt, task_type: t.task_type || 'h3_context_ir' };
  }
  if (status === 'FAILURE') out.reason = s(t.error && t.error.message) || 'MiniMax task failed';
  return out;
}

export const protocols = {
  openai_responses: {
    decodeRequest(ctx) {
      if (!ctx.body || ctx.body.kind !== 'json') throw new Error('JSON body required');
      const r = ctx.body.value || {}, prompt = inputText(r.input !== undefined ? r.input : r.prompt);
      if (!prompt) throw new Error('input or prompt is required');
      return { kind: 'submit', model: r.model || 'MiniMax-H3-Context-IR', action: 'text_to_video', requestBody: {
        prompt: prompt, duration: r.duration || 5, ratio: r.ratio || '16:9', content: Array.isArray(r.content) ? r.content : undefined,
      } };
    },
    renderEvents(ctx, task, previousState) {
      const status = String(task.status || 'UNKNOWN').toUpperCase();
      if (status === 'SUCCESS') return { events: previousState && previousState.status === 'SUCCESS' ? [] : [{ type: 'output', data: task.data && task.data.prompt || '' }], state: { status: 'SUCCESS', progress: 100 }, done: true };
      if (status === 'FAILURE') return { events: [{ type: 'error', code: 'task_failed', message: task.fail_reason || 'H3 Context IR task failed' }], state: { status: 'FAILURE', progress: 100 }, done: true };
      const progress = status === 'IN_PROGRESS' ? 60 : 30;
      return { events: [{ type: 'progress', message: status.toLowerCase(), progress: progress }], state: { status: status, progress: progress }, done: false };
    },
    renderFinal(ctx, task) {
      return { output: [{ type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: task.data && task.data.prompt || '', annotations: [], logprobs: [] }] }], metadata: { vendor: 'minimax', task_type: 'h3_context_ir' } };
    },
  },
};
```

## New API 配置

1. 上传并激活插件。
2. 新建渠道：
   - 类型：`Task Plugin`
   - 插件：`MiniMax H3 Context IR`
   - Base URL：`https://api.minimax.cn`
   - 密钥：MiniMax 开放平台 API Key
   - 模型：`MiniMax-H3-Context-IR`
3. Base URL 不要带 `/v2/h3_context_ir`，插件会自己拼接。
4. 服务器校验：

```bash
new-api plugin lint minimax-h3-context-ir.js
```

## 测试

```bash
curl http://NEW_API_HOST/v1/tasks/minimax-h3-context-ir \
  -H "Authorization: Bearer NEW_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-H3-Context-IR","prompt":"一个女孩在雨夜街头慢慢走着，霓虹灯倒映在水面，镜头有电影感。","duration":5,"ratio":"9:16"}'
```

返回任务 ID 后：

```bash
curl http://NEW_API_HOST/v1/tasks/TASK_ID -H "Authorization: Bearer NEW_API_TOKEN"
```

最终读取：`data.prompt`。

# App 适配方案（结论）

不要把 H3-Context-IR 当成视频生成模型，也不要并入现有视频任务链。新增独立能力：

```text
原始提示词 → New API H3-Context-IR → 展示增强结果 → 用户确认/编辑 → 现有 MiniMax-H3 视频生成
```

建议在视频生成面板增加“增强提示词”按钮：

1. 用户填写粗提示词。
2. 点击增强，调用 New API 的 `MiniMax-H3-Context-IR`。
3. 轮询任务或使用 Responses 兼容接口。
4. 返回 `data.prompt` 后填入原提示词编辑框。
5. 用户可修改，不自动生成视频。
6. 用户点击原有生成按钮，继续使用现有 H3 视频链路。

App 不保存 MiniMax Key，只保存 New API 地址和用户令牌。

推荐内部模型配置：

```ts
{ id: 'minimax-h3-context-ir', label: 'MiniMax H3 提示词增强', kind: 'prompt-enhancer', apiModel: 'MiniMax-H3-Context-IR' }
```

现有视频模型继续独立配置：

```ts
{ id: 'minimax-h3', label: 'MiniMax H3 视频生成', kind: 'video-generation', apiModel: 'MiniMax-H3' }
```

失败时保留原始提示词，不自动提交视频。第一版只做文本；后续再把图片/视频/音频通过 `content` 数组传给插件。
