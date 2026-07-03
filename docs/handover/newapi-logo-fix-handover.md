# NewAPI logo 修复 — 交接文档

> **最后更新**: 2026-07-01 22:00
> **状态**: 未完成，需要换工具继续
> **服务器**: 47.82.86.196，/root/new-api-new

---

## 目标

修改 NewAPI（api.jiucaihezi.studio）的前端三处：

| 改动 | 文件 | 内容 |
|------|------|------|
| 左上角 logo 完整显示 | `web/public/logo.svg` | 去掉 `width="80" height="80"`，只保留 `viewBox="0 0 100 60"` |
| logo 容器适配 5:3 比例 | `web/src/.../headerbar/HeaderLogo.jsx` | `w-8 h-8` → `w-12 h-7 md:w-14 md:h-8` |
| 社交媒体 OG 标签 | `web/index.html` | 新增 og:title/description/image/url 等 meta 标签 |
| 文字替换 | `web/src/helpers/utils.jsx` + `Footer.jsx` | `New API` → `韭菜盒子` |

以上改动**均已在本地完成并验证通过**（`bun run build` 成功）。

---

## 失败原因

NewAPI 前端用 Docker 多阶段构建，前端文件编译进 Go 二进制。`docker cp` 无效，必须重新构建 Docker 镜像。

服务器上 `docker build` 完整构建约需 15-20 分钟（4vCPU），且第一次 context 传输 3.27GB。期间 `api.jiucaihezi.studio` 不受影响（构建不中断运行中的容器）。

**当前已中断**，docker-compose.yml 中 `image:` 已恢复为 `calciumion/new-api:latest`。

---

## 已完成步骤

1. 本地 `bun run build` → 生成 `web/dist/` ✅
2. 本地打包 `newapi-web-fix.tar.gz` ✅
3. 上传到服务器 `/root/` ✅
4. 解压到 `/root/new-api-new/web/dist/`（覆盖旧的） ✅
5. `docker build` 在服务器上卡住 → **Ctrl+C 中断** ❌

---

## 推荐方案

### 方案 A：本地 Mac 构建镜像 + 传到服务器（最快，~10 分钟，零风险）

```bash
# ===== 本地 Mac =====
cd /Users/by3/Documents/搭子Studio桌面版/MYnewapi

# 1. 前端已构建过，直接打包镜像
docker build -t jiucaihezi-new-api:latest .

# 2. 导出镜像
docker save jiucaihezi-new-api:latest | gzip > /tmp/jiucaihezi-new-api.tar.gz

# 3. 上传到服务器 /root/（用你的方式）
```

```bash
# ===== 服务器 =====
cd /root

# 4. 加载镜像
docker load < jiucaihezi-new-api.tar.gz

# 5. 修改 docker-compose.yml
cd /root/new-api-new
sed -i 's|image: calciumion/new-api:latest|image: jiucaihezi-new-api:latest|' docker-compose.yml

# 6. 部署（秒级）
docker compose up -d --force-recreate new-api
```

**回滚**：`sed -i` 改回 `calciumion/new-api:latest`，再跑第 6 步。

### 方案 B：服务器上后台构建 + 等待（简单但慢）

```bash
cd /root/new-api-new
nohup docker build -t jiucaihezi-new-api:latest . > /tmp/build.log 2>&1 &
# 等待 20 分钟
tail -f /tmp/build.log  # 看进度
# 构建完成后：
sed -i 's|image: calciumion/new-api:latest|image: jiucaihezi-new-api:latest|' docker-compose.yml
docker compose up -d --force-recreate new-api
```

---

## 改动文件清单

本地 Mac 路径 `/Users/by3/Documents/搭子Studio桌面版/MYnewapi/web/`：

| 文件 | 改动 |
|------|------|
| `public/logo.svg` | 去掉 width/height 属性 |
| `src/components/layout/headerbar/HeaderLogo.jsx` | 容器 className 改宽 |
| `index.html` | 新增 OG meta 标签 |
| `src/helpers/utils.jsx` | `'New API'` → `'韭菜盒子'` |
| `src/components/layout/Footer.jsx` | `New API` → `韭菜盒子` |

---

## 数据安全说明

PostgreSQL 用户/渠道/余额数据在独立容器 + `pg_data` 数据卷中，重建 NewAPI 镜像不影响任何业务数据。
