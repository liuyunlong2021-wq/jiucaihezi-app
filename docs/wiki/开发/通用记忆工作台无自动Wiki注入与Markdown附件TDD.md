# 通用记忆工作台无自动 Wiki 注入与 Markdown 附件 TDD

> 日期：2026-08-05
> 状态：已实施
> 范围：不迁移、不删除、不覆盖用户已有文件；附件实现保持不变。

## 固定合同

- 记忆模式初始上下文只来自当前对话。
- App 不固定读取或注入根部 `CLAUDE.md`、Wiki 内 `CLAUDE.md`、`hot.md` 或其他 Wiki 页面。
- 模型只在当前任务需要时通过候选工具查询或读取 Wiki。
- 新建通用记忆空间不创建 README、CLAUDE 或业务模板。
- DOCX、PDF、XLSX、PPTX 保存原件并生成 Markdown 可读副本；请求发送 Markdown，原件不被替换。
- 图片、视频、音频继续使用现有原生媒体合同。

## 测试

1. `creativeMemory` 不包含 Wiki 文件读取、项目记忆参数或系统提示拼接。
2. generic scaffold 只创建 `index.md`、`hot.md`、`log.md` 和 `来源索引.md`。
3. Office/PDF/XLSX/PPTX 上传后保留原件和 Markdown 可读副本。
4. Markdown 转换或发送失败时原件仍可重新处理。
5. 项目文件引用与直接上传使用同一 Markdown 文档合同。

## 延后

原生 Office/PDF 主链路、NewAPI 文件句柄、能力矩阵、大文件索引、结构化抽取和 RAG 均等待真实使用数据，不在本轮建设。
