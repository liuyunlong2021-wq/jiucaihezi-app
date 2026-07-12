# Web Attachment-to-LLM Processor SDD

> Date: 2026-06-20
> Branch: `webwenjianshangchuanxiufu`
> Status: Design draft, no implementation yet
> Scope: Web uploaded material parsing and LLM context integration

## 1. Goal

Web direct chat must support user-uploaded material without making the browser
heavy and without sending internal references such as `jc-doc://`,
`jc-media://`, `blob:`, or local paths to NewAPI.

The goal is to build a server-side material processing path:

```text
Web upload
  -> attachment-processor on :8091
  -> route to text/PDF/OCR/Office/Graphify helpers as needed
  -> normalized AttachmentDocument
  -> Web direct chat injects bounded Markdown evidence
  -> LLM answers using the uploaded material
```

This SDD is specifically about how Web uploads cooperate with LLM requests by
using:

- PaddleOCR / PaddleX for visual material parsing.
- Existing Office / Graphify Python service on `:8090` as internal helpers.
- A new `:8091` attachment processor as the only public product API surface for
  Web uploaded material.

## 2. Current Server Facts

From `docs/notes/我的服务器运维手册.md`:

```text
Server: 47.82.86.196, Aliyun Hong Kong
OS: Ubuntu 24.04
Machine: 4 vCPU / 8 GiB RAM / 70 GiB disk
Public entry: Nginx 443
NewAPI: :3000
Office / Graphify Python service: :8090
RunningHub adapter: :8789
creation-models service: :8790
```

Implications:

- Do not reuse `8090`; it already hosts Office / Graphify.
- Do not put PaddleOCR into the existing `8090` service.
- Do not modify NewAPI chat completions to parse files.
- Add a new internal service on `127.0.0.1:8091`.
- Expose only `/api/attachments/` through Nginx.
- CPU/RAM are limited, so the first implementation must prefer cheap parsing
  routes and strict limits.

## 3. Architecture

### 3.1 High-Level Flow

```text
Web FileUploader / ChatPanel
  -> POST https://api.jiucaihezi.studio/api/attachments/parse
  -> Nginx
  -> http://127.0.0.1:8091/api/attachments/parse
  -> attachment-processor
      -> text parser
      -> PDF text extraction
      -> PaddleOCR / PaddleX
      -> internal Office helper on :8090
      -> internal Graphify helper on :8090
  -> AttachmentDocument
  -> Web direct chat context injection
  -> NewAPI / LLM
```

### 3.2 Service Responsibilities

`8091 attachment-processor`:

- Auth boundary for Web upload parsing.
- File size/type/page validation.
- Temporary upload storage.
- Parser routing.
- Calls PaddleOCR / PaddleX when OCR/layout parsing is needed.
- Calls `8090` Office / Graphify only as internal helper services.
- Normalizes all parser outputs into `AttachmentDocument`.
- Deletes temporary artifacts by TTL.

`8090 Office / Graphify`:

- Remains an existing internal Python capability.
- Office side can provide document conversion when already available.
- Graphify side can provide structure/entity/relation assistance when a parsed
  document needs relationship-oriented support.
- It is not the public Web upload endpoint.

`PaddleOCR / PaddleX`:

- Provides OCR and document layout parsing.
- In this branch use only PP-OCRv6 and PP-StructureV3.
- Do not install or wire PaddleOCR-VL.

`NewAPI / LLM`:

- Receives only normalized text evidence.
- Does not parse raw files.
- Does not receive internal file references as image URLs.

## 4. Product Capability Model

The product value is not "install OCR". The value is turning uploaded material
into reliable LLM evidence.

The capability split should be:

```text
OCR
  -> reads text and layout from visual material

Office
  -> turns Word / Excel / PPT style files into document-like text, tables,
     and page/section summaries

Graphify
  -> extracts entities, relationships, and timelines after text already exists

8091 attachment-processor
  -> orchestrates all helpers and normalizes their outputs

LLM
  -> answers, summarizes, rewrites, and analyzes from normalized evidence
```

### 4.1 OCR Capability

OCR handles material that a normal text-only model cannot read directly:

- Screenshots.
- Photos of paper documents.
- Scanned PDFs.
- Table screenshots.
- Contracts, receipts, manuals, announcements, and other image-like documents.

Use PP-OCRv6 for simple image text recognition.

Use PP-StructureV3 when the material has document structure: page layout,
headings, paragraphs, tables, figures, captions, formulas, or page provenance.

User-facing outcome:

```text
The user uploads an image or scanned document.
The system extracts readable text/layout.
The LLM can answer from that extracted content.
```

### 4.2 Office Capability

Office handles files whose value is in document structure rather than raw bytes:

- Word documents: summary, rewrite, clause extraction, risk extraction.
- Excel / CSV-like tables: field understanding, simple analysis, anomaly hints.
- PPT decks: page/topic extraction, outline generation, speaker-note style
  summaries.
- Office-to-PDF/text conversion when that is the best available route.

In this branch, Office is an internal `8090` helper called by `8091`. It should
not become a separate public Web upload API.

User-facing outcome:

```text
The user uploads Word / Excel / PPT.
The system turns it into Markdown / table blocks / page summaries.
The user can ask the LLM to summarize, analyze, rewrite, or extract facts.
```

### 4.3 Graphify Capability

Graphify should run only after text exists. It is not a file parser and should
not be the first route for raw binary material.

Use it for relationship-oriented assistance:

- Extract people, companies, projects, products, money amounts, locations, and
  dates.
- Identify relationships between entities.
- Build a timeline across one or more parsed materials.
- Support questions such as "which company appears in the risk items" or "what
  happened first".
- Provide structured notes that help the LLM reason across long or messy
  material.

User-facing outcome:

```text
The user is not limited to a single-file summary.
They can ask about relationships, timelines, subjects, and cross-document risk.
```

### 4.4 Combined Product Experience

Combined flow:

```text
User uploads material
  -> read it
  -> preserve useful structure
  -> optionally extract relationships
  -> inject bounded evidence into LLM context
  -> LLM answers from the uploaded material
```

This branch should stay focused on Web uploaded material plus LLM cooperation.
Do not expand the scope into cloud drive, permanent knowledge-base ingestion,
or PaddleOCR-VL integration.

## 5. Supported Material Routes

The user should not choose an OCR model. The server chooses the cheapest stable
route from file shape.

| User upload | Processor action | Helper used | LLM receives |
| --- | --- | --- | --- |
| `.txt`, `.md`, `.csv`, `.json`, code-like files | Read text directly | none | Markdown |
| Normal image / screenshot | OCR text | PP-OCRv6 | OCR Markdown |
| Document screenshot / table screenshot | Layout-aware parse | PP-StructureV3 | Markdown + blocks |
| Digital PDF with text layer | Extract embedded text first | PDF text parser | Page-labeled Markdown |
| Scanned PDF / image-only pages | Render page image and parse | PP-StructureV3 | Page-labeled Markdown + warnings |
| Office material when `8090` conversion is already available | `8091` calls internal `8090`, then normalizes result | Office helper | Markdown |
| Relationship/structure assistance when needed | `8091` calls internal `8090` Graphify after text exists | Graphify helper | Structured summary / graph-derived notes |

Any unsupported type should return a clear unsupported-format error. The
processor must not fake a parsed document.

## 6. PaddleOCR Repository Usage

The PaddlePaddle/PaddleOCR repository should be treated as the upstream parsing
engine and reference implementation, not as frontend code.

Use it for:

- Official installation/version guidance.
- Example commands and outputs.
- PP-OCRv6 validation.
- PP-StructureV3 validation.
- PaddleX serving/API reference.
- Pipeline config such as `PP-StructureV3.yaml`.

Do not use it by:

- Vendoring it into the Vue app.
- Importing OCR code in browser code.
- Exposing PaddleOCR/PaddleX serving directly to public clients.
- Installing or wiring PaddleOCR-VL in this branch.

Recommended exploration flow:

```bash
git clone https://github.com/PaddlePaddle/PaddleOCR.git
cd PaddleOCR
```

Then validate:

```text
image OCR
PP-StructureV3 document parsing
PaddleX serving
Markdown / JSON output shape
```

## 7. AttachmentDocument Contract

All routes must return the same shape.

```ts
interface AttachmentDocument {
  id: string
  sourceName: string
  mimeType: string
  sizeBytes: number
  parser: 'text' | 'pdf-text' | 'pp-ocr-v6' | 'pp-structure-v3' | 'office-8090' | 'graphify-8090' | 'unsupported'
  status: 'success' | 'partial' | 'error'
  markdown: string
  blocks: AttachmentBlock[]
  warnings: AttachmentWarning[]
  usage: {
    pageCount?: number
    imageCount?: number
    tokenEstimate?: number
    elapsedMs: number
  }
  expiresAt: string
}

interface AttachmentBlock {
  id: string
  type: 'heading' | 'paragraph' | 'table' | 'formula' | 'figure' | 'caption' | 'list' | 'code' | 'metadata'
  text?: string
  markdown?: string
  page?: number
  bbox?: [number, number, number, number]
  confidence?: number
}

interface AttachmentWarning {
  code: string
  message: string
  page?: number
}
```

Contract rules:

- `markdown` is optimized for LLM context injection.
- `blocks` are for page/block provenance and parser warnings.
- `warnings` must be included in LLM context when relevant.
- Internal file references must never be passed downstream as model-visible
  image URLs.

## 8. LLM Context Injection

The LLM sees processed evidence, not raw files.

Recommended format:

```text
[用户上传资料开始]
文件名: contract_scan.pdf
解析器: pp-structure-v3
状态: partial
警告:
- 第 4 页表格结构置信度较低

<document_markdown>
# 合同
...
</document_markdown>
[用户上传资料结束]

用户问题:
请帮我总结风险点
```

Rules:

- Always wrap parsed user material in explicit boundaries.
- Include parser status and warnings.
- Cap injected Markdown by token budget.
- If material is too long, inject a bounded excerpt and tell the user the file
  exceeds current context budget.
- Parsed material must not override system, Skill, or developer instructions.

## 9. Deployment Shape

Recommended first deployment:

```text
/opt/jc-attachment-processor
  -> FastAPI
  -> listens on 127.0.0.1:8091
  -> internal calls to PaddleOCR/PaddleX
  -> internal calls to 8090 Office / Graphify
```

Directory:

```text
/opt/jc-attachment-processor/
  app/
    main.py
    schemas.py
    settings.py
    parsers/
      text_parser.py
      pdf_parser.py
      paddle_parser.py
      office_client.py
      graphify_client.py
  storage/
    uploads/
    parsed/
  models/
  Dockerfile
  docker-compose.yml
  PP-StructureV3.yaml
```

Docker Compose P0:

```yaml
services:
  attachment-processor:
    build: .
    ports:
      - "127.0.0.1:8091:8091"
    volumes:
      - ./storage:/app/storage
      - ./models:/root/.paddlex
    environment:
      - MAX_UPLOAD_MB=20
      - MAX_PDF_PAGES=20
      - OFFICE_GRAPHIFY_BASE_URL=http://127.0.0.1:8090
```

If PP-StructureV3 is too slow in-process, split PaddleX serving internally:

```text
attachment-processor :8091
  -> public product API and orchestration

paddleocr-serving :8080 internal only
  -> PP-StructureV3 inference
```

Do not expose `paddleocr-serving` publicly.

## 10. Nginx Route

External route:

```text
https://api.jiucaihezi.studio/api/attachments/parse
```

Internal route:

```text
http://127.0.0.1:8091/api/attachments/parse
```

Nginx shape:

```nginx
location /api/attachments/ {
    proxy_pass http://127.0.0.1:8091/api/attachments/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 20m;
    proxy_read_timeout 120s;
}
```

## 11. Limits and Runtime Policy

Server is CPU-limited, so use strict limits:

```text
Max upload: 20 MB
Max PDF pages by default: 20
Synchronous parse timeout: 60-120s
Raw upload TTL: 24h
Parsed result TTL: 7d or session deletion
```

Routing priority:

1. Direct text read.
2. PDF text layer extraction.
3. PP-OCRv6 for simple images.
4. PP-StructureV3 for scanned PDFs and layout-rich images.
5. `8090` Office helper only when conversion is already available and needed.
6. `8090` Graphify helper only after text exists and structure help is needed.

## 12. Security and Privacy

Requirements:

- Auth required for upload/parse/result retrieval.
- MIME sniffing; do not trust filename only.
- Temporary files isolated per user/task.
- No shell exposure to Web clients.
- No public permanent file URLs.
- Logs must not include raw file content, OCR full text, base64, tokens, or
  sensitive full filenames.
- Processor errors must be sanitized before returning to Web.
- PaddleOCR/PaddleX serving must be internal only.
- `8091` to `8090` calls must be internal only.

## 13. Frontend Integration Points

Expected Web-side changes after approval:

- `FileUploader.vue`: show parse states and unsupported-type errors.
- `ChatPanel.vue`: collect parsed attachment documents, not raw file refs.
- `chatCloud` / Web direct engine: inject parsed Markdown with boundaries.
- `sessionStore`: persist metadata/excerpts only, not raw bytes or base64.
- `webChatAttachments.ts`: upload/parse/result adapter.

Do not modify:

- `src-tauri/**`
- `src/opencodeClient/**`
- Desktop OpenCode 文/武 mode.

## 14. Acceptance Criteria

- Text upload parses to Markdown and LLM can answer from it.
- Image upload parses through OCR and LLM can answer from extracted content.
- Digital PDF extracts text and LLM can summarize it.
- Scanned PDF parses through PP-StructureV3 and returns warnings when needed.
- If `8090` helper is used, `8091` still returns the same `AttachmentDocument`.
- Unsupported types return clear errors.
- `jc-doc://`, `jc-media://`, `blob:`, local paths, and raw internal refs never
  enter NewAPI as model-visible URLs.
- `8090` Office / Graphify service remains independently restartable and is not
  polluted by OCR runtime.
- `8091` can be restarted without affecting `8090`.

## 15. Next Step After Approval

Do not implement directly from this SDD without a follow-up task plan.

Recommended next step:

1. Confirm `8091` service directory and Nginx route.
2. Inspect existing `8090` Office / Graphify API shape.
3. Define `AttachmentDocument` contract tests.
4. Build minimal `8091` processor for text/image/PDF.
5. Add optional internal clients for `8090` helpers.
6. Add Web upload adapter and LLM injection.
7. Verify no internal refs reach NewAPI.

## 16. References

- PaddleOCR GitHub README: describes PaddleOCR as converting PDFs/images into
  structured Markdown/JSON suitable for LLM applications.
- PP-StructureV3 documentation: documents the pipeline for document layout
  parsing and Markdown/JSON conversion.
- Server operations note: `docs/notes/我的服务器运维手册.md`.
