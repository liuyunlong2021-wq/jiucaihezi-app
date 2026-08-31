# Dola Seedance 2.5 结果自动下载落盘 TDD

> 状态：实现完成，待生产验收
> 日期：2026-08-31
> 范围：Dola Seedance 2.5 独立适配器、Creation Runtime、媒体任务落盘

## 1. 目标

Dola 视频生成成功后，创作面板应与其他已落盘的视频一致：

1. 生成结果自动下载到当前项目。
2. 文件按任务摘要和任务 ID 命名，并固定使用 `.mp4`。
3. 任务历史显示项目内路径，并提供既有的「预览」「放到画布」「打开文件夹」动作。
4. 浏览器不得再要求用户复制第三方 Dola URL 到网页手动下载。

保留已经确认的 Dola 输入合同：最多 30 张参考图、单张不超过 20 MiB、固定 720p、固定 30 秒；不恢复“所有图片合计 20 MiB”的旧限制。

## 2. 当前根因

### 2.1 适配器只返回第三方 URL

`dola-seedance-adapter/src/main.py` 的查询接口在成功时直接返回 Dola CDN 的 `task.url`，没有实现 `GET /v1/videos/{task_id}/content`。Creation Runtime 因而把 `https://v16-dola.dola.com/...` 保存为最终结果地址。

### 2.2 Web 取回无法稳定跨域

现有 Web 落盘会尝试 `fetch` 结果 URL。Dola CDN 不属于韭菜盒子同源受保护地址，浏览器可能因 CORS 或响应头失败；任务于是保留远程 URL，卡片继续显示「复制链接」「保存到项目」。

### 2.3 上一轮下载修改没有命中实际入口

上一轮只修改了 `CreationPanel` 预览窗口的 `downloadTaskPreview()`。远程任务在可保存状态下不会打开该预览入口，用户复制 URL 后在浏览器下载也完全绕过这段代码，因此不能解决自动落盘。

## 3. 设计决断

### 3.1 Dola 适配器提供同源流式内容代理

- 新增 `GET /v1/videos/{task_id}/content`。
- 继续要求调用方携带 Bearer Token；适配器使用同一授权向 Dola 查询任务并取得临时 `task.url`，再以流式方式转发视频字节。
- 使用 `httpx.AsyncClient.stream()` 和 `StreamingResponse`，不把完整 MP4 缓冲在适配器内存中。
- 上游成功响应的 `Content-Type` 透传；缺失或无效时回退为 `video/mp4`。
- 上游非 2xx、缺少视频 URL、任务未完成或 URL 不安全时返回明确的 4xx/5xx，不把第三方错误正文原样泄露给客户端。
- 适配器重启后仍可通过任务 ID重新查询，不依赖进程内 URL 缓存、数据库或后台下载队列。

### 3.2 Creation Runtime 对 Dola 使用内容端点

- `dola-seedance2.5` 的视频轮询完成后返回同源 `/v1/videos/task_xxx/content` 地址，而不是第三方 CDN URL。
- 复用现有 `pollTask()` 的内容端点分支和 NewAPI Bearer 认证规则；只把 Dola 加入需要内容端点的模型判断，不改变其他模型的轮询。
- 历史任务若已保存第三方 URL，且仍有 Dola 的轮询地址和任务快照，点击「保存到项目」时先重新轮询并切换为同源内容地址，再进入现有落盘流程。
- 无法重新取得任务状态时保留原始安全远程 URL，并保留「复制链接」和「保存到项目」兜底，不把已生成任务改写为生成失败。

### 3.3 复用现有媒体落盘和 UI

- Web 继续调用 `fetchCreationMediaBlob()`，同源 `/content` 自动附加当前 NewAPI Token。
- Desktop 继续调用 `http_download_base64`，同源 `/content` 附加当前 Token；第三方 CDN 永不携带工作台 Token。
- 继续使用 `webCreationMediaProjectPath()` / `writeProjectMedia()` 生成安全文件名和 `.mp4` 扩展名。
- 不新增 Dola 专用前端下载按钮、独立缓存表、远程存储或第二套任务状态。

### 3.4 NewAPI 端口合同

- 适配器容器监听标准 HTTP `80` 端口；NewAPI 渠道 URL 使用 `http://dola-seedance-adapter`，不再使用被安全策略拦截的 `:8789`。
- 模型名 `dola-seedance2.5`、价格 `0.2/秒`、固定 `720p` 和 `30` 秒不变。

## 4. TDD 验收设计

### 4.1 适配器内容代理

**红灯：**

1. `GET /v1/videos/{id}/content` 当前返回 404。
2. 缺少 Bearer Token 时不得访问 Dola 上游。
3. Dola 任务成功但没有 `task.url` 时不能返回 200 空响应。
4. 上游视频响应必须流式转发，测试不得要求适配器读取完整响应到内存。

**绿灯：**

1. 合法任务 ID 和 Bearer Token 返回上游视频字节，状态码 200，`Content-Type` 为上游类型或 `video/mp4`。
2. 缺少或非法任务 ID 返回 400，缺少 Token 返回 401。
3. 上游 404/5xx、任务未完成和缺失 URL分别映射为明确错误，不能泄露完整上游响应、Token 或临时 URL。
4. 上游流关闭由 `BackgroundTask` 或等价生命周期保证；适配器不缓存完整视频。

### 4.2 Runtime 轮询结果

**红灯：**

1. `dola-seedance2.5` 完成轮询当前提取第三方 `video_url`。
2. Dola 任务返回 `task_xxx` 时，当前不会构造同源 `/v1/videos/task_xxx/content`。
3. 其他模型的内容端点和普通 URL 行为没有隔离合同。

**绿灯：**

1. Dola 完成轮询返回 `https://api.jiucaihezi.studio/v1/videos/task_xxx/content`。
2. Dola 以 `queued`/`processing` 返回时继续按现有间隔轮询；失败状态仍按现有失败合同结束。
3. Omni、普通 RH、图片、音频和文本模型的轮询 URL 与结果提取保持原行为。

### 4.3 媒体任务落盘

**红灯：**

1. 同源 Dola `/content` 结果当前没有被保存为项目文件。
2. Web 保存失败后任务卡只保留第三方 URL，重试不会重新获取同源内容。
3. 直接 URL 的响应头没有扩展名时，项目文件名可能回退为无扩展名文件。

**绿灯：**

1. Web 和 Desktop 对同源 Dola `/content` 均携带当前工作台 Token，下载成功后写入 `jc-media/videos/*.mp4`。
2. 项目文件写入成功后任务状态为 `success` 且 `assetStatus=local`，卡片出现「预览」「放到画布」「打开文件夹」。
3. 保存失败仍保留成功任务、原始结果和「保存到项目」重试入口；重试不重新提交生成任务。
4. 第三方 Dola CDN 请求不带工作台 Token；远程兜底只显示安全 HTTPS URL。

### 4.4 UI 与文件名

**红灯：**

1. Dola 成功卡片在可本地化时仍长期显示「复制链接」「保存到项目」。
2. 视频下载依赖 Dola 的 `Content-Disposition` 或 URL 后缀。

**绿灯：**

1. 本地化完成后 Dola 卡片与图 3 中的其他视频卡片动作一致。
2. 文件名由现有 `buildMediaFilename()` 生成，始终带 `.mp4`，不使用上游的“下载”名称。
3. 远程失败卡片仍可复制链接，不显示本地文件专属动作。

## 5. 实施顺序

1. 先为适配器内容代理写红灯测试，再实现流式 `/content`。
2. 为 Dola Runtime 轮询补同源内容端点测试，并确认 NewAPI 能将该路径转发到 Dola 渠道。
3. 补 Web/Desktop 媒体落盘与历史任务重试测试，复用现有认证和文件写入函数。
4. 补创作面板状态/文件名契约测试；不新增第二套下载按钮。
5. 执行适配器单测、相关前端定向测试、`pnpm exec vue-tsc -b`、`git diff --check`。
6. 服务器重建 Dola 适配器后，使用真实 Dola 任务验收：生成成功、同源内容地址、项目 `.mp4`、预览、画布和文件夹入口。

## 6. 最小修改清单

| 文件 | 修改 |
| --- | --- |
| `dola-seedance-adapter/src/main.py` | 新增鉴权、状态查询和流式 `/v1/videos/{task_id}/content` |
| `dola-seedance-adapter/tests/test_main.py` | 内容代理、错误映射和不缓冲完整响应的回归 |
| `src/runtime/creation/creationMediaRuntime.ts` | 仅将 Dola 纳入视频内容端点轮询 |
| `src/stores/mediaTaskStore.ts` | 仅为 Dola 历史远程结果重试时重新轮询内容端点 |
| `src/api/__tests__/mediaGenerationModelGuard.test.ts` | Dola 内容端点与非 Dola 隔离测试 |
| `src/runtime/creation/__tests__/creationMediaRuntime.test.ts` | Dola 轮询结果合同 |
| `src/stores/__tests__/mediaTaskStore.test.ts` | 同源下载认证、落盘和重试合同 |
| `src/components/__tests__/creationPanelContractUi.test.ts` | 本地/远程卡片动作与 `.mp4` 文件名合同 |

不修改已确认的 Dola 上传数量和单张大小规则，不修改 NewAPI 价格、模型名或其他模型适配器；仅将 Dola 渠道 URL 从带 `:8789` 的容器地址切换为标准端口地址 `http://dola-seedance-adapter`，以满足 NewAPI 出站端口白名单。

## 7. 禁入边界

- 不把 Dola 第三方 CDN URL直接作为最终下载入口交给浏览器。
- 不在前端增加 Dola 专用 `fetch`、Blob 缓存、任务队列或永久 URL 存储。
- 不把工作台 Bearer Token 发往 Dola CDN；只发给韭菜盒子同源 `/content`，由适配器向上游鉴权。
- 不因下载失败把已成功扣费的生成任务标记为生成失败。
- 不自动重提交生成任务，不改现有轮询间隔、取消和计费语义。
- 不把“总图片 20 MiB”限制重新加回适配器或创作面板。

## 8. 真实验收与发布边界

自动测试通过不等于生产下载通过。生产验收必须记录以下脱敏事实：

1. Dola 4 张参考图任务成功，任务历史最终从远程 URL 变为项目 `.mp4` 路径。
2. 浏览器预览、放到画布、打开文件夹和另存为均使用本地文件，不再复制 Dola URL。
3. 适配器日志只记录任务 ID、状态、HTTP 状态和耗时，不记录 Token、提示词、参考图 URL或完整临时 URL。
4. 适配器重启后，对新任务和已有未过期任务的 `/content` 读取仍可用。

未完成上述服务器重建和真实任务验收前，本 TDD 状态保持“实现完成，待生产验收”，不能写成下载已通过。

## 9. 证据

- `dola-seedance-adapter/src/main.py`：当前 Dola 查询接口直接返回第三方 `task.url`，没有 `/content`。
- `xiaoyi-image-adapter/src/main.py`：已有同源 `/v1/videos/{task_id}/content` 流式代理实现，可作为本次最小复用模式。
- `src/runtime/creation/creationMediaRuntime.ts`：现有 Omni 内容端点轮询分支。
- `src/stores/mediaTaskStore.ts`：现有 Web/Desktop 媒体下载、项目落盘、失败重试和远程兜底。
- `src/utils/creationMediaCache.ts`：同源认证下载和按 MIME 生成媒体扩展名。
- 用户 2026-08-31 真实截图：Dola 成功但仍显示第三方 URL；其他已落盘视频显示项目 `.mp4` 和预览/画布/文件夹动作。
