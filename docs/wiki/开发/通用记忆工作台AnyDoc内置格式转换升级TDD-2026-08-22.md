# 通用记忆工作台 AnyDoc 内置格式转换升级 TDD

> 日期：2026-08-22  
> 分支：`0822anydoc`  
> 状态：阶段 B Desktop AnyDoc 已完成并通过用户验收；阶段 C/D 云端归一暂缓

## 1. 背景与根因

当前格式转换链路按平台分裂：

- 历史 Desktop 路径曾调用外部 MarkItDown，环境缺失或版本不同会导致失败和结果差异；现行 Desktop 已改为内置 AnyDoc。
- Web/Mobile 依赖云端 Python MarkItDown，离线不可用，三端解析能力不一致。
- 原件保存、SHA-256 去重、Markdown 可读副本和模型读取合同已经稳定，不应随解析器替换而改变。
- 虚假的 OCR 模式已删除。扫描 PDF 只能明确提示需要外部 OCR，不得伪造成功或进度。

AnyDoc（`firecrawl/anydoc`，审查版本 `v0.2.3`）适合作为统一解析内核：纯 Rust、内容识别优先于扩展名、输出 GitHub-Flavored Markdown，支持 Office、ODF、RTF、EPUB、CSV 和文本型 PDF；它不负责 OCR。

## 2. 目标

1. Desktop Tauri 二进制内置 AnyDoc Rust parser。
2. Apple Silicon、Intel Mac、Windows x64 安装包均可直接转换，不要求用户安装 Python、MarkItDown 或 LibreOffice。
3. 保持现有 `document_to_markdown_file` 命令、`/documents/markdown` API 及其 JSON 字段兼容。
4. 保留“原件 + Markdown 可读副本 + 项目相对路径 + SHA-256 去重”的数据合同。
5. AnyDoc 失败时继续云端回退，避免一次切换造成数据和可用性回归。
6. Markdown 到 DOCX/PDF/PPTX 的现有 artifact 导出链路保持不变。
7. 先交付可安装的 Desktop 测试包，让用户直接验证；用户确认通过后再评估云端 AnyDoc 迁移。

## 3. 非目标

- 不接入 Firecrawl hosted Parse。
- 不重新引入 OCR、虚假 OCR 进度、占位页或取消协议。
- 不把 AnyDoc WASM 直接加入 Web/Mobile 主包；离线需求未确认前继续使用云端。
- 不修改 NewAPI 主容器、认证合同或现有持久化格式。
- 不在本阶段删除云端 MarkItDown；云端归一另行验收。
- 不承诺 v1 将 Office/PDF 内嵌图片转换为模型可见图片；v1 保留原件，Markdown 至少保留正文、表格、链接和可用 alt 文本。

## 4. 设计逻辑

```text
外部文档
  -> 保留项目原件
  -> SHA-256 去重
  -> AnyDoc 解析
  -> 统一 Markdown 可读副本
  -> textContent / 项目文件读取
```

AnyDoc 只负责“文档导入解析”；现有 artifact 工具继续负责“Markdown 导出 Office/PDF/PPTX”。解析器替换不改变上层附件、路径、去重和模型合同。

### 4.1 不变量与版本化

- `document_to_markdown_file`、`document_path_to_markdown_file` 和 `/documents/markdown` 共享同一个 `parse_to_markdown` 语义；入口只负责字节读取、路径校验和结果落盘。
- 解析结果必须可记录 `source_sha256`、`converter_id`、`converter_version` 和 `output_schema_version`。`engine` 只用于诊断，不作为业务分支条件。
- 只有原件 hash、解析器版本和输出规范均匹配时才复用 Markdown 副本。用户编辑过的 Markdown 不得静默覆盖；需要重建时生成新副本或由用户明确确认。
- AnyDoc v1 的资源合同是“文本、标题、列表、表格、链接和 alt 文本”；嵌入图片文件的提取另行立项，不影响原件保存。

## 5. 分阶段实施

### 阶段 A：真实样本对照

建立脱敏样本集，至少覆盖中文 DOCX、复杂表格、PPT/PPTX、XLS/XLSX、旧 DOC/XLS、ODF、RTF、EPUB、CSV、文本型 PDF、损坏文件和加密文件。逐文件对比 AnyDoc 与现有 MarkItDown：标题、列表、表格、公式、链接、页序、乱码、嵌入资源、耗时和峰值内存。

只有在核心样本质量不低于现状、错误分类稳定、资源上限可控时，才进入阶段 B。AnyDoc 的公开 benchmark 不替代本项目真实样本验收。

### 阶段 B：Desktop AnyDoc 先行

- 在 `src-tauri` 固定 AnyDoc crate 版本、许可证和构建锁文件。
- 让两个现有 Tauri 命令共享 Rust `parse_to_markdown` 核心；命令名、输入和响应字段不变。
- 删除 Python 页数统计等 Desktop 成功路径依赖；PDF 页数和错误分类由 AnyDoc/统一 Rust 层处理。
- 对 Base64 输入、解码后文件、ZIP 解压膨胀、输出字节、解析时长和并发数设置上限；临时文件在成功、失败和超时后清理。
- `document_path_to_markdown_file` 只允许项目根目录或受信任的应用数据目录，必须 canonicalize 并拒绝越界路径。
- 解析放入 `spawn_blocking` 或独立 worker；需要硬超时和强制终止时使用独立 helper process。
- 构建矩阵覆盖 macOS ARM、macOS Intel、Windows x64，并审计最终安装包确实包含 parser。

阶段 B 是本 TDD 的第一交付目标。完成后必须生成可安装的 Desktop 测试包，用户可在真实 Mac/Windows 上直接测试：离线转换、中文 Office、复杂表格、PPT、文本型 PDF、损坏/加密文件和扫描 PDF 提示。阶段 B 未通过用户验收前，不切换云端生产解析器。

### 阶段 C：云端 AnyDoc staging

阶段 B 已通过用户验收；阶段 C 暂缓。恢复时使用同一 AnyDoc Rust core 构建云端 `document-converter` staging。保持 `/documents/markdown` API、认证、20 MB 限制、超时和错误脱敏不变；验证 Docker/VPS 运行时、资源隔离、真实文件输出和 Desktop/云端结果对照。不以本地成功代替部署验证，也不直接覆盖生产 MarkItDown。

### 阶段 D：云端生产归一

阶段 C staging 通过且得到单独发布授权后，再将生产 `/documents/markdown` 的解析内核切换到 AnyDoc。Web/Mobile 不改变操作；Desktop 仍优先本地 AnyDoc。生产切换期间保留 MarkItDown fallback，并准备按 parser 版本回滚。本阶段不部署、不切换生产云端。

### 阶段 E：Web/Mobile 离线（可选）

只有明确的离线或隐私需求才评估 AnyDoc WASM：放入 Worker，测量包体、内存、初始化时间、iOS/WebView 和低端设备表现。默认仍走云端，避免主包膨胀和主线程阻塞。

## 6. TDD 红灯测试与验收

### 自动化测试（先写失败测试）

- 每种声明支持的格式：成功结果、空文件、损坏文件、加密文件和不支持格式的错误合同。
- 内容检测优先于扩展名：错误扩展名但内容有效时按内容解析。
- 错误分类固定为 `unsupported`、`malformed`、`encrypted`、`resource_limit`、`missing_part`、`ocr_required`、`internal` 等有限集合；不得把所有失败都映射成同一个 `unsupported`。
- 中文 DOCX、PDF、PPTX、XLSX 快照：标题、段落、列表、表格和顺序稳定。
- 原件保存、Markdown 副本、项目相对路径和 SHA-256 去重回归测试。
- 解析元数据回归测试：相同原件和相同 parser 版本复用；parser 升级或原件 hash 变化不复用；用户编辑副本不被静默覆盖。
- Desktop 命令响应字段兼容测试；云端 API 响应字段兼容测试。
- 两个 Desktop 命令与云端入口的统一状态/错误映射测试。
- 输入大小、解压膨胀、输出大小、并发、超时、临时文件清理和路径越界测试。
- 扫描 PDF 必须给出“需要外部 OCR”提示，不得生成伪造文本或伪造进度。
- TypeScript 类型检查、Rust 测试、focused tests、跨平台构建和安装包内容审计。

### 人工验收

- Apple Silicon Mac、Intel Mac、Windows x64：离线转换成功，且本机无 Python/MarkItDown/LibreOffice 仍可用。
- AnyDoc 失败后自动云端回退；网络恢复后可重试。
- Web/Mobile 仍可上传并转换；不因 Desktop 内置 parser 改变行为。
- 真实 PowerPoint/WPS 打开导出结果，复杂表格和中文字体无明显破坏。
- 文档内嵌图片按 v1 合同验证：正文、表格、链接和 alt 文本可读；原件仍可打开查看图片。
- 扫描 PDF 的提示准确、可操作且不声称已完成 OCR。

### 6.1 本地失败与回退矩阵

| 本地结果 | 默认行为 |
| --- | --- |
| `success` | 使用本地 Markdown，不上传原件 |
| `internal` / parser unavailable | 可自动云端回退，并在诊断中记录原因 |
| `resource_limit` | 保留原件，提示用户，可由用户明确选择云端转换 |
| `unsupported` / `malformed` / `encrypted` | 不自动回退，提示对应处理方式 |
| `ocr_required` | 不自动回退，明确提示需要外部 OCR |
| 云端网络失败 | 保留原件和状态，允许用户稍后重试 |

默认云端回退只适用于解析器不可用或内部错误；上传前必须遵守现有登录、大小限制和隐私提示。

## 7. 平台结论

方案可以内置到产品，但“所有平台都离线可用”需要分开表述：

- Desktop：AnyDoc 随 Tauri 原生二进制编译，目标是 macOS ARM、macOS Intel、Windows x64 均可离线使用。
- Web/Mobile：第一阶段继续云端转换；不承诺离线 AnyDoc。未来若采用 WASM，必须 Worker 化并通过包体和设备验收。
- “Desktop 内置”验收必须同时证明：本机无 Python、MarkItDown、LibreOffice 时，成功样本仍可离线转换；否则只能称为实验集成。
- 当前 Desktop 已集成 AnyDoc 并已通过用户验收；Desktop 成功转换不依赖本机 Python、MarkItDown 或 LibreOffice。Web/Mobile 仍走现有云端 MarkItDown；桌面 AnyDoc 失败时仅按错误矩阵对内部错误尝试云端回退。

## 8. 回滚与风险

保留云端 MarkItDown fallback。若未来云端 AnyDoc staging 的失败率、中文样本质量、性能或跨平台运行不达标，则切回云端 MarkItDown；切换期间必须保留 parser 元数据，避免新旧 Markdown 静默混用。不删除用户原件、Markdown 副本、项目文件，不改变 API 路径和持久化数据。

主要风险：AnyDoc 版本较新且公开 issue 仍涉及 PPT 页边界、嵌套表格、列表编号、嵌入图片、PDF 分页、加密 Office 和资源限制；扫描 PDF/OCR 明确不在其能力内；WASM 包体约 6.7 MB 且同步转换会阻塞主线程。

## 9. 完成定义

阶段 B（Desktop 先行）已完成：自动化测试全绿、资源与路径边界测试通过、当前 macOS ARM 构建产物签名和 DMG 校验通过、可安装测试包交付、用户已验收 DOCX/XLSX/PPTX 与扫描 PDF 错误提示，失败矩阵符合预期。Intel Mac、Windows x64 和完整脱敏样本对照仍是后续跨平台门禁，不将其写成已通过。未完成阶段 C/D 前不得进入云端生产归一。

阶段 D（云端生产归一）完成必须同时满足：阶段 B 用户验收通过、阶段 C staging 通过、Desktop/云端同样本输出对照通过、云端真实运行时验收通过、生产回滚演练通过。当前阶段 C/D 暂缓；未满足前不得删除云端 MarkItDown fallback，也不得宣称“全平台离线转换”。

## 10. 当前实现与边界（2026-08-22）

- Desktop `document_to_markdown_file`、`document_path_to_markdown_file` 和源文件转 Markdown 共用 Rust AnyDoc `0.2.3`；结果记录 `sourceSha256`、转换器版本和输出规范版本。
- Desktop 成功路径不调用 MarkItDown。仓库中仍保留旧 Python/MarkItDown 解析辅助代码和兼容类型字段，供历史工具或云端合同兼容；它们不是当前 Desktop 文档转换的执行引擎。
- Web/Mobile 继续调用现有 `/documents/markdown` 云端接口，当前云端解析器仍是 MarkItDown。云端 AnyDoc 部署、staging 和生产切换全部暂缓。
- 用户操作没有变化：上传文档后自动转换并进入对话；转换成功继续读取，扫描版/图片型 PDF 明确提示需要 OCR，原件保留。
- 本轮交付包：`src-tauri/target/release/bundle/dmg/韭菜盒子_2.1.33_aarch64.dmg`；`hdiutil verify` 通过，SHA-256 为 `4c58ea80196c74b069e173053c5bcab9996f6be10668d2a55d81b5614bb0e57a`。
