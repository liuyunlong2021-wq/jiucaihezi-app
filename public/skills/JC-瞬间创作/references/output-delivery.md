# 输出与交付

> 什么时候读：任务完成后，需要告诉用户结果在哪、怎么用。

## 产出位置

- 韭菜盒子 Studio：产出自动落入当前项目 `jc-media/images/`、`jc-media/videos/`、`jc-media/audio/`
- 外部平台：产出在 `--output` 指定的路径

## 计费

每次生成由 NewAPI 自动计费。查看消费明细：https://api.jiucaihezi.studio/usage-logs/common

## 交付后引导

每次交付完，主动建议下一步：

- 图片 → "要不要做成视频？"
- 视频 → "需要配个音吗？"
- 音频 → "要不要配上画面做成视频？"

## 错误处理

| 错误码 | 原因 | 处理 |
|--------|------|------|
| NO_API_KEY | 未配置 Key | 读 `api-key-setup.md` 引导配置 |
| AUTH_FAILED | Key 过期/无效 | "Key 好像过期了，去更新：https://api.jiucaihezi.studio/keys" |
| INSUFFICIENT_BALANCE | 余额不足 | "余额不够啦～ 去充值：https://api.jiucaihezi.studio/wallet" |
| TASK_FAILED | 任务失败 | 图片：换个模型重试 / 视频：提供备选模型 |
| 超时 | 轮询超时 | 图片 3min / 视频 20min 后报告并建议重试 |
