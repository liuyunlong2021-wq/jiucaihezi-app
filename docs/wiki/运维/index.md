# 运维

用途：记录生产服务器、NewAPI、适配器和发布操作；不记录密钥正文。

## 页面

- [图生图 multipart 请求头丢失根因与修复](图生图multipart请求头丢失根因与修复-2026-10-09.md) - OSS 重建 rc.40 的公共表单转发缺陷；真实宿主回归、生产部署与用户五个图片型号实测成功；包含原始截图和协议边界。

- [新增模型与 NewAPI 插件固定流程](新增模型与NewAPI插件固定流程.md) - 新模型从上游合同、服务器渠道、App 注册、Task Plugin、价格表达式到第三方 API 文档和真实验收的统一入口。
- [韭菜盒子 Fk 渠道 Seedance 视频 API 对外接入](韭菜盒子Fk渠道Seedance视频API对外接入-2026-10-06.md) - Fk Task Plugin 的 7 个公开模型、规格、价格、异步任务和成片下载合同；真实公网链路待验收。
- [韭菜盒子 MiniMax H3 Context IR 提示词增强 API 对外接入](韭菜盒子MiniMaxH3ContextIR提示词增强API对外接入-2026-10-06.md) - H3 多模态提示词增强的 Responses API 合同；纯文本后台任务已完成公网验收，其它模式及账单待核对。
- [韭菜盒子 Fk 渠道图片 API 对外接入](韭菜盒子Fk渠道图片API对外接入-2026-10-08.md) - 六个图片模型的 NewAPI 调用合同、文生图/图生图请求、服务端轮询、结果 URL 和计费边界；ECS 已有 FK 文生图 200 记录，图生图验收待完成。
- [Fk 渠道图片 API 接入](Fk渠道图片API接入-2026-10-08.md) - 复用已在 ECS 运行的 `fk` Task Plugin `0.2.0`；App 的本地 FK 图生图素材改走私有 OSS JSON `imageUrls`，客户端构建及真实图生图验收待完成。
- [韭菜盒子 Grok Imagine Image API 对外接入](韭菜盒子GrokImagineImage2.0API对外接入-2026-09-08.md) - NewAPI 公网 OpenAI Images 接口；小易 Grok 走 `openai_image` 插件，文生图与图生图由 NewAPI rc40 主机轮询后返回标准图片结果。
- [小易图片 NewAPI rc40 图片任务插件](小易图片NewAPIrc40图片任务插件-2026-10-08.md) - GPT Image 与 Grok Imagine 的 OpenAI Images 路由、上游异步提交/轮询、multipart 编辑与结果下载合同；生产部署后用户实测 GPT Image 2.5 1K、Grok Imagine Image 2.0 成功，账单待核对。
- [服务器运维](服务器运维.md) - 生产服务器结构、常用命令和历史运维事实。
- [App 参考素材直传阿里云 OSS 验收（2026-10-09）](App参考素材直传阿里云OSS验收-2026-10-09.md) - 记录 NewAPI 生产切换、桌面 App 参考图直传和 FK MiniMax H3 三秒实测、HTTP 204 客户端修复、发布边界与回滚目录。
- [服务器存储清理与 AnyDoc 生产切换](服务器存储清理与AnyDoc生产切换-2026-09-07.md) - 已验证的磁盘治理、输出文件一天过期策略和云端文档转换器生产切换。
- [NewAPI rc.30 升级交接](NewAPI-v1.0.0-rc.30升级交接-2026-09-03.md) - 2026-09-03 从 rc.20 升级到 rc.30 的已完成步骤、待执行命令、验收和回滚。
- [NewAPI 视频下载 SSRF 端口配置失效排障](NewAPI视频下载SSRF端口配置失效排障-2026-09-09.md) - 记录内部视频适配器 `/content` 被端口策略拦截、端口数组类型不匹配，以及已验证的恢复步骤。
- [小易图片模型接口与 NewAPI 接入](小易图片模型接口与NewAPI接入-2026-09-04.md) - GPT Image 与 Gemini 的客户端接口、模型映射、NewAPI 渠道和排错合同；GPT Image/Grok 小易任务插件现行部署步骤以 rc40 接入页为准。
- [韭菜盒子图片模型 API 对外接入](韭菜盒子图片模型API对外接入-2026-09-04.md) - 可直接发给第三方用户的图片模型接口、模型名、请求格式和错误处理。
- [韭菜盒子 Seed Audio 1.0 API 对外接入](韭菜盒子SeedAudio1.0API对外接入-2026-09-04.md) - 可直接发给第三方用户的音频模型接口、最多三段参考音频、响应格式和错误处理。
- [韭菜盒子 MiniMax 参考生视频 API 对外接入](韭菜盒子MiniMax参考生视频API对外接入-2026-09-06.md) - 可直接发给第三方用户的 MiniMax H3 图片与音频参考生视频接口、参数限制和异步下载流程。
- [[docs/wiki/运维/韭菜盒子RH渠道MiniMaxH3视频API对外接入-2026-09-21|韭菜盒子 RH 渠道 MiniMax H3 视频 API 对外接入]] - 文武双修成功链路、完整动态节点与 metadata 传参、戏种选择、升级边界及历史合同。
- [韭菜盒子 Seedance 2.5 API 接口](韭菜盒子Seedance2.5中转接入.md) - 可直接发给第三方用户的 `dola-seedance2.5` 视频接口合同。
- [韭菜盒子灵动（满血）Seedance 2.5 API 对外接入](韭菜盒子灵动Seedance2.5API对外接入-2026-10-02.md) - 可直接发给第三方用户的 5 条灵动线路合同：按秒（0.5/0.75/1.5 元）与按次（`SD-2.5-特价` 2.5 元、固定 30 秒、21:9、12000 字）、参考图上限和错误处理。
- [本机 ComfyUI 模型对外接入（jc- 前缀）](本机ComfyUI模型对外接入-2026-09-26.md) - 本机 4090 上的 MiniMax H3 经 comfy-adapter + frp 隧道接入 NewAPI 与创作面板；含已完成证据、剩余步骤和关键坑。（图片模型 `jc-qwen-image-2.1` 已于 2026-09-26 撤下，服务器端保留）
- [韭菜盒子本机 ComfyUI 图片模型 API 对外接入](韭菜盒子本机ComfyUI图片模型API对外接入-2026-09-26.md) - `jc-qwen-image-2.1` 的接口合同（模型名、尺寸档位表、b64 响应和错误处理）。**当前未上线**：图片与视频两套权重在 48GB 显存里无法共存，等搬到独立机器后再启用。
- [韭菜盒子本机 ComfyUI 视频模型 API 对外接入](韭菜盒子本机ComfyUI视频模型API对外接入-2026-09-26.md) - 可直接发给第三方用户的 `jc-MiniMax H3` 四个视频模型：传图字段、画幅表、比例枚举、异步下载和保留期。
- [本机 ComfyUI 接入 NewAPI 任务插件通道（方案）](本机ComfyUI接入NewAPI任务插件通道SDD-2026-10-01.md) - 把 `jc-minimax-h3*` 从 type 1 OpenAI 渠道换成 type 61「Task Plugin」渠道 + 自写 `comfy` 插件：字段无损透传、任务持久化、用量计费与成片代理交给宿主。**已实施并实测通过**（选 4:3 → ComfyUI 节点 29 = `4:3 (Standard)`）。
- [适配器收编任务插件总方案（Wave 计划）](适配器收编任务插件总方案-2026-10-01.md) - 把「每个线路一个独立 Python 服务」改成「NewAPI 单文件插件」的分波计划：能直用官方插件的零代码（`kik-seedance`），其余自写；`comfy-adapter` / `seed-audio-adapter` / 附件与文档服务不下岗。**已决策，待实施**。
