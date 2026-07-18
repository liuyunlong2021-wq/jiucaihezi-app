# Web 文档转换服务 SDD

> 状态：代码已实现，待生产部署 · 2026-07-18

## 目标

让 Web 创模式能上传 `DOC/DOCX/PDF/XLS/XLSX/PPT/PPTX/ODT/ODS/ODP/RTF`。文件先转换为 Markdown，再沿用现有 `files: [{ name, content }]` 聊天链路送给模型。桌面端继续使用本机 MarkItDown，行为不变。

## 不做什么

- 不把原始二进制 Word 直接塞进 `/v1/chat/completions`；该协议当前只接受文字和图片。
- 不保存用户原文件、转换结果或聊天记录。
- 不修改 NewAPI 官方容器、Postgres、客服 Agent 或创作面板。

## 架构

```text
Web FileUploader
  -> POST /documents/markdown (multipart 文件 + 当前用户 Bearer Key)
  -> Nginx
  -> document-converter:8810
       -> GET NewAPI /v1/models 校验 Bearer Key（不计费）
       -> 临时目录写入文件
       -> MarkItDown 转 Markdown
       -> 删除临时目录
  <- { status, filename, content, engine, truncated, message }
  -> 既有 files[] -> Web 创模式 / 模型

Desktop FileUploader
  -> 原有 Tauri document_to_markdown_file
  -> 不变
```

`document-converter` 是无状态独立容器；它和后续客服记忆服务只共用 VPS、Docker、Nginx、部署流程，不共享代码、数据或数据库。

## 接口

`POST /documents/markdown`

- `Authorization: Bearer <当前 NewAPI Key>`
- `multipart/form-data`：`file`、可选 `max_chars`
- 文件限制：20 MB；仅上述办公/文档扩展名。
- 服务先将同一 Authorization 转发给内部配置的 `NEWAPI_VALIDATION_URL/v1/models`。非 2xx 返回 401；服务自身不保存或解析用户 Key。
- MarkItDown 最大运行 90 秒；失败返回安全错误消息，不泄露服务器路径。

成功响应：

```json
{
  "status": "success",
  "source": "方案.docx",
  "filename": "方案.md",
  "content": "# 方案\n\n正文……",
  "engine": "markitdown",
  "truncated": false,
  "message": "文档已转换为 Markdown。"
}
```

## 文件与部署

| 路径 | 责任 |
|---|---|
| `document-converter/` | FastAPI、MarkItDown 容器、单元测试 |
| `scripts/document-converter/` | 复制到 VPS、构建容器；备份主站 Nginx 配置后安装精确路由 |
| `src/utils/documentMarkdown.ts` | Web 调服务；桌面继续调用 Tauri |

发布不由普通 `git push` 自动完成。代码 push 后，在 VPS 以 root 运行仓库提供的部署脚本；它只新增/重建 `document-converter`，不触碰 `new-api`、Postgres、Redis、支付或 RH 服务。

服务器执行时，脚本会先复制服务到 `/opt/document-converter`，仅重建该容器；再备份 `/etc/nginx/sites-enabled/api.jiucaihezi.studio.conf` 至 `/etc/nginx/backups/`，插入唯一的 `/documents/markdown` 路由。`nginx -t` 失败会自动还原配置，成功才 reload。

```bash
ssh root@47.82.86.196
cd /opt/jiucai-repo
git status --short
git switch main
git pull --ff-only origin main
git sparse-checkout add document-converter scripts/document-converter
bash scripts/document-converter/deploy.sh
```

若服务器尚无 `/opt/jiucai-repo`，不能直接执行以上四行，须先按服务器实际的仓库位置完成 clone/sparse checkout；发布前先用 `pwd` 和 `git remote -v` 核对。

## 验收

1. Web `.docx` 不再得到 `TAURI_REQUIRED`，转换出的 Markdown 会作为附件文字进入创模式。
2. 无 Key、无效 Key、超限文件、非文档扩展名和转换超时均失败，且不会遗留文件。
3. 桌面端仍使用 Tauri 本地转换。
4. 容器只监听 `127.0.0.1:8810`，Nginx 才是公网入口。

## 本地验证记录

- Python 3.11 Docker 镜像已成功构建；服务 `/health` 返回正常，未带 Key 的 multipart 上传返回 `401`。
- 服务侧 3 条单测通过：允许扩展名、字符上限、错误路径脱敏。
- 前端文档转换契约测试通过，`vue-tsc -b`、Vite 生产构建和 focused 测试编译通过。
- 未改动生产服务器，因此尚未以真实用户 Key 验证 NewAPI 校验和真实 Word 成功转换；部署后须补做该验收。

## 执行计划

1. 先为 Web 转换分流、服务输入校验和临时文件清理写失败测试。
2. 实现最小 FastAPI + MarkItDown 容器及其 Nginx/部署材料。
3. 将 Web 分流接到既有 `convertDocumentToMarkdown()`，不改附件消息格式。
4. 跑前端类型/构建、服务单测、Docker 构建和差异审计；不在本次直接改生产服务器。
