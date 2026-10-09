# NewAPI rc.40 临时素材与 OSS 直传扩展

这是 NewAPI 后台扩展，不是独立鉴权服务或 APP 图床。

- 固定上游 rc.40 SHA `0aec08fee811ec6136828fda790551b49e410301`。
- POST `/api/creations/uploads` 复用 `middleware.TokenAuth()`，完整校验 NewAPI 用户 Token。
- 文件和元数据写现有 `/data/creation-media`；每个文件最多 20 MiB，7 天过期。
- 总容量 10 GiB，写入前预留最大文件大小，磁盘至少保留 1 GiB；单进程串行写入。
- 随机 128 bit URL 可分享给供应商；GET/HEAD/Range 无需供应商持有平台 Key。
- `POST /api/creations/upload-url` 使用同一 NewAPI TokenAuth，返回仅限单对象、限 5 分钟、最大 20 MiB 的 OSS 表单上传策略，以及 6 小时有效的私有对象签名读取 URL。文件字节由 App 直接发往 OSS。
- 直传配置只在 NewAPI 容器：`OSS_ENDPOINT=https://oss-cn-shanghai.aliyuncs.com`、`OSS_REGION=cn-shanghai`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`。RAM 身份只需对该 Bucket 的 `creation-temp/*` 授予 `oss:PutObject` 与 `oss:GetObject`；不要使用主账号 AccessKey。
- Bucket 保持私有。切换前必须给 `creation-temp/` 配置 OSS 生命周期，到期自动删除；测试先设 1 天。部署验收会写入一个 68 字节测试对象，由该规则自动清理。桌面 App 用原生 HTTP 上传，不需要为 WebView 配置 OSS CORS。
- 生产现状基线（由用户服务器核实）：当前镜像 `jiucaihezi/new-api:rc40-local-media-20261006`，镜像 ID `sha256:59fe85edf1175981780b08ad99c072d07e1f29e8869e12ec45fae470dc80f24d`；Compose 项目 `new-api-new`，主配置 `/root/new-api-new/docker-compose.yml`，已有媒体覆盖 `/root/new-api-new/docker-compose.media.yml`。
- `prepare.sh` 只从固定官方 rc.40 源码重建本地临时素材扩展，并新增 OSS 直传；生成新镜像 `jiucaihezi/new-api:rc40-local-media-ossdirect-20261009`，不会覆盖旧镜像标签或重启生产。它会严格核对当前镜像 ID 和 Compose 基线。
- 生产切换要求服务器已有 root-only `/root/jc-oss.env`（权限 `600`），只包含以上五个变量；`activate.sh` 保留已有 `docker-compose.media.yml`，另建 `docker-compose.oss-direct.yml` 注入配置，备份数据库、Compose 与 Nginx，再切换 NewAPI。它会隐藏读取 NewAPI 用户 Key，并验证现有本地上传、OSS 授权鉴权、真实 OSS 表单上传及签名读回；失败自动恢复旧镜像。不要把该文件、RAM Secret 或 NewAPI Key 发到聊天里。
- 每小时清理过期文件；上传时也清理。读取逻辑立即拒绝过期地址。
- 不触发生成或扣费；原模型、插件、音频、图片和视频端点不变。
- 当前为单个生产容器设计，不能多个容器并行挂载同一目录写入；扩容前需重新实现跨进程额度保护。
- 仅支持 Linux 服务部署；源码存储测试可在 macOS 执行。

## 准备与切换

`prepare.sh` 校验当前生产镜像和 Compose 基线后，在独立 `/opt/jc-newapi-media/source` 克隆官方 rc.40，
添加两项扩展、运行存储回归及路由编译检查、构建新镜像；绝不重启生产容器。
源码和镜像可能占用数 GB，发布前保证至少 10GB 可用，不自动清理其他服务镜像。

构建完成且 Bucket 生命周期与 `/root/jc-oss.env` 已配置后，再执行 `activate.sh`。脚本会先备份并验证数据库，再替换 NewAPI 容器；NewAPI 健康、现有本地媒体合同和 OSS 直传读回全部通过后才返回成功。不要手工重启容器或改主 Compose。

2026-10-09 已在本机 v2.2.25 预览版用合成参考图完成 FK MiniMax H3-768p 三秒图生视频端到端验收；细节见 `docs/wiki/运维/App参考素材直传阿里云OSS验收-2026-10-09.md`。客户端 204 响应修复已重建本机预览包，但正式桌面发行包尚未发布。当前服务器脚本自身只上传合成的 68 字节测试图，不会触发模型生成或扣费。

不要使用 `latest`、不要改数据库结构、不要打印 Compose 渲染内容（可能含秘密）。
当前生产镜像来自官方 rc.40，新增镜像属于本产品维护的受控扩展；后续官方升级需重新
审计与重放补丁。保留官方许可证、署名与前端链接。

## 已有 OSS 服务的 multipart 修复（2026-10-09）

固定 rc.40 宿主只给入站请求设置 multipart Content-Type，上游新建请求漏头，导致图片编辑的模型与素材不能被解析。`patch_task_multipart.py` 把 writer 生成的 Content-Type 写入上游 descriptor；`prepare.sh` 已纳入该补丁。

已有 OSS 镜像用 `repair-multipart.sh`：核对固定 SHA、镜像和 Compose 三文件，先构建 Linux builder 并执行真实 FK/小易插件的本地 HTTP 回归及素材/OSS 测试，再备份数据库并切换新镜像。检查失败自动回滚；手动回滚脚本保存在回执的备份目录。没有付费生成；真实生产图生图需部署后验收。
