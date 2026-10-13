# 小易 Grok Video 1.5 三档接入

日期：2026-10-13。用户要求小易增加 `grok-imagine-video-1.5`，三分辨率定价依次为 0.2/0.3/0.4。按现行视频报价口径登记为元/秒。

## 上游合同与实现

依据实际读取的[小易官方 Grok 视频文档](https://xiaoyiapi.xyz/docs/api/grok-videos/)：API Base URL `https://image.xiaoyiapi.xyz`，同一小易 Bearer 令牌提交/查询/下载。精确规范模型名 `grok-imagine-video-1.5`，不要拼分辨率后缀。

- 创建 `POST /v1/videos`；发送 `model/prompt/seconds/aspect_ratio/resolution`。上游 seconds 为字符串 `"6"` 或 `"10"`，480p/720p/1080p，横/竖16:9/9:16。
- 单张图生视频支持 HTTPS `image`；小易推荐先 `/v1/video-assets` 上传，文档也明确字段接受公网 HTTPS 链接。本地 App 沿用现有 OSS 直传生成短期签名 HTTPS 地址，再转换为 image；上游读取该URL与实效需要真实生成验证。插件不静默丢多图，不接受视频/音频参考。
- 任务保存 id（兼容task_id），`GET /v1/videos/{id}` 轮询 queued/in_progress/completed/failed。未知状态不伪装进行中，失败保留 error.message。
- 下载通过 NewAPI artifact/content 代理转发小易 `/v1/videos/{id}/content` 并携带渠道鉴权，GET/HEAD保持；不泄露渠道Key和上游任务编号。官方另提供metadata.url公开归档地址，本插件优先保持现有宿主代理合同，兼容下载接口仍为官方支持路径。

扩展原 `newapi-plugins/xiaoyi-image.plugin.js` 为 **0.2.0**，key **xiaoyi-image 保持不变**；按模型限制 openai_image/openai_video 两协议，保留已有12个图片型号与图片表达式。并非新建第二个小易插件。

原创作目录中该视频型号隐藏且使用旧价0.25，本次按用户请求恢复可见，价格显示 `480p ¥0.2/秒 · 720p ¥0.3/秒 · 1080p ¥0.4/秒`，保留6/10秒、两画幅和单图设置。contractStatus标partial，避免将源码配置说成新插件已生产验收。

## NewAPI 配置与收费表达式

1. 上传并激活 `xiaoyi-image.plugin.js` 0.2.0。
2. 原小易 Task Plugin 渠道增加模型 `grok-imagine-video-1.5`，保持插件key xiaoyi-image，Base URL https://image.xiaoyiapi.xyz，上游Key仅存渠道；模型映射保持空。
3. 该模型 Task Usage 配置以下表达式（沿用前次数值同值价格口径，最终实扣还需核对平台换算/分组倍率）：

```text
u("resolution") == "480p" ? tier("480p", u("seconds") * 0.2) : u("resolution") == "1080p" ? tier("1080p", u("seconds") * 0.4) : tier("720p", u("seconds") * 0.3)
```

示例：6秒三档分别1.2/1.8/2.4元；10秒分别2/3/4元。

统一schema为 image_count、seconds、resolution；图片seconds=0/resolution=none，原图片表达式u(image_count)继续成立。视频image_count=0，按请求秒数与规范小写分辨率计费；完成不重置这两个事实。所有usageExamples字段完整。

无需重建服务器，只上传插件并更新渠道模型与表达式；新插件的真实上游生成、下载、实扣与失败退款未执行，不能报告生产可用。

## 本地验证

全部插件138/138，通过三档提交/费用事实、字符串秒数、单图映射、非法参数/冲突拒绝、任务ID、四状态、鉴权content/HEAD、图片隔离与原图片回归。TypeScript、语法、定向lint、差异检查通过。完整Node focused1955/1956，唯一失败仍为未改动的产品Skill清单断言遗漏已有脑暴Skill；未运行Rust/构建发行包或跨平台人工验证。
