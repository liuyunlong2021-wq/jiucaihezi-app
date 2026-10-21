# NewAPI rc.40 临时素材上传扩展

## 当前桌面公共 R2 迁移（公共服务端已激活，桌面逐项验收待做）

现行 TDD：`../../docs/wiki/开发/桌面App全面迁移R2与OSS退役TDD-2026-10-21.md`。桌面公共上传已改为 `POST /api/creations/r2/upload-url` → 原始 Blob PUT，不接受 OSS grant 或回退；单文件20MiB、上传5分钟/读取6小时，保留原有文件直传与本机协议。**先部署新服务端，再使用新桌面构建**。旧服务404会明确提示升级。

- `prepare-public-r2.sh <只读核对后的当前镜像sha256>` 仅准备镜像：严格匹配固定源码/旧路由及R2签名器哈希，保留其他宿主补丁；备份、测试、构建失败恢复源码，不改生产容器。未知基线先核对，不绕过哈希检查。
- 同包须包含 `extension/creation_media_router.go` 与 `extension/r2direct/*.go`，包括新HTTP handler及测试。旧prepare只复制signer两文件，不能用来部署本次新入口。
- 准备镜像后，按实际Compose/env/挂载/网络比较、数据库备份验证和自动回滚模式制定激活步骤。不要重跑绑定历史镜像ID的activate脚本。用户已登录；服务器完整编译与五包回归通过，新镜像已准备，用户已提供`PUBLIC R2 ACTIVE`回执，独立公网健康/401/CORS通过。
- 当前固定生产基线的切换入口为 `activate-public-r2.py`：交互隐藏输入NewAPI用户Key，先验证数据库备份再只重建NewAPI；验证失败自动回滚。精确新旧ID见TDD§12，不用于其他基线。`python3 activate_public_r2_test.py`共5项模拟通过，真实激活已由用户执行并回执成功，备份`/root/jc-public-r2-switch-cblvcmp7`；见TDD§13。
- 激活后交互运行 `python3 verify-public-r2.py`（同目录需要`activate-r2.py`，仅复用无重定向HTTP辅助函数，不运行旧激活main），隐藏输入用户Key；只验合成小图PUT/GET/HEAD和字节，不生成、不扣模型费。此脚本不替代原生平台/所有MIME/逐型号取材及账单验收。
- 本地测试：`python3 prepare_public_r2_test.py`、`python3 verify_public_r2_test.py`；扩展目录 `go test -mod=readonly ./r2direct ./ossdirect ./jcmedia`。
- 共享OSS入口暂留给旧消费者；新桌面不调用。最终删除OSS包/路由/env与撤销凭据，必须先完成画布/旧客户端迁移及历史唯一原件保存。签名过期不等于对象删除，R2生命周期待生产核对。

下面原有部署阶段记录保留，不代表本次公共R2入口已部署。

## 灵动 R2 小范围试验（源码已实现，尚未部署）

新增 `POST /api/creations/lingdong/upload-url`，沿用 TokenAuth，只接受当前核实的灵动型号与固定私有标准桶 `jiucaihezi-media-test`。浏览器直传 R2，不经香港服务器转发文件；旧 OSS 与本地上传接口保持不动。

- `r2direct/` 使用宿主已有 AWS SDK v4 signer，单文件 20 MiB，上传 5 分钟、读取 6 小时；PUT 绑定 Content-Length 和 Content-Type，GET/HEAD 分别签名。`head_url` 供独立 HEAD 检查，不可将 GET 签名拿去 HEAD。
- 凭据字段见 `r2.env.example`，真实文件仅保存在服务器 `/root/jc-r2.env`（600）；不得进入前端、插件、Git 或聊天。
- `extension/go.mod` / `go.sum` 是独立回归入口（校验和与固定宿主一致），不要覆盖宿主模块文件。验证：`cd extension && go test -mod=readonly ./r2direct ./ossdirect ./jcmedia`。
- `prepare-r2.sh` 只核对固定源码、保留现有补丁、备份媒体源码路由并构建测试镜像，不切换生产；用户已在服务器成功执行。之后必须核对当前 Compose、备份数据库，再保留全部原有 override/env/挂载/网络做切换，不能直接运行历史 `activate.sh` 或 `repair-*.sh`。
- 用户服务器已完成准备，镜像 ID 为 `sha256:4daecc3bc0f41dbf39dfda3847b28193438e436cfd8be0537d3dde3898ff23bc`，生产暂未切换。新增 `activate-r2.py` 针对已核实的易红修复 20261016 基线激活，隐藏输入 NewAPI 用户 Key，只验一个合成小图与旧 OSS 授权，不调用生成。校验合并后的端口/挂载/网络/其他环境完全保留，数据库备份后仅重建 NewAPI；验证失败执行旧镜像回滚并验健康，回滚脚本保存备份目录。`python3 activate_r2_test.py` 与 `python3 backup_db_test.py` 为本地模拟回归，不能代替真实切换。
- 画布实现与验收清单：兄弟仓库 `../jiucaihezi-canvas/deploy/lingdong-r2-experiment.md`；App 运维记录见 `docs/wiki/运维/灵动R2素材直传试验.md`。
- 本地三包回归通过；尚未验证完整宿主编译、真实 R2 读写/CORS、签名 URL 被灵动读取、收费生成、下载或账单。没有自动删除，也没有用新的存储方案宣称已修复此前视频下载超时。

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

## 易红同步图片响应补丁（2026-10-13，未部署）

`patch_yihong_image_response.py` 只在固定 rc.40 源码中，将 yihong 的 `gemini-nano-banana-2.1`、`gpt-image-2-1K-4K`、`gpt-image-2`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst` 图片端点提交响应与 taskData 上限提高到 32 MiB；其余请求与 plugin state 保持 1 MiB。支持幂等重放，未知源码/非固定 Git SHA 拒绝。先应用已有 multipart 补丁，再应用此补丁；原 multipart 补丁的源码保护会拒绝已有的额外图片补丁，因此不要事后重复运行旧 repair 脚本。

本地 `python3 scripts/newapi-media/yihong_image_response_test.py` 验证补丁重放/错误源码与实际门控分支的 Go 编译和 1/2/32 MiB 边界。未编译完整宿主或部署服务器；这些测试不能替代宿主包、Docker 和真实图片/账单验收。具体步骤与价格见 `docs/wiki/运维/易红官方文档复查与全模型计费-2026-10-13.md`。

### 用户实测 response exceeds size limit 后的一键修复

`repair-yihong-images.sh` 复用现有 multipart 修复的基线检查、数据库备份、镜像切换与失败回滚。接受运行中的 `rc40-local-media-ossdirect-multipart-20261009` 或已部署的 `rc40-local-media-ossdirect-yihong-images-20261013`，构建新 `rc40-local-media-ossdirect-yihong-images-20261016`。补丁能精确升级旧两型号白名单并重复执行；残缺或未知补丁拒绝。真实 rc.40 jsplugin + yihong 的 2 MiB 回归覆盖五个图片型号，同时验证其他插件和视频路径仍保持原上限；测试包失败即停止，不切换生产。只使用合成响应，无付费调用。

本地未连接成功生产 SSH，未编译/执行完整宿主包测试或部署；不要把脚本准备/隔离测试写成服务器已修复。操作见易红现行运维文档。
