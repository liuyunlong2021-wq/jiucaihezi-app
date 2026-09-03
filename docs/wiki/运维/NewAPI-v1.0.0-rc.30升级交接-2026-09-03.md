# NewAPI v1.0.0-rc.30 升级交接

> 日期：2026-09-03
> 目标：将生产 NewAPI 从 `v1.0.0-rc.20` 升级到官方 `v1.0.0-rc.30`。
> 状态：部署升级已完成；截图已确认版本、镜像摘要、健康接口和线上请求正常。
> 重要：本页不包含任何 API Key、用户 Token、数据库密码或上游凭据。

## 1. 生产事实

- 服务器：`47.82.86.196`
- NewAPI 目录：`/root/new-api-new`
- Compose：`/root/new-api-new/docker-compose.yml`
- PostgreSQL 容器：`postgres`
- 实际数据库用户：`newapi`
- 数据库名：`new-api`
- 官方仓库：[QuantumNous/new-api](https://github.com/QuantumNous/new-api)
- 旧运行镜像：`calciumion/new-api:latest`
- 旧镜像摘要：`sha256:6da2278e7f28109043375e373546efdfb96d9a60d82a46f039d0a81499ec8cd3`
- 目标镜像：`calciumion/new-api:v1.0.0-rc.30`
- 目标镜像摘要：`sha256:94e853de615144b7dd809583ef96434b5539f52072b6e96c6e53354fa422a871`

## 2. 已完成

1. 新建备份目录：`/root/newapi-upgrade-20260903-124252`
2. 数据库导出成功：`/root/newapi-upgrade-20260903-124252/new-api.sql`，大小约 `1.1G`。
3. 已备份 `docker-compose.yml` 和 `/etc/nginx/sites-enabled/api.jiucaihezi.studio.conf`。
4. 已生成 SHA-256：
   - `new-api.sql`：`17edcda561223109c396037800be0930f42bdf54d9d59f1432494a2c508d49df`
   - `docker-compose.yml`：`4ff9a03658ba3652c08d6556386bd567614555eb38be61b3835857df182e27f6`
   - Nginx 配置：`7121add5617bcce29fc330035cc3d0850d3964aecb705841b1acefd3dcfae7a9`
5. 已建立旧版回滚标签：`jiucaihezi/new-api:rollback-rc20`。
6. 已拉取官方目标镜像 `calciumion/new-api:v1.0.0-rc.30`。
7. 已将 Compose 固定为 `v1.0.0-rc.30`，`docker compose config` 校验通过。

## 3. 本次升级结果

- 2026-09-03 13:32 后台显示当前版本：`v1.0.0-rc.30`。
- `docker inspect new-api` 显示目标镜像摘要：`sha256:94e853de615144b7dd809583ef96434b5539f52072b6e96c6e53354fa422a871`。
- `/api/status` 返回成功，响应中的版本为 `v1.0.0-rc.30`。
- 启动日志显示批处理完成、管理后台请求为 `200`、聊天和 Responses 请求为 `200`。
- 结论：NewAPI 容器升级成功，当前生产服务已运行在 `rc.30`。
- 仍需按业务需要继续观察 Opus 工具调用、媒体任务和计费；截图本身不替代这些专项验收。

## 4. 标准升级流程（下次使用）

按顺序执行，每一步完成后再执行下一步。不要使用 `git pull` 作为生产升级方式；生产容器使用 Docker 镜像，服务器 Git 工作树没有挂载进容器。

### 4.1 重建 NewAPI

```bash
cd /root/new-api-new
docker compose up -d --no-deps --force-recreate new-api
```

`--no-deps` 表示不重启 PostgreSQL、Redis 或其他适配器。该步骤会短暂重启 NewAPI，并可能执行数据库迁移。

### 4.2 查看容器状态和启动日志

```bash
cd /root/new-api-new
docker compose ps new-api
docker compose logs --tail=120 new-api
```

通过条件：`new-api` 为 `Up`，没有持续重复的数据库迁移错误、panic 或连接错误。

### 4.3 确认运行版本和健康状态

```bash
docker inspect new-api --format 'image={{.Config.Image}} image_id={{.Image}}'
curl -fsS https://api.jiucaihezi.studio/api/status
```

目标镜像 ID 应对应目标摘要；健康接口返回成功。

### 4.4 最低功能验收

依次验证：

1. 浏览器可打开 NewAPI 登录页并能登录管理后台。
2. `GET /v1/models` 携带工作台 Token 返回模型列表。
3. 普通文本聊天成功。
4. 使用 `summary + keywords` 工具调用的 Opus 摘要请求成功，`tool_calls[0].function.arguments` 是合法 JSON。
5. 一条现有媒体任务链路成功（只验证已有业务，不修改渠道）。
6. 用户余额、渠道、Token 和历史调用记录仍存在。

可用的模型列表检查：

```bash
curl -fsS https://api.jiucaihezi.studio/v1/models \
  -H 'Authorization: Bearer <工作台Token>'
```

不要把真实 Token 写入 Wiki、聊天记录或命令历史截图。

## 5. 失败处理与回滚

### 4.1 仅二进制/启动问题：优先回滚镜像

```bash
cd /root/new-api-new
sed -i 's#calciumion/new-api:v1.0.0-rc.30#jiucaihezi/new-api:rollback-rc20#' docker-compose.yml
docker compose config >/dev/null
docker compose up -d --no-deps --force-recreate new-api
docker compose ps new-api
```

### 4.2 配置回到升级前

只有确认需要恢复 Compose 时执行：

```bash
cp -a /root/newapi-upgrade-20260903-124252/docker-compose.yml \
  /root/new-api-new/docker-compose.yml
cd /root/new-api-new
docker compose up -d --no-deps --force-recreate new-api
```

### 4.3 数据库恢复边界

不要因为普通启动错误立刻恢复数据库。只有新版已执行迁移且旧版无法使用，并确认必须回到升级前数据库时，才在停止 NewAPI 后恢复。恢复会覆盖当前数据库，属于破坏性操作，必须先再次确认备份文件路径和用户意图。

## 6. 本次关键判断

- NewAPI 官方仓库源码不是当前生产容器的直接运行来源。
- `git pull` 只能更新服务器工作树；若 Compose 没有 `build:` 且没有源码挂载，重启容器不会加载新代码。
- 正确生产升级路径是固定官方 Docker 镜像版本，再只重建 `new-api`。
- Compose 中显示 `POSTGRES_USER=root` 不代表数据库角色是 `root`；现有生产库实际使用 `newapi`。之前备份失败的根因就是误用 `-U root`。
- 当前磁盘升级前余量约 `14G`，不要执行 `docker system prune`，也不要删除旧镜像和备份。

## 7. 交接给其他 AI 的最小上下文

```text
我要把生产 NewAPI 从 v1.0.0-rc.20 升级到 v1.0.0-rc.30。
服务器目录：/root/new-api-new
Compose 已固定：calciumion/new-api:v1.0.0-rc.30
旧版回滚标签：jiucaihezi/new-api:rollback-rc20
数据库容器：postgres；数据库用户：newapi；数据库名：new-api
备份目录：/root/newapi-upgrade-20260903-124252
数据库备份：/root/newapi-upgrade-20260903-124252/new-api.sql（约 1.1G）
已完成容器重建；当前版本已确认。
下一次升级按“备份 -> 固定版本 -> 只重建 new-api -> 健康和业务验收”执行。
cd /root/new-api-new
docker compose ps new-api
docker compose logs --tail=120 new-api
然后检查 /api/status、/v1/models、普通聊天和 Opus summary+keywords 工具调用。
不要 git pull 作为升级，不要重启 postgres/redis，不要删除备份或旧镜像。
```
