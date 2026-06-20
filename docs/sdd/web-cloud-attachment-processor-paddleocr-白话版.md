# Web 上传资料与 LLM 配合方案白话版

> 日期：2026-06-20
> 分支：`webwenjianshangchuanxiufu`
> 对应技术版：`docs/sdd/web-cloud-attachment-processor-paddleocr-sdd.md`
> 状态：只写方案，还没有开始写代码

## 1. 这次分支的目标是什么

这次分支只解决一个问题：**Web 用户上传资料后，大模型要能真正读到资料内容，并根据资料回答。**

现在 Web 对话很轻。用户发文字，前端把文字发给 NewAPI，大模型流式回复。问题出在上传资料：浏览器拿到的是文件对象、预览地址，或者我们自己的内部引用，比如：

```text
jc-doc://...
jc-media://...
blob:...
```

这些引用对前端有意义，但对云端大模型没有意义。大模型不能靠 `jc-doc://...` 读懂文件，也不能把 `blob:` 当成真实图片内容。

所以这次要做的是：

```text
用户上传资料
  -> 服务器先把资料解析成 Markdown / blocks / warnings
  -> Web 对话把解析后的资料放进 LLM 上下文
  -> 大模型根据资料回答
```

一句话：**上传资料先变成大模型能读的文字证据，再进入对话。**

## 2. 这份方案不是做什么

这不是万能文件平台，也不是云盘，也不是知识库。

这次不做：

```text
PaddleOCR-VL
自动知识库沉淀
永久文件管理
桌面 OpenCode 文/武链路
前端直接跑 OCR
让 NewAPI 聊天接口自己解析文件
```

特别说明：**PaddleOCR-VL 不装、不接、不作为本分支目标。**

PaddleOCR-VL 能力很强，确实可以单独做一个高价值文档解析 App。但这次分支目标更小：把 Web 上传资料和 LLM 对话打通。

## 3. 我们服务器现在有什么可用能力

根据运维手册，现在服务器是：

```text
服务器：47.82.86.196，阿里云香港
系统：Ubuntu 24.04
配置：4 vCPU / 8GB 内存 / 70GB 云盘
公网入口：Nginx 443
NewAPI：3000
Office / Graphify Python 服务：8090
RunningHub 适配器：8789
创作模型可用性服务：8790
```

其中最关键的是：**已经有一个 8090 Python 服务，里面有 Office / Graphify 能力。**

所以我们不要把所有东西重新做一遍，也不要把 OCR 塞进 8090。

正确理解是：

```text
8090 = 已有资料工具服务
  - Office 文件处理
  - Graphify 知识图谱相关能力

8091 = 新增 Web 附件解析入口
  - 接 Web 上传
  - 判断文件类型
  - 调用文本读取 / PDF 抽取 / PaddleOCR / 必要时调用 8090
  - 统一整理成 LLM 可用资料
```

## 4. 为什么要新增 8091，而不是直接改 8090

8090 已经承担 Office / Graphify。

OCR 会吃 CPU、内存和时间。如果直接塞进 8090，风险是：

- OCR 卡住时，Office / Graphify 也可能被拖慢。
- 以后排障时分不清是附件解析问题，还是原有 8090 服务问题。
- 重启 OCR 会影响已有能力。
- 这个分支本来是 Web 上传修复，不应该污染已有服务。

所以更好的方式是：

```text
新增 /opt/jc-attachment-processor
监听 127.0.0.1:8091
Nginx 暴露 /api/attachments/
```

这样 8091 是统一入口，8090 是可调用的工具。

## 5. 最终链路长什么样

推荐链路：

```text
Web 用户上传资料
  ↓
Nginx /api/attachments/parse
  ↓
8091 attachment-processor
  ↓
按文件类型分流：
  - 文本：直接读
  - 图片：PaddleOCR PP-OCRv6 / PP-StructureV3
  - PDF：先抽文字，扫描页再 OCR
  - 需要 Office/Graphify 能力：内部调用 8090
  ↓
统一输出 AttachmentDocument
  ↓
Web 对话把 Markdown 注入 LLM 上下文
  ↓
LLM 根据资料回答
```

用户看到的是：

```text
上传资料 -> 解析中 -> 已解析 -> 提问 -> 模型按资料回答
```

用户不需要知道背后用了 OCR、PDF 抽取，还是 8090。

## 6. 每个服务分别负责什么

### 6.1 Web 前端

Web 前端只负责用户体验：

- 选择文件。
- 拖拽文件。
- 显示文件名和大小。
- 显示解析状态。
- 提示错误。
- 发送消息时带上解析后的资料 ID / Markdown。

Web 前端不负责真正解析文件。

### 6.2 8091 attachment-processor

这是本分支新增的核心服务。

它负责：

- 校验登录。
- 限制文件大小。
- 判断文件类型。
- 保存临时文件。
- 决定走哪条解析路线。
- 调 PaddleOCR。
- 必要时调用 8090。
- 统一整理成 Markdown / blocks / warnings。
- 清理过期文件。

它是“资料解析调度员”。

### 6.3 PaddleOCR 仓库

PaddleOCR 仓库不是要复制进前端，也不是要做成聊天模型。

它的作用是提供 OCR / 文档版面解析能力。

这次只用：

```text
PP-OCRv6
  -> 普通图片文字识别

PP-StructureV3
  -> 文档截图、扫描 PDF、表格截图的版面解析
```

不装：

```text
PaddleOCR-VL
其他与本分支无关的 pipeline
```

### 6.4 8090 Office / Graphify

8090 已经是服务器上的 Python 服务。

在这次方案里，它不是入口，而是辅助工具。

它可以帮助：

- Office 类资料如果已有转换能力，可以由 8091 调用 8090 转成文本或 PDF，再统一整理。
- Graphify 如果已有图谱构建/查询能力，可以作为后续“结构关系提取”的辅助，但不是上传解析主链路。

核心原则：**8091 统一对外，8090 只在内网被 8091 调用。**

### 6.5 NewAPI / LLM

NewAPI 和 LLM 不负责解析原始文件。

它们只接收解析后的资料：

```text
用户问题
+ 已解析 Markdown
+ warnings
+ 资料边界标记
```

这样模型才能稳定回答，也不会把文件引用误当成图片 URL。

## 7. OCR / Office / Graphify 搞好后，用户能得到什么能力

这次不是为了“装一个 OCR”而装 OCR。

真正的产品力是：**用户把资料丢进 Web 对话，大模型不再只会看用户打的字，而是能看懂用户上传的资料。**

换成大白话，就是：

```text
OCR 负责把看不见的图中文字读出来
Office 负责把 Office 文件变成可读资料
Graphify 负责把资料里的关系、人物、公司、事件、时间线拎出来
8091 负责把这些能力调度好，整理成 LLM 能吃的上下文
LLM 负责基于这些资料回答、总结、分析、改写
```

### 7.1 OCR 给用户带来的能力

OCR 解决的是：**资料明明在图片里、扫描件里、截图里，但普通文本模型读不到。**

做好以后，用户可以：

- 上传截图，让模型读截图里的文字。
- 上传手机拍的纸质文件，让模型提取里面的内容。
- 上传扫描 PDF，让模型按页读出文字。
- 上传表格截图，让模型尽量还原表格内容。
- 上传合同、票据、说明书、公告截图，让模型总结、找风险、提重点。
- 上传多页扫描资料，让模型知道每段内容大概来自第几页。

这次 OCR 主要用两种能力：

```text
PP-OCRv6
  -> 适合普通图片、截图、照片里的文字识别。

PP-StructureV3
  -> 适合文档截图、扫描 PDF、表格、标题、段落、版面结构。
  -> 重点不是只读字，而是尽量保留“这是标题、这是表格、这是正文、这是第几页”。
```

用户感知到的结果不是“OCR 模型运行了”，而是：

```text
我传了一张图，AI 能按图里的文字回答。
我传了一份扫描件，AI 能按扫描件内容总结。
我传了一张表格截图，AI 能把表格里的信息拿来分析。
```

### 7.2 Office 给用户带来的能力

Office 解决的是：**用户上传 Word / Excel / PPT 这类文件时，LLM 不能直接稳定读取原始文件结构。**

8090 已经有 Office 能力，所以 8091 可以把 Office 类资料交给 8090 辅助处理，再统一整理给 LLM。

做好以后，用户可以：

- 上传 Word 文档，让模型总结、润色、改写、提取条款。
- 上传 Excel / CSV 表格，让模型看字段、看数据、做简单统计和异常点提示。
- 上传 PPT，让模型提炼每页主题、整理成汇报稿、提取大纲。
- 上传 Office 转出来的 PDF 或文本，让模型继续分析。

这里最重要的是：Office 服务不是直接面向用户暴露一堆按钮，而是藏在上传链路里。

用户体验应该是：

```text
我上传了一个 Word / Excel / PPT
系统自动把它变成大模型能读的 Markdown / 表格块 / 摘要块
然后我直接问：总结一下、帮我找问题、改成方案、提取数据
```

### 7.3 Graphify 给用户带来的能力

Graphify 解决的是：**资料多了以后，光有全文不够，还要看清楚里面的关系。**

它适合在“已经有文字内容”之后工作。也就是说，先由文本读取、PDF 抽取、OCR、Office 转换拿到内容，再让 Graphify 做结构关系辅助。

做好以后，用户可以：

- 让系统从资料里提取人物、公司、项目、产品、金额、地点、时间。
- 看出“谁和谁有关”“哪个公司参与了什么项目”“合同里有哪些主体”。
- 从多份资料里整理事件线，比如先发生什么、后发生什么。
- 在长资料里围绕一个主体追问，比如“这个公司在所有资料里出现了哪些风险”。
- 把散乱资料变成更适合 LLM 使用的结构化上下文。

用户感知到的结果是：

```text
我不是只能问单个文件的摘要。
我还能问：这些资料之间有什么关系？
谁和谁有关？
时间线是什么？
风险集中在哪些主体上？
```

### 7.4 三者合起来才是完整体验

单独看：

```text
OCR = 把图片/扫描件变成文字和版面
Office = 把 Word/Excel/PPT 变成可读文档
Graphify = 把文字里的实体和关系拎出来
```

合起来就是：

```text
用户上传资料
  -> 系统先读出来
  -> 再整理结构
  -> 必要时提取关系
  -> 最后交给 LLM 回答
```

所以这个分支完成后，Web 对话会从“只能聊用户输入的文字”，升级成：

```text
能围绕用户上传的真实资料聊天
能总结资料
能解释资料
能改写资料
能提取资料里的表格和条款
能基于多份资料做关系和时间线分析
```

但要注意，这次仍然不做大而全。

我们只做和 **Web 上传资料 + LLM 回答** 直接相关的能力，不把它扩成云盘或知识库平台，也不装 PaddleOCR-VL。

## 8. 按用户场景怎么安排

| 用户上传 | 用户想要 | 8091 怎么处理 | 用到什么能力 | 给 LLM 什么 |
| --- | --- | --- | --- | --- |
| `.txt/.md/.csv/.json/代码` | 让模型总结/解释/改写 | 直接读文本 | 文本直读 | Markdown |
| 普通图片/截图 | 读图片里的文字 | OCR | PP-OCRv6 | OCR Markdown |
| 文档截图/表格截图 | 按文档结构读 | 版面解析 | PP-StructureV3 | Markdown + blocks |
| 有文字层 PDF | 总结 PDF | 先抽文字 | PDF 文本抽取 | 分页 Markdown |
| 扫描 PDF | 读扫描件 | 每页转图片再 OCR | PP-StructureV3 | 分页 Markdown + warnings |
| 需要已有 Office 能力的资料 | 转成可读文本 | 8091 内部调 8090 | Office 服务 | Markdown |
| 需要结构关系辅助 | 提取实体/关系 | 8091 内部调 8090 | Graphify 服务 | 图谱结果摘要/结构化补充 |

这张表的重点是：**用户不选模型，系统按文件形态自动走最便宜、最稳的路线。**

## 9. 解析结果统一长什么样

无论内部走文本、OCR、PDF、Office，最后都统一成 `AttachmentDocument`。

示例：

```json
{
  "id": "att_xxx",
  "sourceName": "合同扫描件.pdf",
  "mimeType": "application/pdf",
  "parser": "pp-structure-v3",
  "status": "partial",
  "markdown": "# 合同\n\n甲方：...",
  "blocks": [
    {
      "id": "b1",
      "type": "paragraph",
      "page": 1,
      "markdown": "甲方：...",
      "confidence": 0.92
    }
  ],
  "warnings": [
    {
      "code": "low_confidence_table",
      "message": "第 4 页表格结构置信度较低",
      "page": 4
    }
  ],
  "usage": {
    "pageCount": 12,
    "elapsedMs": 8300,
    "tokenEstimate": 6200
  },
  "expiresAt": "2026-06-27T00:00:00Z"
}
```

为什么要统一：

- 前端不用关心内部用了哪个工具。
- LLM 注入逻辑稳定。
- 错误提示稳定。
- 以后排查问题能看出是哪个 parser 出错。

## 10. LLM 最后应该看到什么

LLM 不应该看到原始文件，也不应该看到 `jc-doc://`、`blob:`。

它应该看到这样的内容：

```text
[用户上传资料开始]
文件名：合同扫描件.pdf
解析器：pp-structure-v3
状态：partial
警告：
- 第 4 页表格结构置信度较低

<document_markdown>
# 合同

甲方：...
乙方：...

## 付款条款
...
</document_markdown>
[用户上传资料结束]

用户问题：
请帮我总结风险点
```

这样做的作用：

- 模型知道这是用户资料。
- 模型知道资料边界。
- 模型知道哪些地方可能不准。
- 用户资料不会覆盖系统提示词。
- 回答更稳定。

## 11. 服务器上怎么放

建议新增目录：

```text
/opt/jc-attachment-processor/
  app/
    main.py
    parsers/
      text_parser.py
      pdf_parser.py
      paddle_parser.py
      office_client.py
      graphify_client.py
    schemas.py
    settings.py
  storage/
    uploads/
    parsed/
  models/
  Dockerfile
  docker-compose.yml
  PP-StructureV3.yaml
```

各文件作用：

- `main.py`：FastAPI 入口。
- `text_parser.py`：文本直读。
- `pdf_parser.py`：PDF 文字层抽取和扫描页判断。
- `paddle_parser.py`：调用 PaddleOCR / PaddleX。
- `office_client.py`：内部调用 8090 Office 能力。
- `graphify_client.py`：内部调用 8090 Graphify 能力。
- `schemas.py`：统一返回结构。
- `settings.py`：文件大小、页数、超时、TTL 配置。
- `storage/`：临时文件。
- `models/`：PaddleOCR 模型缓存。

## 12. 服务器端口和 Nginx 怎么接

端口安排：

```text
3000  NewAPI
8090  Office / Graphify Python 服务，已有，不动
8091  attachment-processor，新建
8789  rh-adapter
8790  creation-models
```

Nginx 新增：

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

公网访问：

```text
https://api.jiucaihezi.studio/api/attachments/parse
```

内网转发：

```text
http://127.0.0.1:8091/api/attachments/parse
```

## 13. PaddleOCR 仓库怎么用

在服务器或本地开发机 clone：

```bash
git clone https://github.com/PaddlePaddle/PaddleOCR.git
cd PaddleOCR
```

用途：

1. 看官方 examples。
2. 跑 PP-OCRv6 和 PP-StructureV3 demo。
3. 确认输出 Markdown / JSON 长什么样。
4. 导出或参考 `PP-StructureV3.yaml`。
5. 把官方输出整理进我们的 `AttachmentDocument`。

不做：

```text
不把仓库复制进前端
不让浏览器 import PaddleOCR
不暴露 PaddleOCR serving 到公网
不安装 PaddleOCR-VL
```

## 14. 推荐部署方式

当前服务器 4 vCPU / 8GB，没有 GPU。建议先轻量跑。

第一版推荐：

```text
8091 FastAPI 单服务
  -> 直接 import PaddleOCR / PaddleX
  -> 文本、图片、小 PDF 先跑通
```

如果发现 OCR 慢，再拆成两个服务：

```text
8091 attachment-processor
  -> 负责鉴权、上传、调度、整理结果

内部 paddleocr-serving:8080
  -> 只负责 PP-StructureV3 推理
```

Docker Compose 形态：

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

## 15. 文件限制和性能策略

当前机器不是 GPU 机器，所以要控范围：

```text
单文件最大：20MB
PDF 默认最多解析：20 页
同步解析超时：60-120 秒
原始上传保存：24 小时
解析结果保存：7 天或随会话删除
```

解析策略：

1. 能直接读文本，就不 OCR。
2. PDF 有文字层，就先抽文字。
3. 只有扫描页、图片页，才走 OCR。
4. 普通图片先走 PP-OCRv6。
5. 文档截图、扫描 PDF、表格截图走 PP-StructureV3。
6. 解析失败时返回清楚错误，不把坏引用发给 LLM。

## 16. 安全边界

这个服务处理用户文件，必须谨慎：

- 上传必须鉴权。
- 文件大小必须限制。
- MIME 要嗅探，不能只信后缀。
- 临时文件按用户/任务隔离。
- 日志不能打印完整文件内容。
- 日志不能打印 OCR 全文。
- 日志不能打印 base64。
- 日志不能打印 token。
- PaddleOCR serving 不暴露公网。
- 8091 只通过 Nginx 暴露 `/api/attachments/`。
- 8091 调 8090 只走内网。

## 17. 最小验收标准

准备这些文件：

```text
demo.txt
demo.png
digital.pdf
scanned.pdf
unsupported.bin
```

验收：

- 文本文件能解析成 Markdown。
- 图片能 OCR，LLM 能根据图片文字回答。
- 有文字层 PDF 能抽文字，LLM 能总结。
- 扫描 PDF 能 OCR，LLM 能回答。
- 不支持格式有明确提示。
- `jc-doc://`、`jc-media://`、`blob:` 不再进入 NewAPI。
- 8090 原有 Office / Graphify 不受影响。
- 8091 出问题时，可以单独重启，不影响 8090。

## 18. 一句话总结

这次方案的核心不是“装一个 OCR”。

核心是做一条资料进入 LLM 的正确链路：

```text
Web 上传资料
  -> 8091 统一接收和调度
  -> PaddleOCR 解析视觉资料
  -> 8090 提供已有 Office / Graphify 辅助能力
  -> 统一输出 Markdown / blocks / warnings
  -> LLM 根据解析后的资料回答
```

做到这条链路，`webwenjianshangchuanxiufu` 分支目标就达成。
