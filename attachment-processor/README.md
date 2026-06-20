# Attachment Processor

Web 上传资料解析服务。接收文件上传，路由到合适的解析器（文本/PDF/OCR/Office/Graphify），返回统一的 `AttachmentDocument`。

## Quick Start

```bash
# 安装依赖
pip install -r requirements.txt

# 运行（开发模式）
python -m uvicorn app.main:app --host 0.0.0.0 --port 8091 --reload

# Docker
docker compose up -d
```

## API

### POST /api/attachments/parse

上传文件并解析。

```
curl -X POST http://localhost:8091/api/attachments/parse \
  -F "file=@document.pdf" \
  -F "mode=auto"
```

Response: `ParseResponse { ok, document: AttachmentDocument }`

### GET /health

健康检查。

## 架构

```
Web 上传 → Nginx /api/attachments/ → 8091 attachment-processor
  ├─ .txt/.md/.json → text_parser (直读)
  ├─ .png/.jpg → paddle_parser (OCR)
  ├─ .pdf → pdf_parser (文本抽取, 扫描页标记)
  ├─ .docx/.xlsx/.pptx → office_client (调 8090)
  └─ 其他 → unsupported error
```

## 环境变量

见 `app/settings.py` 和 `.env.example`。

## 部署

服务器路径: `/opt/jc-attachment-processor`

Nginx 配置见 SDD 文档 §12。
