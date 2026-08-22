# 通用记忆工作台 AnyDoc 内置格式转换升级 TDD

> 日期：2026-08-22  
> 分支：`0822anydoc`  
> 状态：待实现，先测试后切换

## 1. 背景与根因

当前格式转换链路按平台分裂：

- Desktop 本地调用外部 MarkItDown，环境缺失或版本不同会导致失败和结果差异。
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

## 3. 非目标

- 不接入 Firecrawl hosted Parse。
- 不重新引入 OCR、虚假 OCR 进度、占位页或取消协议。
- 不把 AnyDoc WASM 直接加入 Web/Mobile 主包；离线需求未确认前继续使用云端。
- 不修改 NewAPI 主容器、认证合同或现有持久化格式。
- 不在第一阶段删除 MarkItDown 回退。

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

## 5. 分阶段实施

### 阶段 A：真实样本对照

建立脱敏样本集，至少覆盖中文 DOCX、复杂表格、PPT/PPTX、XLS/XLSX、旧 DOC/XLS、ODF、RTF、EPUB、CSV、文本型 PDF、损坏文件和加密文件。逐文件对比 AnyDoc 与现有 MarkItDown：标题、列表、表格、公式、链接、页序、乱码、嵌入资源、耗时和峰值内存。

只有在核心样本质量不低于现状、错误分类稳定、资源上限可控时，才进入阶段 B。AnyDoc 的公开 benchmark 不替代本项目真实样本验收。

### 阶段 B：Desktop 内置

- 在 `src-tauri` 固定 AnyDoc crate 版本、许可证和构建锁文件。
- 让现有 Tauri 命令内部调用 AnyDoc；命令名、输入和响应字段不变。
- 解析失败返回可诊断但脱敏的错误，并走现有云端回退。
- 对单文件大小、解析时长、内存和临时目录设置上限。
- 构建矩阵覆盖 macOS ARM、macOS Intel、Windows x64，并审计最终安装包确实包含 parser。

### 阶段 C：云端统一

保持 `/documents/markdown` API、认证、20 MB 限制、超时和错误脱敏不变；服务内部改用 AnyDoc Python binding 或独立 Rust helper。必须在 VPS/Docker 运行时单独验证，不以本地成功代替部署验证。

### 阶段 D：Web/Mobile（可选）

只有明确的离线或隐私需求才评估 AnyDoc WASM：放入 Worker，测量包体、内存、初始化时间、iOS/WebView 和低端设备表现。默认仍走云端，避免主包膨胀和主线程阻塞。

## 6. TDD 红灯测试与验收

### 自动化测试（先写失败测试）

- 每种声明支持的格式：成功结果、空文件、损坏文件、加密文件和不支持格式的错误合同。
- 内容检测优先于扩展名：错误扩展名但内容有效时按内容解析。
- 错误分类固定为 `unsupported`、`malformed`、`encrypted`、`resourceLimit`、`missingPart` 等有限集合。
- 中文 DOCX、PDF、PPTX、XLSX 快照：标题、段落、列表、表格和顺序稳定。
- 原件保存、Markdown 副本、项目相对路径和 SHA-256 去重回归测试。
- Desktop 命令响应字段兼容测试；云端 API 响应字段兼容测试。
- 扫描 PDF 必须给出“需要外部 OCR”提示，不得生成伪造文本或伪造进度。
- TypeScript 类型检查、Rust 测试、focused tests、跨平台构建和安装包内容审计。

### 人工验收

- Apple Silicon Mac、Intel Mac、Windows x64：离线转换成功，且本机无 Python/MarkItDown/LibreOffice 仍可用。
- AnyDoc 失败后自动云端回退；网络恢复后可重试。
- Web/Mobile 仍可上传并转换；不因 Desktop 内置 parser 改变行为。
- 真实 PowerPoint/WPS 打开导出结果，复杂表格和中文字体无明显破坏。
- 扫描 PDF 的提示准确、可操作且不声称已完成 OCR。

## 7. 平台结论

方案可以内置到产品，但“所有平台都离线可用”需要分开表述：

- Desktop：AnyDoc 随 Tauri 原生二进制编译，目标是 macOS ARM、macOS Intel、Windows x64 均可离线使用。
- Web/Mobile：第一阶段继续云端转换；不承诺离线 AnyDoc。未来若采用 WASM，必须 Worker 化并通过包体和设备验收。
- 当前尚未集成 AnyDoc，因此现版本仍可能依赖本机 MarkItDown 或联网云端回退。

## 8. 回滚与风险

保留 MarkItDown fallback。若 AnyDoc 失败率、中文样本质量、性能或跨平台构建不达标，则通过 feature flag/解析器选择切回 MarkItDown；不删除用户原件、Markdown 副本、项目文件，不改变 API 路径和持久化数据。

主要风险：AnyDoc 版本较新且公开 issue 仍涉及 PPT 页边界、嵌套表格、列表编号、嵌入图片、PDF 分页、加密 Office 和资源限制；扫描 PDF/OCR 明确不在其能力内；WASM 包体约 6.7 MB 且同步转换会阻塞主线程。

## 9. 完成定义

阶段 B 完成必须同时满足：真实样本对照通过、上述自动化测试全绿、三类 Desktop 构建产物审计通过、离线人工验收通过、AnyDoc 失败仍能云端回退。未满足前不得删除 MarkItDown fallback，也不得宣称“全平台离线转换”。
