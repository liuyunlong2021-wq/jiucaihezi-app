# rh-adapter 服务器部署成功经验手册

> 目的：记录 `/Users/by3/Documents/jiucaihezi-app-main/rh-adapter` 曾经成功部署到服务器的方式，后续迁移、重装、排障时按本文执行。
>
> 当前成功架构：NewAPI 负责用户鉴权和计费；`rh-adapter` 只做 RunningHub 协议翻译；公网只暴露 `/rh/tasks/` 轮询入口。
>
2026-06-21 经验更新：推荐将服务器 `/opt/rh-adapter` 初始化为 git 稀疏检出仓库，日常更新只需 `git pull` + `docker compose up -d --build`（见 §3.1）。"本地打包 -> 上传"方式降为备用方案（见 §3.2）。

## 1. 成功架构

```text
韭菜盒子客户端
  -> https://api.jiucaihezi.studio/v1/images/generations
  -> https://api.jiucaihezi.studio/v1/videos
  -> https://api.jiucaihezi.studio/v1/audio/speech
      -> NewAPI Custom Channel
          -> http://rh-adapter:8789 或 http://172.17.0.1:8789
              -> rh-adapter Docker
                  -> RunningHub 官方 API

客户端轮询
  -> https://api.jiucaihezi.studio/rh/tasks/{task_id}
      -> Nginx location /rh/tasks/
          -> http://172.17.0.1:8789/tasks/{task_id}
              -> rh-adapter 无状态查询 RunningHub
```

核心原则：

- `rh-adapter` 不加独立鉴权，NewAPI 承担鉴权、额度、计费。
- `rh-adapter` 不直接暴露公网端口，只绑定 `172.17.0.1:8789` 或 `127.0.0.1:8789`。
- 公网 Nginx 只代理 `GET /rh/tasks/`，用于任务轮询。
- 提交请求走 NewAPI，轮询走 `/rh/tasks/`，避免轮询重复计费。

## 2. 服务器目录

成功部署使用这些路径：

```text
/opt/rh-adapter
/opt/rh-adapter/.env
/opt/creation-models
/opt/creation-models/.env
/etc/nginx/sites-enabled/api.jiucaihezi.studio.conf
/etc/nginx/backups/
```

`/opt/rh-adapter/.env` 必须存在，部署脚本会拒绝在没有 `RUNNINGHUB_API_KEY` 的情况下覆盖部署。

示例：

```bash
RUNNINGHUB_API_KEY=你的 RunningHub API Key
RH_CUSTOM_AI_APPS=
LOG_LEVEL=debug
```

权限建议：

```bash
chmod 600 /opt/rh-adapter/.env
```

## 3. Docker 部署

仓库内成功配置在 [rh-adapter/docker-compose.yml](../rh-adapter/docker-compose.yml)：

```yaml
services:
  rh-adapter:
    build: .
    ports:
      - "172.17.0.1:8789:8789"
    environment:
      - RUNNINGHUB_API_KEY=${RUNNINGHUB_API_KEY}
      - RH_CUSTOM_AI_APPS=${RH_CUSTOM_AI_APPS:-}
      - LOG_LEVEL=debug
    restart: unless-stopped
```

重点是端口绑定：

```text
172.17.0.1:8789:8789
```

不要改成：

```text
8789:8789
0.0.0.0:8789:8789
```

否则未鉴权 adapter 会暴露到公网。

手动部署命令：

```bash
cd /opt/rh-adapter
docker compose build rh-adapter
docker compose up -d rh-adapter
docker compose ps rh-adapter
```

健康检查：

```bash
curl -fsS http://172.17.0.1:8789/health
curl -fsS http://172.17.0.1:8789/v1/models
```

成功状态示例：

```json
{"status":"ok","service":"rh-adapter","version":"0.1.0","models":24}
```

`models` 当前应为 `24`。如果不是 24，优先检查 `/opt/rh-adapter` 是否已经被最新本地包覆盖、`rh-adapter/src/models/mapping.py` 和 `rh-adapter/src/models/capabilities.json` 是否包含新增模型。

### 3.1 推荐方案：Git 稀疏检出（一次性初始化，之后只需 git pull）

> 2026-06-21 实测成功。一次初始化后，每次更新只需两条命令。

#### 一次性初始化

在服务器执行（只需做一次）：

```bash
cd /opt/rh-adapter

# 初始化 git，只拉取 rh-adapter 子目录（不拉整个仓库）
git init
git remote add origin https://github.com/liuyunlong2021-wq/jiucaihezi-app.git
git config core.sparseCheckout true
echo "rh-adapter/*" > .git/info/sparse-checkout

# 拉取代码
git pull origin media-creation-optimization --depth=1
```

> `.gitignore` 已排除 `.env`，`RUNNINGHUB_API_KEY` 不会被覆盖。

#### 日常更新

以后每次改完 rh-adapter 代码后，在服务器只需：

```bash
cd /opt/rh-adapter
git pull origin media-creation-optimization
docker compose up -d --build rh-adapter
```

验证：

```bash
docker compose logs rh-adapter --tail 3
curl -fsS http://172.17.0.1:8789/health
```

#### 单文件热修复（不改 git）

如果只改了 1-2 个文件，也可以直接 sed 改源码后重建，不走 git：

```bash
sed -i 's/原内容/新内容/' /opt/rh-adapter/src/xxx.py
docker compose up -d --build rh-adapter
```

#### 安全原则

服务器上的 git 仓库**只 pull、不 commit、不 push**。它只是获取代码的工具，不是开发环境。

### 3.2 备用方案：手动打包上传（无 git 时使用）

适用场景：服务器无法访问 GitHub，或无法初始化 git。

```text
本地终端不能稳定 SSH/SCP 到服务器，或只能通过云服务器控制台上传文件。
```

本地先生成部署包：

```bash
cd /Users/by3/Documents/jiucaihezi-app-main
tar --exclude='.venv' --exclude='__pycache__' --exclude='.pytest_cache' \
  -czf rh-adapter-update.tar.gz rh-adapter
```

然后通过可用方式把 `rh-adapter-update.tar.gz` 上传到服务器，例如云服务器控制台、面板文件上传、堡垒机文件传输等。不要依赖 `scp`，因为本地到服务器链路曾经多次不可用。

服务器执行：

```bash
cd /root
test -f rh-adapter-update.tar.gz

mkdir -p /tmp/rh-adapter-deploy
rm -rf /tmp/rh-adapter-deploy/rh-adapter
tar -xzf rh-adapter-update.tar.gz -C /tmp/rh-adapter-deploy

cd /opt/rh-adapter
cp -a .env /tmp/rh-adapter.env

rm -rf /opt/rh-adapter.new
mkdir -p /opt/rh-adapter.new
cp -a /tmp/rh-adapter-deploy/rh-adapter/. /opt/rh-adapter.new/
cp /tmp/rh-adapter.env /opt/rh-adapter.new/.env
chmod 600 /opt/rh-adapter.new/.env

mv /opt/rh-adapter /opt/rh-adapter.bak.$(date +%Y%m%d-%H%M%S)
mv /opt/rh-adapter.new /opt/rh-adapter

cd /opt/rh-adapter
docker compose build rh-adapter
docker compose up -d rh-adapter
sleep 3
curl -fsS http://172.17.0.1:8789/health
curl -fsS http://172.17.0.1:8789/v1/models
```

如果健康检查失败，回滚最近备份：

```bash
cd /opt
ls -dt rh-adapter.bak.* | head
rm -rf rh-adapter
mv "$(ls -dt rh-adapter.bak.* | head -1)" rh-adapter
cd /opt/rh-adapter
docker compose up -d --build rh-adapter
curl -fsS http://172.17.0.1:8789/health
```

本地临时包 `rh-adapter-update.tar.gz` 不要提交到 Git。

## 4. 一键更新部署脚本

仓库里已有服务器部署脚本：

```bash
scripts/rh-deploy/step4-server-deploy-and-check.sh
```

它做这些事：

1. 要求 root 权限。
2. 备份旧 `/opt/rh-adapter`。
3. 保留旧 `/opt/rh-adapter/.env`。
4. 复制当前仓库 `rh-adapter/` 到 `/opt/rh-adapter`。
5. 删除 `.venv`、`.pytest_cache`、`__pycache__`。
6. `docker compose build rh-adapter`。
7. `docker compose up -d rh-adapter`。
8. 安装 Nginx `/rh/tasks/` location。
9. 更新 NewAPI RH channel 的模型列表。
10. 执行服务检查。

用法：

```bash
sudo bash scripts/rh-deploy/step4-server-deploy-and-check.sh
```

如果要跑付费 smoke test，先设置：

```bash
export NEWAPI_TEST_TOKEN=你的测试 token
sudo -E bash scripts/rh-deploy/step4-server-deploy-and-check.sh
```

## 5. Nginx 轮询代理

成功配置只公开轮询入口：

```nginx
location /rh/tasks/ {
    limit_except GET { deny all; }
    proxy_pass http://172.17.0.1:8789/tasks/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
}
```

仓库有幂等安装脚本：

```bash
sudo python3 scripts/rh-deploy/install-nginx-rh-tasks.py
sudo nginx -t
sudo systemctl reload nginx
```

脚本会：

- 修改 `/etc/nginx/sites-enabled/api.jiucaihezi.studio.conf`。
- 自动备份到 `/etc/nginx/backups/`。
- 如果 `nginx -t` 失败，恢复原配置。
- 如果已经有 live `location /rh/tasks/`，不会重复插入。

验证：

```bash
curl -sS -i https://api.jiucaihezi.studio/rh/tasks/step4-check | head -n 20
```

`step4-check` 不是有效 task，返回 404 可以接受；关键是请求能打到 `rh-adapter`，不是 Nginx 404 或 502。

## 6. NewAPI Custom Channel 配置

后台新增 Custom Channel：

| 字段 | 值 |
|---|---|
| Type | Custom Channel |
| Proxy URL | `http://rh-adapter:8789` |
| Fallback Proxy URL | `http://172.17.0.1:8789` |
| Timeout | `30s` |
| Billing | 按次计费，每个模型单独设置价格 |

模型列表：

```text
rh-pro-image,rh-image-v2,rh-gpt2-image,rh-gpt2-text,z-image-turbo,rh-video-v31-fast,rh-seedance2-text-video,rh-seedance2-image-video,rh-seedance2-multimodal-video,rh-grok-text-video,rh-grok-image-video,rh-grok-video-edit,rh-aiapp-fast-digital-human,rh-aiapp-digital-human,rh-aiapp-director,rh-suno-v55-single,rh-suno-v55-custom,rh-suno-lyrics,rh-speech-hd,rh-speech-turbo,rh-music,rh-voice-clone,rh-aiapp-voice-clone,rh-aiapp-voice-design
```

按类型：

| 类型 | 模型 |
|---|---|
| 图片 | `rh-pro-image`, `rh-image-v2`, `rh-gpt2-image`, `rh-gpt2-text`, `z-image-turbo` |
| 视频 | `rh-video-v31-fast`, `rh-seedance2-text-video`, `rh-seedance2-image-video`, `rh-seedance2-multimodal-video`, `rh-grok-text-video`, `rh-grok-image-video`, `rh-grok-video-edit`, `rh-aiapp-fast-digital-human`, `rh-aiapp-digital-human`, `rh-aiapp-director` |
| 音频 | `rh-suno-v55-single`, `rh-suno-v55-custom`, `rh-suno-lyrics`, `rh-speech-hd`, `rh-speech-turbo`, `rh-music`, `rh-voice-clone`, `rh-aiapp-voice-clone`, `rh-aiapp-voice-design` |

配置参考文件：

- [scripts/rh-deploy/newapi-rh-channel.md](../scripts/rh-deploy/newapi-rh-channel.md)

## 7. 自建 RH AI App

自建模型需要两处同时登记：

1. `/opt/rh-adapter/.env` 里设置 `RH_CUSTOM_AI_APPS`。
2. NewAPI RH channel 模型列表追加同名模型 ID。

示例：

```bash
RH_CUSTOM_AI_APPS='[
  {
    "id": "rh-custom-demo",
    "label": "自建视频Demo",
    "output_type": "video",
    "webapp_id": "123456789"
  }
]'
```

规则：

- `output_type` 只能是 `image`、`video`、`audio`。
- `id` 不能覆盖内置模型。
- NewAPI channel 里必须追加同一个 `id`，否则客户端看不到或无法计费。

## 8. 验证命令

本机/服务器内网检查：

```bash
cd /opt/rh-adapter
docker compose ps rh-adapter
curl -fsS http://172.17.0.1:8789/health
curl -fsS http://172.17.0.1:8789/v1/models
```

公网轮询入口：

```bash
curl -sS -i https://api.jiucaihezi.studio/rh/tasks/step4-check | head -n 20
```

NewAPI 模型可见性诊断：

```bash
sudo bash scripts/rh-deploy/step4-newapi-diagnose.sh
```

关键模型存在性检查：

```bash
curl -fsS http://172.17.0.1:8789/v1/models | grep -E 'z-image-turbo|rh-gpt2-image|rh-seedance2-text-video'
```

参数透传日志检查：

```bash
cd /opt/rh-adapter
docker compose logs --since=5m rh-adapter | grep "IMAGE INPUT" | tail -10
```

成功时应能看到类似：

```text
IMAGE INPUT model=z-image-turbo aspect_ratio='9:16' size=None resolution='1k' lora=None output_format='png'
```

如果日志里 `aspect_ratio=None`、`resolution=None` 或 `output_format=None`，说明参数在到达 `rh-adapter` 前已经丢失。此时不要先改 NewAPI；先查客户端 `buildCurrentCreationParams()`、RunPlan、Runtime 请求体和 `extra_fields` 透传。

付费 smoke test：

```bash
export NEWAPI_TEST_TOKEN=你的测试 token
bash scripts/rh-deploy/step4-newapi-smoke.sh
```

`step4-newapi-smoke.sh` 会检查：

- `/v1/models` 是否包含 RH 模型。
- `rh-gpt2-text` 图片提交和 `/rh/tasks/{id}` 轮询。
- `rh-speech-turbo` 音频提交和轮询。
- `rh-grok-text-video` / `rh-grok-image-video` 视频提交和轮询。
- `rh-seedance2-*` 视频提交和轮询。
- `rh-gpt2-image` AI App 查询 `?ai_app=true`。

## 9. 常见故障

### 9.1 `/rh/tasks/{id}` 返回 Nginx 404

说明 Nginx location 没装上或装错 server block。

处理：

```bash
sudo python3 scripts/rh-deploy/install-nginx-rh-tasks.py
sudo nginx -t
sudo systemctl reload nginx
```

### 9.2 `/rh/tasks/{id}` 返回 502

说明 Nginx 能匹配 location，但后端 `172.17.0.1:8789` 不通。

检查：

```bash
cd /opt/rh-adapter
docker compose ps rh-adapter
docker compose logs --tail=100 rh-adapter
curl -fsS http://172.17.0.1:8789/health
```

### 9.3 NewAPI 看不到 RH 模型

检查 Custom Channel 模型列表是否包含完整 24 个模型。

可跑：

```bash
sudo bash scripts/rh-deploy/step4-newapi-diagnose.sh
```

### 9.4 NewAPI 返回渠道不可用

常见原因：

- RH Custom Channel 状态不是启用。
- 用户 token 所属 group 和 channel group 不匹配。
- channel `base_url` 写错，容器内无法解析 `rh-adapter`。
- NewAPI 后台未保存模型价格或模型列表。

如果 `http://rh-adapter:8789` 不通，Fallback 用：

```text
http://172.17.0.1:8789
```

### 9.5 RunningHub 报 API key 或余额错误

检查：

```bash
sudo grep RUNNINGHUB_API_KEY /opt/rh-adapter/.env
cd /opt/rh-adapter
docker compose restart rh-adapter
docker compose logs --tail=100 rh-adapter
```

RunningHub 余额不足时 adapter 会把上游错误转成可读错误。

### 9.6 AI App 轮询查不到结果

AI App 任务可能需要：

```text
/rh/tasks/{task_id}?ai_app=true
```

前端和 smoke 脚本里对 `rh-gpt2-image` 这类 AI App 模型要保留该查询参数。

### 9.7 部署后 `/health` 还是旧模型数

典型表现：

```text
{"status":"ok","service":"rh-adapter","version":"0.1.0","models":22}
```

原因通常是服务器 `/opt/rh-adapter` 没有被本地最新代码覆盖，或覆盖后没有重建 Docker 镜像。

处理：

```bash
grep -n "z-image-turbo" /opt/rh-adapter/src/models/mapping.py
grep -n "z-image-turbo" /opt/rh-adapter/src/models/capabilities.json
cd /opt/rh-adapter
docker compose build rh-adapter
docker compose up -d rh-adapter
curl -fsS http://172.17.0.1:8789/health
```

如果 `grep` 没有结果，说明上传/覆盖没成功，重新按“手动上传包部署”执行。

### 9.8 RunningHub 报缺少 `aspectRatio` / `outputFormat`

典型错误：

```text
field 'aspectRatio' is required, can not be empty
field 'outputFormat' is required, can not be empty
```

排查顺序：

1. 先直连 `rh-adapter` 验证 adapter 自身是否能接收字段。
2. 再看 `rh-adapter` 日志中的 `IMAGE INPUT`。
3. 如果直连 adapter 正常，但 APP 经 NewAPI 后字段为 `None`，查客户端 Runtime 是否把字段放进请求体和 `extra_fields`。
4. 如果 APP 请求体本身没有字段，查 `CreationModelSpec.fields` 是否被物化进 `buildCurrentCreationParams()`。

直连 adapter 测试：

```bash
curl -sS http://172.17.0.1:8789/v1/images/generations \
  -H 'Content-Type: application/json' \
  -d '{"model":"z-image-turbo","prompt":"test","aspectRatio":"9:16","resolution":"1k","outputFormat":"png"}'
```

预期返回 `task_id` 和 `processing`。再查日志：

```bash
cd /opt/rh-adapter
docker compose logs --since=2m rh-adapter | grep "IMAGE INPUT"
```

### 9.9 NewAPI 和 rh-adapter 分工混淆

RH 渠道的原则：

```text
NewAPI: 鉴权、计费、渠道转发
rh-adapter: RunningHub 官方 API / AI App 参数映射和任务提交
客户端 Runtime: 把 UI 参数准确提交到 NewAPI RH channel
```

不要为了 RH 参数问题直接改 NewAPI 源码或生产 NewAPI 容器。除非已经证明 NewAPI 自身转发逻辑存在不可绕过的问题，否则优先在客户端 Runtime 和 `rh-adapter` 中解决。

直连 NewAPI / T8 / 火山 / WorldRouter / 特朗普模型不经过 `rh-adapter`，不要把这些模型的问题归到 RH adapter。

### 9.10 本地旧 APP 测试无效

如果刚改了客户端 Runtime 或 UI 参数物化，但用户仍用旧打包 APP 测试，结果不会变化。

正确测试顺序：

```bash
cd /Users/by3/Documents/jiucaihezi-app-main
lsof -ti :1420 | xargs kill -9 2>/dev/null || true
pnpm run tauri:dev
```

只有改了 `rh-adapter/` 才需要重新部署服务器 adapter。只改前端 Runtime/UI 时，重启本地 dev APP 即可。

### 9.11 GitHub Push Protection 拦截

`docs/notes/` 里的官方示例也可能包含预签名 URL、`X-Tos-Credential`、`AWSAccessKeyId` 等字段，GitHub 会按密钥拦截 push。

提交前扫描：

```bash
rg -n --hidden --glob '!node_modules' --glob '!.git' \
  "AKIA[0-9A-Z]{16}|AKLT[A-Za-z0-9+/=_-]{20,}|X-Tos-Credential=[^&\\s<>]+|X-Tos-Signature=[^&\\s<>]+" .
```

处理原则：

```text
不要点 GitHub 的 allow secret。
把文档中的预签名 URL、AccessKey、Signature 替换为占位符。
如果密钥已经进入未推送 commit，重写本地未推送提交后再 push。
```

## 10. 成功经验总结

1. `rh-adapter` 要做成内部服务，不要公网暴露。
2. NewAPI 只负责提交、鉴权和计费；轮询不要走 NewAPI，避免重复计费。
3. `/rh/tasks/` 是公开轮询桥，只允许 GET。
4. 部署时一定保留 `/opt/rh-adapter/.env`，否则会丢 RunningHub API Key。
5. 模型列表必须前端、NewAPI、`rh-adapter/src/models/mapping.py` 三边一致。
6. `z-image-turbo` 是 RH 图片模型，必须出现在 NewAPI RH channel 列表里。
7. `rh-adapter` 是无状态查询，不需要内部任务缓存；客户端持久化 `task_id + pollUrl` 即可恢复轮询。
8. 每次更新后先跑 `/health`、`/v1/models`、`/rh/tasks/test`，再跑付费 smoke。
9. `/opt/rh-adapter` 不是 git 仓库；服务器更新以覆盖部署为准。
10. `models: 24` 是当前 RH adapter 部署成功的重要信号。
11. 参数准确比“能生成”更重要；比例、分辨率、输出格式等必须在日志和最终上游 payload 中可验证。

## 11. 相关文件

- [rh-adapter/README.md](../rh-adapter/README.md)
- [rh-adapter/docker-compose.yml](../rh-adapter/docker-compose.yml)
- [scripts/rh-deploy/step4-server-deploy-and-check.sh](../scripts/rh-deploy/step4-server-deploy-and-check.sh)
- [scripts/rh-deploy/install-nginx-rh-tasks.py](../scripts/rh-deploy/install-nginx-rh-tasks.py)
- [scripts/rh-deploy/newapi-rh-channel.md](../scripts/rh-deploy/newapi-rh-channel.md)
- [scripts/rh-deploy/step4-newapi-diagnose.sh](../scripts/rh-deploy/step4-newapi-diagnose.sh)
- [scripts/rh-deploy/step4-newapi-smoke.sh](../scripts/rh-deploy/step4-newapi-smoke.sh)
- [docs/sdd/rh-model-full-pipeline-sdd.md](sdd/rh-model-full-pipeline-sdd.md)
- [docs/handoff-codex-rh-step2.md](handoff-codex-rh-step2.md)
