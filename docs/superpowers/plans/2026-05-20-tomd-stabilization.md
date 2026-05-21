# ToMD Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ToMD a stable, fast, local-first Markdown conversion ability that users can test independently before it is reused by knowledge-vault creation.

**Architecture:** ToMD becomes a single conversion pipeline shared by chat uploads, the ToMD 搭子, and later knowledge-vault ingestion. Local code handles file caching, format detection, PDF text-layer probing, MarkItDown/RapidOCR execution, progress, timeout, and output files; the LLM only explains the result and helps the user decide next actions. Knowledge-vault creation must consume ToMD outputs later instead of doing its own document conversion.

**Tech Stack:** Vue 3, Tauri command bridge, Rust backend commands, MarkItDown, RapidOCR, existing node test runner via esbuild + `node --test`, Cargo check, Vite build.

---

## Scope

This phase only fixes ToMD. It does not rebuild knowledge-vault creation.

ToMD v1 must support:

- Text-like files: `.md`, `.txt`, `.csv`, `.json`, code files.
- Office/PDF files through local MarkItDown.
- Scanned/image PDF through automatic OCR path with RapidOCR.
- Result display in chat with generated Markdown filename, engine, size, duration, and usable preview.
- Local output `.md` file path preserved for later “导入编辑区 / 保存到知识库 / 打开文件” work.

ToMD v1 must not:

- silently run OCR for many minutes without progress;
- store original PDF/Office files as base64 in long-lived app data;
- pretend conversion succeeded when extracted content is empty;
- depend on the old remote Office API.

## File Map

- Modify `src-tauri/src/lib.rs`
  - Improve `document_to_markdown_file`.
  - Add stable source hash, safer cache lookup, engine duration, and typed error codes.
  - Keep MarkItDown fast path and RapidOCR OCR path separate internally, with one user-facing conversion action.

- Modify `src/utils/documentMarkdown.ts`
  - Normalize the frontend conversion contract.
  - Add user-facing OCR state: `needs_ocr`, `ocr_running`, `timeout`, `empty_text`.
  - Return output path, duration, engine, preview, and truncation metadata.

- Create `src/utils/tomdPipeline.ts`
  - Own ToMD orchestration for selected files.
  - Expose stage progress: `读取文件`, `普通转换`, `需要OCR`, `OCR识别`, `生成Markdown`, `完成`.
  - Make auto-OCR policy explicit.

- Create `src/utils/__tests__/tomdPipeline.test.ts`
  - Test fast path, scanned-PDF error mapping, explicit OCR policy, and summary output.

- Modify `src/composables/useFileUpload.ts`
  - Route document uploads through `tomdPipeline`.
  - Preserve `markdownFilename`, `markdownEngine`, `markdownOutputPath`, `conversionStatus`, `conversionMessage`.

- Modify `src/components/chat/FileUploader.vue`
  - Show ToMD progress and status.
  - Do not freeze the input area while a long OCR task is running.
  - Display Chinese status text.

- Modify `src/utils/localContentTools.ts`
  - Make `document_to_markdown` return the real ToMD result from uploaded attachments.
  - Stop rebuilding Markdown only from already-extracted text when a real output file exists.

- Modify `src/stores/agentStore.ts`
  - Tighten ToMD 搭子 prompt: ToMD only converts files to Markdown and reports result; it does not create knowledge bases.

- Update tests:
  - `src/utils/__tests__/documentMarkdown.test.ts`
  - `src/utils/__tests__/localContentTools.test.ts`

## Acceptance Criteria

- Selecting the ToMD 搭子 must not cause app-wide卡顿 by itself.
- Uploading a normal text-layer PDF or Office file should finish through MarkItDown fast path and show a generated `.md`.
- Uploading a scanned PDF should not sit in `正在解析文件...` for 10 minutes. It should quickly say ordinary extraction found no text and offer/enter an explicit OCR stage with progress.
- A failed conversion must show a specific reason: missing tool, timeout, empty text, OCR failed, unsupported file.
- Re-uploading the same file should hit local cache by content hash, not by filename alone.
- ToMD results must be reusable by later knowledge-vault creation without reconverting.
- The old remote Office document-read path must not be used for ToMD.

---

## Task 1: Define the ToMD Result Contract

**Files:**
- Create: `src/utils/tomdPipeline.ts`
- Modify: `src/utils/documentMarkdown.ts`
- Test: `src/utils/__tests__/tomdPipeline.test.ts`

- [ ] Add a `ToMdStage` union in `tomdPipeline.ts`:

```ts
export type ToMdStage =
  | 'idle'
  | 'reading'
  | 'fast_convert'
  | 'needs_ocr'
  | 'ocr_convert'
  | 'complete'
  | 'error'
```

- [ ] Add a `ToMdFileResult` interface:

```ts
export interface ToMdFileResult {
  status: 'success' | 'needs_ocr' | 'error'
  source: string
  filename: string
  content: string
  preview: string
  engine: 'text' | 'markitdown' | 'rapidocr_chunked' | 'rapidocr_image' | 'attachment_text' | 'unsupported'
  sourcePath?: string
  outputPath?: string
  contentHash?: string
  durationMs?: number
  truncated: boolean
  message: string
  errorCode?: 'EMPTY_TEXT' | 'NEEDS_OCR' | 'TIMEOUT' | 'MISSING_TOOL' | 'UNSUPPORTED' | 'LOCAL_CONVERSION_FAILED'
}
```

- [ ] Write tests for status mapping:

```ts
test('maps empty scanned pdf conversion to needs_ocr', () => {
  const result = normalizeToMdError({
    status: 'error',
    source: 'scan.pdf',
    filename: 'scan.md',
    content: '',
    engine: 'markitdown',
    truncated: false,
    message: 'MarkItDown 没有提取到有效正文，可能是扫描版或图片型文档。',
    error: 'EMPTY_TEXT',
  })
  assert.equal(result.status, 'needs_ocr')
  assert.equal(result.errorCode, 'NEEDS_OCR')
})
```

- [ ] Run:

```bash
pnpm exec esbuild src/utils/__tests__/tomdPipeline.test.ts --bundle --platform=node --format=esm --outfile=/private/tmp/tomdPipeline.test.mjs
node --test /private/tmp/tomdPipeline.test.mjs
```

Expected first run before implementation: fails because `tomdPipeline.ts` does not exist.

## Task 2: Fix Backend Conversion Semantics

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] Add content-hash calculation after decoding uploaded bytes.

- [ ] Change cache lookup from filename-only to hash-first. Filename-only cache is unsafe because two different files can share the same name.

- [ ] Return typed metadata from `document_to_markdown_file`:

```json
{
  "status": "success",
  "engine": "markitdown",
  "contentHash": "...",
  "durationMs": 1234,
  "sourcePath": "...",
  "outputPath": "...",
  "message": "已使用 MarkItDown 转换为 Markdown。"
}
```

- [ ] Keep fast path and OCR path separate:
  - One automatic path: PDF probes local text layer first; text PDFs use MarkItDown, scanned PDFs/images use RapidOCR.

- [ ] Ensure command-level timeouts produce typed messages:
  - MarkItDown timeout: `TIMEOUT`
  - RapidOCR timeout: `TIMEOUT`
  - missing binary: `MISSING_TOOL`

- [ ] Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: completes without Rust errors.

## Task 3: Build the Frontend ToMD Pipeline

**Files:**
- Modify: `src/utils/tomdPipeline.ts`
- Modify: `src/utils/documentMarkdown.ts`
- Test: `src/utils/__tests__/tomdPipeline.test.ts`

- [ ] Implement `convertFileToMarkdownWithProgress(file, options)`.

- [ ] Default behavior:
  - Text files: convert immediately in frontend.
  - PDF/Office: run fast MarkItDown.
  - If fast path returns `NEEDS_OCR`, return `status: "needs_ocr"` quickly. Do not auto-run OCR by default.
  - No user-facing OCR mode; the backend chooses the stable path.

- [ ] Add progress callback:

```ts
onProgress?.({
  stage: 'fast_convert',
  progress: 35,
  message: `正在转换 ${file.name}`,
})
```

- [ ] Add tests:
  - normal text file returns `success`;
  - scanned PDF fast path returns `needs_ocr`;
  - conversion calls do not expose OCR engine flags;
  - timeout maps to `TIMEOUT`.

- [ ] Run:

```bash
pnpm exec esbuild src/utils/__tests__/tomdPipeline.test.ts --bundle --platform=node --format=esm --outfile=/private/tmp/tomdPipeline.test.mjs
node --test /private/tmp/tomdPipeline.test.mjs
```

Expected: PASS.

## Task 4: Route Chat Uploads Through ToMD

**Files:**
- Modify: `src/composables/useFileUpload.ts`
- Modify: `src/components/chat/FileUploader.vue`

- [ ] Replace direct `convertDocumentToMarkdown` orchestration with `convertFileToMarkdownWithProgress`.

- [ ] Store these fields on processed attachments:

```ts
markdownFilename?: string
markdownEngine?: string
markdownOutputPath?: string
markdownStatus?: 'success' | 'needs_ocr' | 'error'
markdownMessage?: string
conversionDurationMs?: number
```

- [ ] For `needs_ocr`, keep the attachment visible and selectable. Status text should be:

```text
普通转换未识别到文字，可使用 OCR 识别
```

- [ ] Add an OCR retry action in the uploader or attachment card. The action calls the same pipeline with `ocrMode: "force"`.

- [ ] Verify manually:
  - Select ToMD.
  - Upload `.txt`.
  - Upload normal PDF.
  - Upload scanned PDF.
  - UI remains responsive during conversion.

## Task 5: Make the ToMD Tool Use Real Conversion Results

**Files:**
- Modify: `src/utils/localContentTools.ts`
- Modify: `src/utils/__tests__/localContentTools.test.ts`

- [ ] Update `document_to_markdown` tool output to prefer real ToMD metadata:
  - `markdownFilename`
  - `markdownEngine`
  - `markdownOutputPath`
  - `conversionDurationMs`

- [ ] If no output path exists but extracted text exists, keep the attachment-text fallback.

- [ ] If attachment is `needs_ocr`, return JSON:

```json
{
  "status": "needs_ocr",
  "tool": "document_to_markdown",
  "message": "普通转换未识别到文字，可使用 OCR 识别。",
  "files": [...]
}
```

- [ ] Test:
  - output path is included for converted files;
  - attachment-text fallback still works;
  - needs-OCR status is not reported as success.

- [ ] Run:

```bash
pnpm exec esbuild src/utils/__tests__/localContentTools.test.ts --bundle --platform=node --format=esm --outfile=/private/tmp/localContentTools.test.mjs
node --test /private/tmp/localContentTools.test.mjs
```

Expected: PASS.

## Task 6: Tighten the ToMD 搭子 Behavior

**Files:**
- Modify: `src/stores/agentStore.ts`

- [ ] Update ToMD prompt rules:
  - ToMD only converts files to Markdown.
  - It should call `document_to_markdown` when files are present.
  - It should not claim knowledge-base creation.
  - It should explain OCR only when needed.
  - It should report filename, engine, status, and next possible action.

- [ ] Manual verification:
  - Selecting ToMD does not trigger a tool call until the user uploads or asks to convert.
  - After upload, asking “转成 MD” triggers `document_to_markdown`.

## Task 7: Full Verification and Local Test Build

**Files:**
- No new files unless verification exposes a focused bug.

- [ ] Run focused tests:

```bash
pnpm exec esbuild src/utils/__tests__/documentMarkdown.test.ts --bundle --platform=node --format=esm --outfile=/private/tmp/documentMarkdown.test.mjs
node --test /private/tmp/documentMarkdown.test.mjs
pnpm exec esbuild src/utils/__tests__/tomdPipeline.test.ts --bundle --platform=node --format=esm --outfile=/private/tmp/tomdPipeline.test.mjs
node --test /private/tmp/tomdPipeline.test.mjs
pnpm exec esbuild src/utils/__tests__/localContentTools.test.ts --bundle --platform=node --format=esm --outfile=/private/tmp/localContentTools.test.mjs
node --test /private/tmp/localContentTools.test.mjs
```

- [ ] Run backend check:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] Run frontend build:

```bash
pnpm build
```

- [ ] Run desktop app for manual testing:

```bash
pnpm tauri:dev
```

Manual test matrix:

| Case | Expected |
| --- | --- |
| Select ToMD only | no卡顿, no automatic tool call |
| Upload `.txt` | immediate Markdown success |
| Upload `.docx` | MarkItDown success with `.md` output |
| Upload normal text-layer PDF | MarkItDown success with `.md` output |
| Upload scanned PDF | fast `needs_ocr` status, no endless spinner |
| Click OCR retry | OCR stage shows progress, success or typed failure |
| Re-upload same file | cached result returns faster |

## Execution Order

1. Task 1: result contract and tests.
2. Task 2: backend hash/cache/error semantics.
3. Task 3: frontend ToMD pipeline.
4. Task 4: chat upload integration.
5. Task 5: tool-call integration.
6. Task 6: ToMD 搭子 prompt.
7. Task 7: verification and local manual test.

## Stop Conditions

Stop and report instead of continuing if:

- MarkItDown cannot be run from the bundled local Python runtime.
- RapidOCR cannot be run from the bundled local Python runtime.
- A normal text-layer PDF takes longer than 90 seconds on the local machine.
- Selecting ToMD still causes UI-wide卡顿 before any file is uploaded.
