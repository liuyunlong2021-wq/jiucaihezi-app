# webwenjianshangchuanxiufu 分支完工报告

> 写给 Codex 或任何接手的 AI 协作者
> 日期：2026-06-21（最后更新 00:45）
> 分支：`webwenjianshangchuanxiufu`（Web 上传资料修复）
> 仓库：`jiucaihezi-app-web-direct`
> 服务器：47.82.86.196 / Ubuntu 24.04 / 4 vCPU / 8GB / 70GB 根分区(约 42% 已用)

---

## 零、直白总结：这个分支干了什么

### 问题
用户上传文件后，AI 读不到。因为文件在浏览器里是 `blob:` 地址，发给云端的 AI 看不懂。

### 做了什么

**① 新写了一个服务器小服务（8091）**
- 13 个文件，放在 `attachment-processor/` 目录
- 接收用户上传的文件 → 识别类型 → 调用对应工具读文字 → 返回统一 Markdown
- .txt/.md 直接读；PDF 用 pdfplumber 抽文字；图片/扫描件用 PaddleOCR 识别；Word/Excel/PPT 调服务器已有的 8090 服务读
- 已用 Docker 部署到 `47.82.86.196`，监听 127.0.0.1:8091

**② 改了前端 4 个文件**
- `webChatAttachments.ts`（新增）：把文件上传到 8091，拿回解析结果
- `chatCloud.ts`：发消息时把解析后的文字注入 LLM 上下文
- `ChatPanel.vue`：上传文件时触发 8091 解析，非 vision 模型自动过滤图片
- `useChat.ts`：消息结构加了 `parsedAttachments` 字段

**③ 修了 Nginx 配置**
- 加了 `/api/attachments/` 路由，转发到 8091
- 透传用户的 Authorization 和 x-api-key

**④ 修了 3 轮审计发现的 bug**
- 鉴权、图片绕过 OCR、解析失败静默吞掉、Docker 网络、8090 真实 API 路径对齐、graphify 空壳等

### 当前状态
- 服务器 8091 跑着，health 正常 ✅
- 文本/PDF/Office 解析已测试通过 ✅
- PaddleOCR 已切到 `PP-OCRv6_small_det + PP-OCRv6_small_rec` ✅
- 图片上传端到端已跑通：Web 上传图片 → 8091 OCR → OCR 文本注入 DeepSeek → 模型回答 ✅
- 大图 OCR 会消耗 CPU，已做图片最长边 2000 缩放 + OCR 单队列；若仍触发 NewAPI CPU 保护，再降 `OMP_NUM_THREADS/MKL_NUM_THREADS` 或容器 CPU 配额
- 前端 dist 还没部署到 Web 静态站 ❌

### 给接手的 Codex
先看第九节（最新验收记录）和第十节（剩余任务）。不要回退到 PP-StructureV3 作为图片默认解析器。

---

## 一、这个分支做了什么

### 问题

Web 端用户上传 PDF、图片、Office 文件后，AI 完全读不到内容。

根因：浏览器里的文件是 `blob:` 地址 / `data:` URL / `jc-media://` 内部引用。这些对前端有意义，但对云端 AI 无意义——NewAPI 收到的是乱码引用，不是可读文字。

之前代码在 `ChatPanel.vue` 的收集循环里，PDF/Office 文件因为调 `convertDocumentToMarkdown()` 在非 Tauri 环境直接返回 `TAURI_REQUIRED` 错误，`textContent` 为空 → 被**静默丢弃**，用户完全不知道文件没进去。

### 方案

建一条「文件→文字→AI」的管道：

```
用户上传文件
  → 8091 attachment-processor（新服务）解析文件
  → 统一输出 AttachmentDocument（Markdown + warnings）
  → Web 前端注入 LLM 上下文（边界标记包裹）
  → AI 基于解析后的文字回答
```

---

## 二、完成清单

### 2.1 新增：8091 attachment-processor 服务

位置：`attachment-processor/`（13 个文件）

| 文件 | 作用 |
|------|------|
| `app/main.py` | FastAPI 入口，`POST /api/attachments/parse` + `/health` |
| `app/schemas.py` | `AttachmentDocument` 统一合约 |
| `app/settings.py` | 配置：20MB 限制、120s 超时、20 页 PDF 上限 |
| `app/parsers/text_parser.py` | .txt/.md/.json/代码 直接读 |
| `app/parsers/pdf_parser.py` | pdfplumber 文本抽取 + 扫描页标记 |
| `app/parsers/paddle_parser.py` | 图片默认走 `PP-OCRv6 small`，先缩图再 OCR，单队列执行；`parse_image_structure()` 目前降级到 OCR |
| `app/parsers/office_client.py` | 调 8090 `/api/office/read` 读 Word/Excel/PPT |
| `app/parsers/graphify_client.py` | 空壳（服务器 graphify 模块未安装，health 不返回，不进入解析链） |
| `Dockerfile` | Python 3.11-slim + libgl1 等系统依赖 |
| `docker-compose.yml` | 127.0.0.1:8091，extra_hosts 访问宿主机 8090 |
| `deployment/nginx-attachments.conf` | Nginx 配置参考 |
| `.env.example` / `requirements.txt` | 配置模板和依赖 |

### 2.2 修改：Web 前端（4 个文件）

| 文件 | 改动 |
|------|------|
| `src/utils/webChatAttachments.ts` | **新增**。上传→8091 解析→格式化→注入 的完整适配层。`parseFilesOnServer()` 返回 `ParseFilesResult {documents, failures, total}`，调用 `buildHeaders()` 传 `Authorization` + `x-api-key` |
| `src/composables/chatCloud.ts` | `buildWebCloudMessages` 注入 parsedAttachments（边界标记包裹）；`buildWebCloudMessageContent` 按模型 vision 能力过滤 `blob:`/`data:`/`jc-media://` |
| `src/components/chat/ChatPanel.vue` | 核心改动：Web 端所有非文本文件（含图片）进 `serverParseFiles` 走 8091；解析失败追加 `[系统提示]` 到用户消息 |
| `src/composables/useChat.ts` | `ChatMessage` 和 `SendMessageOptions` 新增 `parsedAttachments` 字段 |

### 2.3 修复：3 轮审计问题

**P0 审计（Codex）**：
- P0-1 鉴权：移除 `AUTH_SHARED_SECRET`，改为 Nginx `X-Nginx-Proxy` + `Authorization` Bearer 双重校验
- P0-2 图片绕过 OCR：图片即使有 preview 也进 8091 OCR，非 vision 模型过滤 `data:`/`blob:` URL
- P0-3 失败静默：`parseFilesOnServer` 返回 failures，`ChatPanel` 追加 `[系统提示]` 到消息
- P0-4 Docker 地址：`host.docker.internal` + `extra_hosts: host-gateway`

**二次审计（DeepSeek）**：
- 补 1 Nginx 鉴权配置：写 `deployment/nginx-attachments.conf`，8091 加 `Authorization` Bearer 校验
- 补 2 `buildHeaders` 实际调用：`webChatAttachments.ts` 调 `buildHeaders()` + 删 `Content-Type`
- 补 3 `data:` URL 过滤：两处 URL 过滤都加了 `data:`

**8090 API 对齐**（服务器实测）：
- `GET /health` → `GET /api/health`，校验 `status == "ok"`
- `POST /api/office/convert` → `POST /api/office/read`，`paragraphs[]` 拼 Markdown
- Graphify：确认模块未安装，缩为空壳

### 2.4 部署到服务器

- 服务器：`47.82.86.196`（阿里云香港）
- Docker 构建 → `docker compose up -d` → healthy
- PaddleOCR 安装 → `paddleocr 3.7.0 + paddlepaddle 3.2.0`，模型使用 `PP-OCRv6_small_det + PP-OCRv6_small_rec`
- Nginx 配置插入 `/api/attachments/` location → `nginx -t` 通过 → `nginx -s reload`
- 公网验证：`curl https://api.jiucaihezi.studio/api/attachments/parse -H "Authorization: Bearer ..." -F "file=@test.txt"` → `ok: true, parser: text`
- 服务器磁盘：云盘 70GB 后已扩展 `/dev/vda3`，`df -hT /` 显示约 69GB 可用根分区

---

## 三、当前服务器状态

| 能力 | 状态 | 说明 |
|------|:--:|------|
| 文本 (txt/md/json/code) | ✅ | 本地直读，不走 8091 |
| PDF 文字层 | ✅ | pdfplumber 抽取 |
| OCR (`PP-OCRv6 small`) | ✅ | 图片文字识别，图片最长边压到 2000 |
| 版面解析 (PP-StructureV3) | 暂不启用 | 本分支不做复杂版面解析，避免重模型影响 Web 聊天稳定性 |
| Office (Word/Excel/PPT) | ✅ | 调 8090 `/api/office/read` |
| Graphify | ❌ | 服务器 graphify 模块未安装 |

8091 health 返回 parser（graphify 未安装不展示；health 可能仍展示 pp-structure-v3，但图片默认路由不使用它）：
```json
["text", "pdf-text", "pp-ocr-v6", "pp-structure-v3", "office-8090"]
```

---

## 四、部署架构

### 4.1 拓扑

```
公网: api.jiucaihezi.studio:443
  │
  ├─ Nginx /api/attachments/
  │     ├─ 透传 Authorization / x-api-key（不做 token 有效性验证）
  │     ├─ proxy_set_header X-Nginx-Proxy "true"（硬编码，外部无法伪造）
  │     └─ proxy_pass → 127.0.0.1:8091
  │
  ├─ 8091 attachment-processor (Docker)
  │     ├─ text_parser (.txt/.md/.json)
  │     ├─ pdf_parser (pdfplumber)
  │     ├─ paddle_parser (PP-OCRv6 small + resize + single queue)
  │     └─ office_client → 127.0.0.1:8090 (宿主机)
  │
  └─ 8090 Office/Graphify (宿主机 python3 uvicorn)
        └─ /api/office/read → paragraphs + tables
```

### 4.2 服务器实际生效的 Nginx /api/attachments/ 配置

```nginx
location /api/attachments/ {
    proxy_pass http://127.0.0.1:8091/api/attachments/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Nginx-Proxy "true";
    proxy_set_header Authorization $http_authorization;
    proxy_set_header x-api-key $http_x_api_key;
    client_max_body_size 20m;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
```

⚠️ 当前 Nginx **没有 `auth_request`**，只做**透传**。Token 有效性不在 Nginx 层校验。

---

## 五、验收方法

### 5.1 服务器侧

```bash
# 健康检查
curl -s http://127.0.0.1:8091/health -H "X-Nginx-Proxy: true"

# 文本上传
echo "测试" > /tmp/t.txt
curl -s -X POST http://127.0.0.1:8091/api/attachments/parse \
  -H "X-Nginx-Proxy: true" \
  -H "Authorization: Bearer sk-test-xxxx" \
  -F "file=@/tmp/t.txt"

# 公网路径
curl -s https://api.jiucaihezi.studio/api/attachments/parse \
  -H "Authorization: Bearer YOUR_REAL_KEY" \
  -F "file=@document.pdf"
```

### 5.2 Web 前端侧（已本地验证，待正式部署后复验）

1. 上传一张中文截图/印章图 → 发送 → AI 回复应引用 OCR 识别出的文字内容
2. 上传一份 .docx 文件 → 发送 → AI 应能总结文档内容
3. 上传一份 PDF → 发送 → AI 应能按页回答
4. 上传一个 .bin 文件 → 应提示「不支持的文件格式」
5. 8091 服务宕掉 → 用户消息末尾应有 `[系统提示：附件解析服务暂时不可用]`

已验证案例：
- 服务器 curl 图片测试：`OCR_SMALL_OK: pp-ocr-v6-small`
- Web 本地端到端：上传印章图后，DeepSeek 回复引用 OCR 结果「龙刘 / 印云 / 5101085845157」

产品边界：
- OCR 适合截图、票据、文档照片、印章、扫描件里的文字。
- OCR 不是视觉理解。生活照片问「画面里有什么」需要 vision 模型；非 vision 模型只能看到 OCR 文字。

---

## 六、尚未完成

### 6.1 前端 dist 部署到 Web 端

当前状态：Vite build 通过（`✓ built in 1.34s`），但 `dist/` 没有部署到 Web 静态资源服务器。

需要做：
```bash
cd /Users/by3/Documents/jiucaihezi-app-web-direct
pnpm exec vite build
# 将 dist/ 部署到 Web 端（Cloudflare Pages / Nginx 静态站）
```

### 6.2 Graphify 模块

服务器上 graphify Python 模块未安装。如需启用：
1. 在 8090 服务环境安装 graphify 模块
2. 恢复 `graphify_client.py` 中的 `extract_relationships()` 函数
3. 在 `main.py` `_route_parse` 中接入 Graphify 路由

### 6.3 Office 格式覆盖

已验证 `.docx` 可读。`.xlsx`、`.pptx` 格式的 8090 `read` 返回格式可能与 docx 不同（sheets vs paragraphs）。使用前应先实测。

### 6.4 磁盘空间

已处理：云盘 70GB 已扩展到根分区 `/dev/vda3`，当前约 42% 使用率。仍建议定期清理 Docker 旧镜像：`docker system prune -a`。

---

## 七、已知注意事项

### 7.1 鉴权模型（如实）

- 8091 **只监听 127.0.0.1**，公网无法直连
- Nginx 设置 `X-Nginx-Proxy: true`（硬编码，外部无法伪造）— 证明请求来自 Nginx
- Nginx **透传** `Authorization` 和 `x-api-key` 头，但**不做 token 有效性验证**
- 8091 检查：① `X-Nginx-Proxy` 存在 + ② `Authorization` 是格式正确的 Bearer token（长度 ≥ 20）
- ⚠️ **Token 是否真实有效（过期、签名、用户身份）当前未验证**。任何人拿一个像样的 Bearer token 就能调 parse 接口
- 前端通过 `buildHeaders(config)` 传 `Authorization` + `x-api-key`
- **生产加固建议**：Nginx 加 `auth_request` 指向 NewAPI 做真实 token 校验，或 8091 在解析前调 NewAPI `/v1/models` 验证 token

### 7.2 OCR 调用开销

- PaddleOCR 首次调用会下载/加载模型（约 10-30 秒），后续命中单例缓存
- 使用 `threading.Lock` 保护单例初始化，并用 `_parse_lock` 让 OCR 单队列执行
- 图片进入 OCR 前会按最长边 2000 缩放，避免 4032x3024 原图直接打满 CPU
- 单次 OCR 约 3-30 秒（取决于图片大小和复杂度）
- `asyncio.to_thread()` 避免阻塞事件循环
- `SYNC_PARSE_TIMEOUT_S=120` 硬超时

### 7.3 非 vision 模型图片处理

- 所有图片先走 8091 OCR → 产生 `parsedAttachments`
- vision 模型：OCR 文本是主要证据，图片 URL 作为辅助输入
- 非 vision 模型：全部 `image_url` 被剥离，只传 OCR 文本
- `blob:` / `data:` / `jc-media://` URL 在 `chatCloud.ts` 中统一过滤

### 7.4 服务重启

8091 和 8090 独立部署，互不影响：
```bash
# 8091 重启
cd /opt/jc-attachment-processor && docker compose restart

# 8090 不影响，照常运行
```

---

## 八、Codex 审查建议

请重点审查以下方面：

1. **鉴权闭环**：Nginx 是否对 `/api/attachments/` 做了与 `/v1/chat/completions` 同等的 session 校验？当前 8091 信任 `X-Nginx-Proxy` + `Authorization` Bearer，但如果 Nginx 层没做真正的 Bearer token 校验，就只是检查 token 格式而非有效性。
2. **前端 dist 部署**：Web 端静态资源更新后，`webChatAttachments.ts` 的改动才生效。当前服务器上跑的还是旧前端。
3. **磁盘预警**：86% 已用。PaddleOCR 模型 + Docker 镜像可能让磁盘逼近 90%+。
4. **日志系统**：8091 目前只用 Python logging 到 stderr，无持久化/轮转。建议后续接入。
5. **Office xlsx/pptx 实测**：目前只验证了 docx 的 read 返回。xlsx 和 pptx 的 `paragraphs[]` 字段可能存在差异。

---

## 九、最新验收记录（2026-06-21）

### 9.1 OCR 根因和修复

曾经失败的原因有两层：

1. `PP-StructureV3` 作为普通图片默认路径太重，且额外依赖复杂，不适合本分支。
2. PaddleOCR 3.x 返回 `numpy array`，旧解析代码用布尔判断导致 `The truth value of an array...`。

最终修复：

- 普通图片默认走 `parse_image_ocr()`，不走 `PP-StructureV3`。
- OCR 使用 PaddleOCR 3.x 官方 `predict()` API，读取 `rec_texts / rec_scores / rec_polys / rec_boxes`。
- 模型切换为 `PP-OCRv6_small_det + PP-OCRv6_small_rec`。
- OCR 前把图片最长边缩到 2000。
- OCR 单队列执行，避免多个 OCR 请求同时打满 CPU。

### 9.2 服务器验收

服务器 curl 验收通过：

```text
OCR_SMALL_OK: pp-ocr-v6-small Jiucaihezi OCRsmall model test 12345
```

真实 Web 上传验收通过：

```text
图片上传 → 8091 OCR → parsedAttachments 注入 → DeepSeek 回复 OCR 文字
```

印章图结果示例：

```text
龙刘
印云
5101085845157
```

### 9.3 CPU 和磁盘处理

- medium 模型曾导致大图 OCR 约 42 秒，并触发 NewAPI `system cpu overloaded`。
- small + 缩图后已可用，但 OCR 仍会短时占用 CPU。
- 服务器云盘已从 30GB 根分区扩到约 70GB 根分区：

```text
/dev/vda3 ext4 69G 28G 39G 42% /
```

### 9.4 前端 retry bug

已修复 `ChatPanel.vue` 中 `focusComposer is not defined`：

```ts
focusComposer() -> focusComposerInput()
```

这个 bug 不影响 OCR 主链路，但会影响 Web 端重试带附件消息的体验。

## 十、剩余任务

### 🔴 P0 — 部署前必须做

1. 本地代码已同步服务器热修后，跑 `pnpm exec vite build`。
2. 将 `dist/` 部署到 Web 静态站。
3. 部署后用正式域名复验：上传印章图/中文截图 → AI 回复引用 OCR 文字。

### 🟡 P1 — 服务器巩固

1. 用当前 `Dockerfile + requirements.txt` 做一次 `docker compose build` 验证可重建。
2. 如 OCR 后仍偶发 NewAPI 503，将 `OMP_NUM_THREADS/MKL_NUM_THREADS` 从 2 降到 1，或给 8091 容器加 CPU 配额。
3. 定期清理 Docker 旧镜像和 PaddleOCR 旧模型缓存。

### 🟢 P2 — 后续产品增强

1. 对纯生活照片给更明确提示：OCR 只能读文字，不能理解画面。
2. 后续如果要“看图内容”，需要接 vision 模型，不属于本分支。
3. PP-StructureV3 / PaddleOCR-VL 暂不纳入本分支。

### ⚫ 已知不修

- Graphify：服务器模块未安装，health 已不返回
- `supportsVision` 对 deepseek/qwen/kimi 等返回 false（端点暂未配 vision），符合预期
- Nginx 鉴权：当前只透传不校验，后续应用 `auth_request`
