# Web 上传资料 OCR

> **日期**: 2026-06-21

链路: `文件 → 8091 attachment-processor → PaddleOCR → Markdown → LLM 上下文`

- 图片 OCR: PP-OCRv6_small_det + PP-OCRv6_small_rec
- 图片预处理: 最长边压到 2000
- Office/PDF: 走 8090 `/api/office/read`，PDF 先走 pdfplumber

产品边界: OCR 能读文字，不能理解生活照片画面。

交接文档: `docs/handover/webwenjianshangchuanxiufu-completion-report.md`
