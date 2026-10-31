# ComfyUI 官方 MCP 统一接入与自研链路退役 TDD

> 日期：2026-10-21。状态：用户要求继续后，桌面源码已接入官方 MCP，旧桌面 HTTP 执行器与设置已退役；开发版已启动。自动验证见 §10。HTTPS/路径前缀/Bearer 仍为上游能力缺口，全量无损迁移、真实生成、跨平台和发布验收未完成。
> 用户决定：必须使用官方 ComfyUI MCP，废除重复造轮子的自研 ComfyUI 链路；本轮交付 TDD。
> 执行合同：桌面 ComfyUI 统一通过 Comfy-Org/comfy-mcp；不保留旧 HTTP 执行器作为兼容回退。退役实现，保留现有桌面能力、项目与任务数据。

## 1. 目标、根因与完成定义

目前「模型与服务 → 工作流服务」保存 ComfyUI 地址与两类凭据，创作执行器自行调用原生 API，输入框的现有 @MCP 则只认识已连接的 MCP 服务。两套接入造成配置与对话能力脱节。根因是产品自行维护了一条 ComfyUI 协议和执行生命周期，而不只是少了一个按钮。

最终用户路径：**设置 → MCP → ComfyUI（官方）→ 连接；输入框 @MCP → ComfyUI；创作面板使用同一个官方连接。** 不新增第二个 @mcp 命令或专属对话执行器。

完成必须同时满足：

1. 对话与创作面板的新 ComfyUI 任务，上传、提交、状态、取消与结果获取全部经官方 MCP/CLI，App 无直接 ComfyUI HTTP 请求。
2. 删除旧设置卡、自研探测、HTTP 上传、执行轮询与对应注册/权限；无旧实现回退、双写或双路提交。
3. 现有工作流、参数、参考素材、结果落盘、历史预览和进行中任务得到迁移与行为验收；不能用删型号、隐藏按钮或标记不支持代替迁移。
4. macOS ARM、Intel Mac、Windows 分别登记真实结果；未执行不能写通过。

## 2. 官方依据与版本闸门

官方来源（2026-10-21 只读核查）：

- [官方入口](https://comfy.org/mcp/)
- [Comfy-Org/comfy-mcp：安装、客户端配置、工具与限制](https://github.com/Comfy-Org/comfy-mcp)
- [官方包声明](https://github.com/Comfy-Org/comfy-mcp/blob/main/server.json)
- [comfy-cli](https://github.com/Comfy-Org/comfy-cli)

本机官方 MCP 是 stdio 子进程，依赖独立安装的 comfy-cli。ComfyUI 的 8188 HTTP 地址是后端目标地址，不是 MCP URL。Comfy Cloud 是另一项远程服务，本期不引入，不自动把本地任务转云端。

**G0 必须落盘精确版本证据**：记录 comfy-mcp、comfy-cli 的实际版本、源码 commit、Python 要求、安装命令、tools/list 与输入/输出 schema 快照。README main 会变化，不能拿它当发布 pin；本设计不凭搜索缓存预填版本。实现与测试以 G0 固定版本为准，禁止运行时追随 latest。

最小工具闭环以该版本实际 schema 确认 server_info、run_workflow、job、fetch_outputs、upload_file；这里的名称是核查线索，不授权实现者臆造参数。固定版本若存在能力缺口，优先升级到已验证的官方版本或向上游修复；不得加回自研 HTTP 旁路，也不得声称全量迁移完成。

## 3. 现状清单与退役范围

| 现有位置 | 根因/用途 | 最终处置 |
| --- | --- | --- |
| src/components/memory/MemorySettings.vue | 独立工作流服务设置、探测、凭据入口 | 删除旧卡与状态逻辑，入口归入 MCP；迁移提示定位新卡 |
| src/utils/comfyUiRuntime.ts | 地址、服务 Bearer、上游模型 Key、原生探测 | 删除运行链；仅迁移期间保留必要读源，迁移完成后退出启动路径 |
| src/runtime/creation/creationMediaRuntime.ts | executeLocalComfyRequest、executeLocalComfyGrokVideoRequest、uploadComfyImage、工作流构建及结果解析 | 执行全部改用现有 MCP client；删除直连、手写轮询与专用上传；业务工作流迁为可检查的 JSON 资产 |
| src/runtime/creation/creationMediaPlan.ts、creationMediaTypes.ts、creationModelRegistry.ts | local-comfy 路由、固定型号、参数合同 | 保留型号 ID/参数兼容与已拥有能力，改绑官方执行；不复制一套静态官方节点/模型目录 |
| src/runtime/creation/creationMcpBridge.ts、src/components/creation/CreationPanel.vue | 对话影音与面板调用者 | 共用官方连接，保留选中、审批、进度和成果交付 |
| src/stores/mediaTaskStore.ts | 任务历史、恢复与下载 | 增加必要官方任务身份映射，保留旧结果/旧任务；不重写整个任务系统 |
| src-tauri/src/commands/http.rs | comfy_upload_image 与仅供其使用的校验/结构体 | 无调用者后删除；共享 HTTP/下载能力保留 |
| src-tauri/src/secure_store.rs | 服务凭据和工作流上游 Key | 原位安全迁移；旧读写命令在消费者迁移后退役，不能先清空密钥 |
| src-tauri/src/lib.rs、src-tauri/permissions/app-commands.json | 旧命令注册与 ACL | 与删除同步收敛，保留其他命令 |
| src/data/mcpCatalog.ts、src/components/mcp/McpManagerPanel.vue | 内置 MCP 目录与管理 | 增加官方卡片，复用现有生命周期 |
| src/services/mcpClient.ts、mcpStdioTransport.ts、src/stores/mcpStore.ts、src-tauri/src/commands/mcp.rs | 通用 MCP 连接、发现、恢复、stdio 进程 | 直接复用；只补确有必要的 Python 可执行文件定位/环境处理 |
| src/components/memory/MemoryWorkbench.vue、src/runtime/tools/mcpBridge.ts、src/services/deepSeekHarness.ts | @MCP、工具选择和执行桥 | 复用现有入口，验证说明、schema 与结果没有丢失 |

实施前用 rg 追溯所有调用者、测试、fixture、权限、导出和文档引用，补齐本表。旧测试须迁成官方执行行为测试，不能仅删除红测。

### 3.1 同名服务端适配的边界

仓库另有 NewAPI → comfy-adapter → GPU 服务，以及 registry 中 comfy-video 等 API style；它们不等同于 local-comfy。G0 分别列出生产消费者、模型 ID、鉴权、计费和结果地址归属。桌面直接 ComfyUI 执行统一迁走；NewAPI 公网服务的下线不得由字符串清理触发。

用户要求废除的是重复实现，终局不允许用服务端适配绕回旧桌面链路。若要进一步退役服务器上的适配器，另附服务端迁移合同与公网消费者验证，按 URL 素材渠道手册 G0–G6 执行；未完成前明确记录为未退役范围，不宣称仓库/生产全部 ComfyUI 自研代码已清零。

## 4. 唯一执行链合同

### 4.1 设置、安装与就绪

- 内置 ID 固定为 comfyui，显示「ComfyUI（官方）」，Desktop stdio。首次不自动连接；连接后复用 MCP enabled 恢复与断开机制。
- 命令使用 G0 验证的 comfy-mcp 可执行文件；通过 COMFY_BIN 指向正确 comfy-cli。支持含空格路径、虚拟环境、Windows Scripts/可执行文件定位及打包版 PATH；不假设随包 Node 自带 Python。
- 缺依赖展示缺少哪一项、官方安装说明与「重新检测并连接」。本期不开发 Python 下载器、环境管理器、ComfyUI 安装器；不在启动时偷偷 pip install/升级用户环境。
- 分开展示「依赖缺失」「MCP 已连接」「目标服务可用」「工作流依赖缺失」；握手不等于 CLI 可执行或 ComfyUI 可用。工具列表从官方发现，不预填固定数量。
- 现有自定义官方连接根据命令和目标配置识别，可复用原 ID；不能按显示名覆盖、不重复启动、不破坏旧对话引用。

### 4.2 地址与远程能力

旧配置支持本机、局域网 HTTP、HTTPS 远程及可选 Bearer；这些是迁移能力合同，不可以默认 8188 覆盖。

G0 依据固定版本区分本机非默认地址的 COMFY_LOCAL_URL 与远程目标 COMFYUI_URL 等配置。官方当前说明这两类配置作用范围不同，不得同时无脑设置；远程提交目标不能被当成本机节点/模型清单的来源。分别实测上传、运行、查询、下载的目标一致性，以及 HTTPS、路径前缀、Bearer 支持情况。

若官方版本无法覆盖旧地址或鉴权，列出确切缺口和上游解决项，阻断对应迁移/发布。保留迁移源数据而不是保留旧执行器；禁止剥离 HTTPS、丢失 Bearer、静默改连本机或新增自研代理规避。

### 4.3 对话和创作面板

对话经现有 @MCP 选择、工具白名单、审批、SDK 调用；官方描述/schema/错误与结果内容透传到实际 Harness。未选中的服务不能因历史文字而自动启用。

创作面板作为确定性调用者使用同一个连接、官方工具与任务身份。只允许必要的参数到工作流资产、官方结果到现有 MediaResult 的薄映射；不新建 MCP server、工具协议、通用工作流引擎或第二套节点探测。App 不再直接访问目标的 /prompt、/history、/object_info、/models、/upload/image、/view。

已有 Z-Image 与 Grok 工作流迁为无秘密的工作流资产，保留原参数、参考图槽位、种子和输出语义，使用官方运行工具执行。hidden/旧型号不等于可删除，先确认历史和其他调用者。H3/Qwen 等经 NewAPI 的能力按 §3.1 单独归属，不误迁、不误删。

### 4.4 凭据

区分三种秘密：目标服务访问 Bearer、自定义工作流上游 Key、Comfy 官方账号 Key。三者不能互相替代，旧 Key 不自动写入 COMFY_API_KEY。

复用现有安全存储与按目标绑定；配置普通持久层、日志、工具描述、聊天与提交记录不出现明文。自定义工作流若需要上游 Key，G0 必须验证在模型可见参数之外注入且结果/日志不回显的官方支持路径；无法做到则登记阻塞，不把 Key 写入可共享 JSON 或发送给模型。官方已有付费确认语义按原合同保留，App 不默认为用户同意消费。

### 4.5 任务、取消与结果

- 复用 mediaTaskStore，提交后立即持久化官方任务 ID、连接身份、目标快照和恢复所需信息。断网/等待超时是未知或进行中，不重提生成、不切云端。
- 状态与取消使用官方工具。只取消当前任务，不把断开 MCP 当作取消，不终止用户手动启动的 ComfyUI。
- fetch_outputs 获取结果后复用项目导入、命名、历史与预览；验证图片、视频、文本 URL 输出、多文件以及带凭据结果，不假设所有结果都是 PNG。仅返回任务 ID 不标成功；落盘文件读回成功才登记交付。
- 恢复以原目标和任务 ID 查询。官方 CLI 本地状态可能参与结果寻址，必须实测 App 重启、状态文件缺失和外部提交的任务 ID；不得回落本机默认服务或误取其他项目结果。
- 进程断开只回收 App 所有的 MCP 及其子进程；多窗口、重载、连接中取消、退出升级沿用现有进程所有权规则。

## 5. 配置和历史迁移

1. 只读盘点旧 localStorage/sessionStorage、系统凭据、local-comfy 型号引用与非终态任务；不触碰用户工作流、模型和 ComfyUI 安装目录。
2. 生成官方连接候选，保留地址/名称/凭据归属；迁移不等于启用，不因旧设置存在而执行生成。已有连接不按名称覆盖。
3. 原子保存新配置与迁移标记，读回核对再标完成；中断可重入，失败保留源和错误。不永久双写；新执行只走官方。
4. 历史已完成任务保持原文件、ID、预览和项目归属。旧进行中任务先以官方工具恢复验证；失败保留为可诊断未知状态，不删除、不自动重提。
5. 新连接、凭据和旧任务恢复通过后删除旧 UI/执行器/写入口；迁移读取仅在未完成用户首次升级时执行。源密钥清理必须在新目标验证成功后，不能因新版本首次启动即销毁。

## 6. TDD：先红测，再实现

测试使用临时项目、内存凭据和假 stdio MCP；不安装依赖、不访问用户服务、不提交付费任务。重要逻辑以行为断言为主，静态检索仅用于退役禁入检查。

| 阶段 | 先写失败用例 | 转绿条件 |
| --- | --- | --- |
| G0 官方合同 | 启动真实固定版本，获取 schema 与依赖/地址行为证据；缺口明确失败 | 精确版本与三平台要求记录，能力映射完整；不能用 mock 证明上游支持 |
| T1 连接与入口 | 干净配置、缺 Python/MCP/CLI、CLI 版本错误、握手成功但后端不可用、自定义连接重复 | 官方卡、分层状态；@MCP 可选；断开后工具移除；普通 MCP 回归 |
| T2 迁移 | 自定义端口、局域网、HTTPS/Bearer、三类 Key、空/损坏源、写入中断、重复启动 | 无默认值覆盖、无密钥串用，幂等原子迁移，失败保留来源 |
| T3 工具边界 | 选中/未选中、schema 与说明、isError、多内容块、超时和取消 | 对话与面板共用连接；只执行允许工具；实际模型上下文无秘密 |
| T4 工作流保留 | Z-Image 原参数，Grok 1–7 参考图映射、远程 URL 输出、依赖缺失 | 官方上传/运行/结果工具覆盖原行为；不改用户模型/参数、不新增 HTTP |
| T5 任务可靠性 | 提交后崩溃、重启、CLI 状态缺失、等待超时、断网、取消失败、多结果、目标更改 | 不重复提交，原 ID/目标恢复；未知不冒充失败或成功；落盘可读 |
| T6 生命周期 | 双窗口、重载、启动中取消、断开/退出升级、外部 ComfyUI 已运行 | 无重复会话泄漏；只回收 App 进程，不误停用户服务 |
| T7 退役 | 禁入旧上传命令/设置卡/直连调用；shared 下载和 NewAPI 模型回归 | 旧消费者清零、注册/ACL 同步；桌面能力不减少 |

建议扩展现有 comfyUiRuntime、localComfyRuntime、creationMediaPlan、creationMcpBridge、mediaTaskStore、mcpManagerPanel、mcpClientRestore、mcpStdioLifecycle 与 Rust MCP/凭据测试；旧文件可按最终归属重命名。新增测试注册 scripts/run-focused-tests.mjs，不只新增未运行文件。

## 7. 实施顺序与验证

1. 固定官方版本与能力对照 → 验证：G0 真实 schema、安装/地址/鉴权/秘密传递与任务恢复证据。
2. 官方卡、连接、配置迁移和 @MCP → 验证：T1–T3 红绿记录、现有 MCP 回归。
3. 创作面板、工作流资产、任务与结果改接 → 验证：T4–T6，原参数和成果行为等价。
4. 删除旧实现、注册和测试替身 → 验证：T7、类型检查、完整 focused、受影响 Rust 测试与构建。
5. 三平台安装包实测与交付 → 验证：下表；任何未完成项明确待验收。

真实验收矩阵每行登记版本、平台、请求/任务 ID、输出路径、错误与结论，不记录秘密：

| 场景 | macOS ARM | Intel Mac | Windows |
| --- | --- | --- | --- |
| 干净依赖引导、虚拟环境、含空格路径、打包 PATH | 待验收 | 待验收 | 待验收 |
| 设置连接、@MCP 对话、面板同连接运行 | 待验收 | 待验收 | 待验收 |
| 本机默认/自定义地址、局域网、HTTPS/Bearer | 待验收 | 待验收 | 待验收 |
| 图片与 1–7 参考图视频、上游 Key 隔离、成果落盘 | 待验收 | 待验收 | 待验收 |
| 旧配置升级、历史预览、进行中任务恢复 | 待验收 | 待验收 | 待验收 |
| 取消、断网、双窗口、重启、退出升级收尾 | 待验收 | 待验收 | 待验收 |

纯连接测试不代表生成可用，无 GPU 的平台可控制明确记录的远程 GPU，但不能据此声称本机生成通过。付费工作流真实执行单独登记费用授权与结果。

## 8. 发布闸门与当前状态

- 官方功能缺口尚未解决时停止对应阶段，记录阻塞；不引入永久旧执行器兜底，也不以删能力发布。
- 验收失败回退整版安装包与兼容数据，不在新版保留两套 ComfyUI 执行器。升级迁移不得破坏旧配置与原项目文件。
- Web 仍只保留下载展示；Mobile 冻结；不扩展它们的本机 MCP 进程能力。
- 历史知识库、CHANGELOG、旧验收证据不删除。实施后按事实更新首页/hot/日志，区分代码完成、自动验证、真实平台和正式发布。

当前仅完成仓库调用链盘点与官方文档核查，未固定安装版本、未连接 MCP、未修改产品代码、未执行红绿测试、未迁移用户数据、未打包发布。截图 HTTP 502 原因尚未确认，不能承诺迁移自然修复。

## 9. G0 实施记录（2026-10-21）

用户授权「立刻执行」后已执行官方合同验证。本节替代 §8 末段的初始状态，其他阶段仍为计划。

### 9.1 实际版本与发现

- 复用本机已安装的 pipx 环境，没有安装或升级用户依赖：comfy-mcp **0.10.0**、comfy-cli **1.20.0**、Python **3.14**。仅启动临时 stdio MCP 会话，结束后关闭，未操作用户正在运行的 ComfyUI。
- 使用仓库现有 `@modelcontextprotocol/sdk` 的 Client/StdioClientTransport 完成真实握手和 tools/list，发现 **39** 个工具。五项核心输入 schema 已保存到 [G0 合同快照](证据/ComfyUI官方MCP-G0-2026-10-21/contract.json)。没有提交生成、下载模型或调用付费工具。
- 该已发布版本握手报告 name=comfy-mcp、version 为空；版本由已安装发行包 metadata 核实，不能把空握手版本当成已验证版本。main 新代码与发行包不可混为一谈。
- 只读查询 PyPI 并下载 wheel 到临时目录核查：当时最新 comfy-mcp=0.10.0、comfy-cli=1.23.0，均要求 Python >=3.10。wheel SHA-256 保存在快照。1.23.0 未安装/运行；只核查其地址解析源码。

### 9.2 确认的迁移阻塞

在已安装官方 `comfy_mcp.target._comfy_target()` 上直接执行三项行为断言，**3/3 通过**，分别确认：

| 配置 | 官方实际结果 | 对迁移的影响 |
| --- | --- | --- |
| http://192.168.1.25:8188 | 返回正确 host、port | 可解析裸 HTTP 目标；不等于连接或生成已通过 |
| https://comfy.example.test | 抛出 scheme https is not supported | 无法承接当前设置允许的 HTTPS 服务 |
| http://192.168.1.25:8188/comfyui | 抛出 must not include a path | 无法承接当前地址校验允许的路径前缀 |

另外实测 comfy-cli 1.20.0 的 `parse_local_url()` 同样拒绝 HTTPS；不能改用 COMFY_LOCAL_URL 绕过。只读检查最新 1.23.0 wheel 仍包含只允许 http 的校验，因此没有以升级现有用户环境试错。官方 MCP 0.10.0 wheel 同样明确拒绝 HTTPS 和路径前缀。

这些是上游解析器的确定行为，不是截图 HTTP 502 的根因诊断，也不是网络/模型问题。Bearer、自定义上游 Key 安全注入与历史任务恢复尚未完成行为验证，不能列为已确认支持或已确认不支持。

复现方式（使用安装 comfy-mcp 的 Python；不访问目标主机、不读用户凭据）：

```python
import os
from unittest.mock import patch
from comfy_mcp.target import _comfy_target

for url in (
    "http://192.168.1.25:8188",
    "https://comfy.example.test",
    "http://192.168.1.25:8188/comfyui",
):
    with patch.dict(os.environ, {"COMFYUI_URL": url}):
        try:
            print(url, _comfy_target())
        except Exception as error:
            print(url, str(error))
```

### 9.3 阶段结论与继续条件

**G0 未通过，无损替换/删除阶段未启动。** 依据 §4.2「若官方版本无法覆盖旧地址或鉴权……阻断对应迁移/发布」，不能为了删除自研代码而静默废除 HTTPS/路径前缀、增加降级 HTTP 或另造代理。本次未改产品代码、旧设置、密钥或任务数据；这不是全量迁移完成。

继续条件：官方版本实际支持这些目标并通过同项验收，或用户明确调整能力保留合同，接受废除对应旧能力。不能由实施者自行将「退役重复实现」解释成「删除已有桌面能力」。无需再确认是否使用官方 MCP，该方向已经确定。

## 10. 继续执行后的源码实施记录（2026-10-21）

用户说明「已经关闭发布版！继续执行！」后继续开发；不把关闭发布版解释为 HTTPS 降级或删除用户配置的授权。本节是最新进展，§9 保留为前一阶段证据。源码收敛到官方现有能力边界，兼容性发布门禁仍保留，不能将源码完成写成全量无损升级已经通过。

### 10.1 已实施

| 范围 | 实际变更 |
| --- | --- |
| 唯一设置与输入入口 | mcpCatalog 增加「ComfyUI（官方）」；McpManagerPanel 配置服务地址、MCP/CLI 可执行文件、安装引导、重连与服务检查。复用现有 @MCP、工具分组、选择与审批。旧「工作流服务」卡替换为进入 MCP 设置的链接 |
| 官方依赖 | 安装说明固定 comfy-mcp=0.10.0、comfy-cli=1.20.0；复用系统已有安装，不自动 pip install/升级，不打包另一套 Python/ComfyUI。原生解析器增加这两个命令的 ~/.local/bin 查找；Windows 保留原可执行文件解析与完整路径配置 |
| 单一目标 | 内置配置使用官方 COMFY_LOCAL_URL，并显式清空 COMFYUI_URL/HOST/PORT，防止继承环境覆盖保存地址。面板调用拒绝多个地址选择器或未明确配置的连接，不静默切换服务。自定义官方连接保留 ID/名称，通过新卡保存目标后共用 |
| 创作执行 | 新增 src/services/comfyMcp.ts，仅负责产品参数、文件和任务身份映射；上传、运行、等待、取消、结果下载都调用现有 MCP client 的官方工具。未建 MCP server、HTTP 代理或另一套 ComfyUI 网络协议 |
| 工作流资产 | 原 Z-Image/Grok 图迁为 src/runtime/creation/workflows/*.json；保留型号 ID、参数、LoRA、参考图槽位与随机种子语义。local-comfy 合同只接受 mcp:run_workflow，禁止退回 /prompt |
| 私有输入文件 | 官方运行工具需要绝对文件路径；新增 comfy_mcp_write_input 仅写 App 私有 UUID 目录，拒绝路径逃逸、覆盖和目录符号链接，参考图保留 20 MB 上限；Unix 目录 0700、输入文件 0600。含工作流 Key 的实例不写进项目或随包 JSON，正常提交/失败后移除；异常进程退出残留清理尚未验收 |
| 官方结果与说明 | MCP client 增加结构化结果接口，保留混合内容，isError 原样转失败；官方握手 instructions 经工具桥到达模型，schema 和原描述保留。区分 MCP 已连接与 ComfyUI 服务可用 |
| 任务可靠性 | 提交返回 ID 后先等待现有任务存储完成，再进入官方等待；冻结 server ID、地址、任务 ID 和工作目录。恢复只查询，不重新提交；明确失败标记终态，未知状态保留可恢复任务；取消当前官方任务，不停用户 ComfyUI 进程 |
| 历史恢复 | 新任务保存 comfy-mcp: 恢复描述。旧裸 HTTP /history/{id} 在连接目标一致时转成官方查询；跨目标、HTTPS 或缺失服务报错保留，不用旧 HTTP 轮询兜底。实际旧任务与 CLI 状态文件缺失场景仍待真机验收 |
| 特殊视频输出 | 官方 CLI 的 text_outputs 中自定义 Grok 节点 CDN 视频 URL 继续作为结果，复用 App 现有媒体下载；文件结果走官方 fetch_outputs。两种结果都不是仅有任务 ID 就宣布成功 |
| 凭据 | 旧上游 Key 继续使用原系统安全存储；旧 sessionStorage 源只有安全保存成功后才清除，新值不写回浏览器存储。服务 Bearer、工作流上游 Key、官方账号 Key 不互相替代；不支持的旧 Bearer 配置保留并明确提示 |
| 本地独立运行 | local-comfy 不要求云端登录，不捕获 NewAPI 下载 Key；其他云端任务维持原规则。增加真实任务 store 行为回归验证两条路径 |

删除：src/utils/comfyUiRuntime.ts，旧探测/连接状态逻辑，localComfyJson、专用上传、手写提交/轮询/原生结果解析，Rust comfy_upload_image 及其结构体、专用 URL 校验、注册和 ACL；无调用者的旧服务凭据写命令同步移除。保留旧服务凭据读取用于迁移检查，未清空用户系统凭据。

### 10.2 测试与构建证据

- 红测：新增官方执行测试先因模块不存在失败；最小实现转绿。端点改接后原计划校验因只接受 HTTP 路径失败，补齐 local-comfy 唯一官方操作校验后转绿。本地任务测试先复现错误捕获云端 Key，再验证无云端登录也可提交官方任务。
- 官方执行、配置、恢复、取消、终态、文本视频输出、SDK schema/instructions、混合结果和密钥迁移专项：10/10 通过；测试使用假 SDK/临时文件，不提交付费请求。
- 最终完整 focused：**2086 通过、1 跳过、0 失败**；pnpm run typecheck 与 Vite 构建通过（产物在 /tmp/jc-comfy-build，未替换正式安装包）。Rust 全库串行 **495 通过、2 忽略、0 失败**，其中 MCP 18/18。私有文件测试覆盖权限、目录/文件名逃逸和禁止覆盖；未将单项测试扩大为所有原生行为验收。
- pnpm tauri dev 已完成编译并启动 target/debug/jiucaihezi-app，原生启动日志确认 Tauri=true、SQLite 初始化完成。调试启动存在依赖 source map 缺失警告，未在本任务修改依赖。
- 原生 GUI 自动化无法识别无 .app 包的 debug 可执行文件，因此没有登记原生点击、卡片连接或输入框人工操作通过；不误打开已关闭的正式安装包替代开发版验收。

### 10.3 保留的验收边界

本机 http://127.0.0.1:8000 与 :8188 的只读探测均不可达，未自动启动/更改用户 ComfyUI，未执行真实工作流或收费生成。官方 MCP 握手/工具发现仍是 §9 的真实结果，不扩大为生成通过。局域网、旧任务迁移、异常退出清理、Windows/Intel Mac 安装包、原生点击和正式发布继续待验收。

服务器 NewAPI/comfy-adapter、公网渠道、计费与现有云端模型未改动，仍依 §3.1 定界；本轮退役的是桌面直连重复执行链，不能宣称所有生产适配器已下线。用户其他未提交的漫剧 Skill、Wiki 与文档改动完整保留，未提交、推送或发布。

## 11. 已连接却只输出提示词的根因与修复

用户截图反馈：已连接并选中 ComfyUI，发送「生成一张美女图片」后只返回英文提示词。只读检查对应官方会话事件，实际工具调用为 `skill(name="jc-shuaigemeinv")`，没有 ComfyUI 工具调用。根因是服务选中仅用于挂载工具，没有把本轮用户显式选择该 MCP 的执行意图传入消息；提示词 Skill 的输出被模型误作最终交付。

- 新增 deepSeekMcpPrompt，将选中服务器 ID 与执行意图随普通发送、队列发送一起传给模型：任务需要所选服务能力时实际执行，Skill 只辅助，不能用提示词代替生成结果；用户明确只要提示词时仍遵从。不增加关键词分流器，不改变官方工具或 schema。
- MCP 连接后自动调用官方 server_info；再次打开已连接卡片也检查状态。正确读取 CLI 的 `server.running` 字段，并兼容顶层 running；无法确认时显示未确认，不把握手当成可出图。
- 定向红测先因 deepSeekMcpPrompt 未导出失败；修复后 Harness/MCP 相关 **92/92**、类型检查与 git diff --check 通过。没有真实模型对话重跑，因此不承诺仅靠提示词约束就能完全杜绝误选工具。

同时实测发现本机 8000/8188 初始均不可达；官方 CLI 启动失败，因为默认工作目录 `/Users/by3/Documents/comfy/ComfyUI` 不存在。定位到真实目录 `/Users/by3/Documents/ComfyUI`，打开已安装的 Comfy Desktop 后，8000 的 system_stats 返回 HTTP 200（ComfyUI 0.32.0、mps）。执行官方 `comfy --json set-default /Users/by3/Documents/ComfyUI` 修正默认目录，未改启动额外参数、模型文件或节点。

随后启动独立官方 MCP 会话只读验证：server_info 返回 running=true、url=http://127.0.0.1:8000、workspace=/Users/by3/Documents/ComfyUI、CLI=1.20.0、envelope/1 兼容，无错误。此结果替代 §10.3 的「本机服务不可达」状态；真实生成与模型对话调用仍待验收，未提交生图/收费任务。

官方 search_models 空查询成功列出模型目录；注意空查询是目录列表，不能当作模型文件数量。随后用官方 CLI models list-folder 实查：diffusion_models 有 z_image_bf16.safetensors，checkpoints 有 svd.safetensors。确认本机存在 Z-Image 权重，不据此宣称其文本编码器、VAE、节点与真实生成已经全部通过。

## 12. 用户实际生成与耗时核对

用户后续截图显示已通过官方 MCP 取回图片。只读核对对应 ComfyUI history：任务 10b1bed3-aab8-4066-8682-94f201a6a1c4 为 success/completed，输出已保存到当前项目。execution_start 至 execution_success 为 689.104 秒（11 分 29 秒），截图整轮耗时 17 分 02 秒；差额约 5 分 33 秒包含模型准备、查询及后续处理，不能全部归为推理耗时。

本次运行使用 z_image_bf16、888×1184、25 步、cfg 4.0、res_multistep/simple，没有 LoRA 节点；本机为 M1 Max、64 GiB。原内置工作流使用配套蒸馏 LoRA 的 4 步方案，两者不能直接按步数等价比较。本次仅确认单张图片成功，不扩大为其他工作流、平台或渠道通过；尚未实施速度优化。

## 13. `@comfyui` 强制执行与连接卡收敛（2026-10-31）

- ComfyUI 连接成功后卡片折叠说明、命令、地址和 Key 字段，只显示“已连接”与“连接设置”；用户主动进入设置后才重新展开。
- 手动输入 `@comfyui` 会绑定当前已连接的官方 ComfyUI 服务，移除令牌文字，并清除本轮竞争的云端影音与 3D 路由；未连接时在发送前阻止并指向 MCP 设置。从 `@` 候选选择 ComfyUI 沿用同一服务芯片。
- 显式选中 ComfyUI 时，Harness 收到“本轮唯一生成执行器”合同：生成、编辑、续写、查询和取回结果必须先实际调用 ComfyUI MCP，不能改走其他生图/生视频能力或只返回提示词。只有用户明确要求“不执行、只要提示词/方案/讲解”时例外。
- 新增字面令牌、面板收敛、工作台绑定与 Harness 执行意图回归；ComfyUI/MCP 提交、恢复和取消 15 项通过，类型检查与差异检查通过。完整工作台回归仍有 1 项既有 iPhone 加密声明断言失败，与本次无关。本轮未新提交真实生成，真实模型是否遵守强制调用待用户在开发版复测。

## 14. 默认工作流选择（2026-10-31）

- ComfyUI 卡片始终展示图片、视频、音频三个默认工作流，允许先选工作流再连接；连接成功后服务地址、命令和 Key 收进“连接设置”，不与日常选择混排。
- 选择器只接受本地 JSON，并检查至少包含一个 `class_type` 节点，拒绝普通 ComfyUI 画布格式；只保存绝对路径和文件名，不复制或改写原文件。
- `@comfyui` 生成请求按图片、视频、音频确定默认项；发送前显示“将使用：ComfyUI · 文件名”。对应类型未设置时阻止发送，不让模型猜测其他工作流。查询任务不强制要求默认工作流。
- Harness 收到确切名称和路径后，只能读取该 API 工作流、按需求更新必要输入到临时副本，再以 `run_workflow` 执行；禁止搜索、生成或替换其他工作流，也禁止覆盖原文件。
- 默认工作流识别、设置卡片、发送阻断与 Harness 合同专项 17/17 通过，`vue-tsc -b` 与 `git diff --check` 通过；未替用户选择工作流，也未提交真实 ComfyUI 任务。
