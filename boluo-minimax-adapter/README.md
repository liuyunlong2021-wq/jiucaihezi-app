# 菠萝 MiniMax 参考生视频适配器

将 NewAPI 的 OpenAI-compatible `/v1/videos` 请求转发到 `aimanplay.cn` 的两个图音参考生模型：
`minimax_h3_image_audio_to_video_v2_15s` 与 `minimax_h3_zm_u24`（增强版）。

## 部署

服务器目录 `/opt/boluo-minimax-adapter`，只需同步 `src/`、`requirements.txt`、`Dockerfile`；
`docker-compose.yml` 用服务器上已有的那份，不要覆盖。

```bash
cd /opt/boluo-minimax-adapter
docker compose up -d --build --force-recreate boluo-minimax-adapter
```

compose 没有映射宿主端口，`8794` 只在 docker 网络内可达，验证要在容器里做：

```bash
docker compose exec -T boluo-minimax-adapter \
  python -c "import json,urllib.request;print(json.load(urllib.request.urlopen('http://127.0.0.1:8794/health')))"
```

预期 `models` 列出两个模型。重建会清空进程内的任务表，重启前已创建的任务 ID 失效，需要重新创建。
适配器必须加入与 NewAPI 相同的 Docker 网络：`new-api-new_new-api-network`。

## NewAPI 渠道

- 类型：OpenAI 兼容
- Base URL：`http://boluo-minimax-adapter:8794`
- 模型：`minimax_h3_image_audio_to_video_v2_15s`（对外价 `0.08/秒`）、`minimax_h3_zm_u24`（对外价 `0.1/秒`）
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

- `model` 只收 `minimax_h3_image_audio_to_video_v2_15s` 和 `minimax_h3_zm_u24`，其它一律 400。
- `duration` 1-15 秒（`seconds` 同义，不传或传 null 时按模型默认值：旧版 15 秒、增强版 5 秒）。
- `resolution` 按模型各自的白名单校验：旧版只有四个 `竖/横`；增强版额外支持 `480p(1:1)` 和 `768p(1:1)`。
- 上游没有比例字段，方向靠 `resolution` 的后缀表达：适配器把 `aspect_ratio`（或 `ratio`）折进去 —— `16:9` + `xxx竖` → `xxx横`，`9:16` + `xxx横` → `xxx竖`，`1:1` + `xxx竖/横` → `xxx(1:1)`。
- 参考素材最多 9 张图 + 3 段音频，上限优先用 STS 响应的 `maxImageBytes` / `maxAudioBytes`，缺失时用文档默认的 10 MB / 20 MB。面板侧选择上限是 20 MB，真实闸门在适配器。
- 转存到 OSS 的对象 key 用真实 Content-Type 推导扩展名（`png`/`jpg`/`webp`/`wav`/… ），未知类型回退 `.mp3`（音频）或 `.bin`。
- `seed` 可选，非负整数，原样转发；非法值立即 400。
- `GET /v1/videos/{id}/content` 不转发 `Range`，总是返回完整字节流。
