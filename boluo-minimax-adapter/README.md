# 菠萝 MiniMax 参考生视频适配器

将 NewAPI 的 OpenAI-compatible `/v1/videos` 请求转发到 `aimanplay.cn` 的
`minimax_h3_image_audio_to_video_v2_15s`。

## 部署

```bash
cd /opt/boluo-minimax-adapter
docker compose up -d --build --force-recreate boluo-minimax-adapter
curl http://127.0.0.1:8794/health
```

将目录复制到服务器后，确保它加入与 NewAPI 相同的 Docker 网络。当前 compose 使用：
`new-api-new_new-api-network`。

## NewAPI 渠道

- 类型：OpenAI 兼容
- Base URL：`http://boluo-minimax-adapter:8794`
- 模型：`minimax_h3_image_audio_to_video_v2_15s`
- 对外售价：`0.08/秒`
- 上游密钥：菠萝平台 `sk-...` 令牌

NewAPI 负责鉴权和计费，适配器负责字段转换、素材转存、上游任务提交和成片下载代理。

## 任务生命周期

创建接口只做校验，然后立即返回本地任务 ID（32 位十六进制，不带 `task_` 前缀）：
素材转存和上游提交都在响应发出之后由后台完成。因此客户端拿到 ID 的速度与素材大小无关。

| 阶段 | `GET /v1/videos/{id}` 的表现 |
| --- | --- |
| 已受理、转存中 | 本地生成：`status` 为 `queued` / `in_progress`，`progress` 为 `0` / `5` |
| 已提交上游 | 原样代理菠萝任务对象；响应里的 `id` 仍保持创建时返回的本地 ID |
| 转存或提交失败 | HTTP `200` + `status: failed` + `error.message`（参数错误仍是立即 `4xx`） |

- 单个参考素材的下载 + 转存上限 **60 秒**，超时的错误信息会指出素材主机和阶段。
- 多个参考素材并发转存，并行下载后按 `ref_image_N` / `ref_audio_N` 顺序编号提交。
- 任务表在内存里，容器重启后旧 ID 无法再解析，需要重新创建任务。

## 字段契约（对齐 `docs/wiki/运维/菠萝MiniMaxapi.md`）

- `model` 只收 `minimax_h3_image_audio_to_video_v2_15s`，其它一律 400。
- `duration` 1-15 秒（缺省 15），`seconds` 同义；`resolution` 只收 `480p竖` / `768p竖` / `480p横` / `768p横`。
- 上游没有比例字段，方向靠 `resolution` 的后缀表达：适配器把 `aspect_ratio`（或 `ratio`）折进去 —— `16:9` + `xxx竖` → `xxx横`，`9:16` + `xxx横` → `xxx竖`。
- 参考素材最多 9 张图 + 3 段音频，上限优先用 STS 响应的 `maxImageBytes` / `maxAudioBytes`，缺失时用文档默认的 10 MB / 20 MB。面板侧选择上限是 20 MB，真实闸门在适配器。
- 转存到 OSS 的对象 key 用真实 Content-Type 推导扩展名（`png`/`jpg`/`webp`/`wav`/… ），未知类型回退 `.mp3`（音频）或 `.bin`。
- `seed` 可选，非负整数，原样转发；非法值立即 400。
- `GET /v1/videos/{id}/content` 不转发 `Range`，总是返回完整字节流。
