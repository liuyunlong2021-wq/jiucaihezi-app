# OTA 自动更新 — 完整设计文档

> **目标**: 用户无需重新下载安装包，APP 内点击"更新"即可自动升级到新版本。
> **技术栈**: `tauri-plugin-updater` + 自建服务器 `api.jiucaihezi.studio` + CI `scp` 自动上传 + Ed25519 签名。
> **服务器已就绪**: Nginx `/updates/` location ✅ | CI SSH 密钥 ✅ | GitHub Secrets ✅

---

## 1. 方案选型

**选择: 自建服务器 `api.jiucaihezi.studio`**。

理由：香港服务器，大陆用户下载快；已有 Nginx，加一个 location 即可；已配置完毕。

| 组件 | 来源 | 用途 |
|------|------|------|
| `tauri-plugin-updater` | 官方插件 | APP 内检查/下载/安装更新 |
| `api.jiucaihezi.studio/updates/` | 自建 Nginx | 托管安装包 + latest.json |
| 公私钥对 (Ed25519) | `openssl` 生成 | 签名更新包，防篡改 |
| GitHub Secrets `DEPLOY_*` | CI | scp 上传安装包到服务器 |

---

## 2. 架构总览

```
开发者打 tag 推送 → GitHub Actions CI
  ├─ set-version --auto（同步版本号）
  ├─ tauri build（三平台）
  ├─ openssl 签名
  ├─ scp 安装包 → api.jiucaihezi.studio:/opt/updates/{version}/
  └─ scp latest.json → api.jiucaihezi.studio:/opt/updates/
        ↓
用户 APP 启动 → checkUpdate()
  → GET https://api.jiucaihezi.studio/updates/latest.json
  → 有新版本? → 下载 → 验签 → 安装 → 重启
```

---

## 3. 服务端（已完成）

### 3.1 服务器目录

```
/opt/updates/
├── latest.json              ← APP 每次启动读取
├── 1.2.4/
│   ├── 韭菜盒子_1.2.4_aarch64.dmg
│   ├── 韭菜盒子_1.2.4_aarch64.dmg.sig
│   ├── 韭菜盒子_1.2.4_x64.dmg
│   ├── 韭菜盒子_1.2.4_x64.dmg.sig
│   └── ...
└── 1.2.5/
    └── ...
```

### 3.2 Nginx 配置（已部署）

```nginx
location /updates/ {
    alias /opt/updates/;
    expires 1h;
    add_header Cache-Control "public, max-age=3600";
}
```

### 3.3 CI SSH 密钥（已配置）

GitHub Secrets:
- `DEPLOY_HOST` = `47.82.86.196`
- `DEPLOY_USER` = `root`
- `DEPLOY_SSH_KEY` = Ed25519 私钥

### 3.4 旧版清理

CI 上传完新版后，保留最新 5 版，删更老的：

```bash
ssh -i /tmp/deploy_key -o StrictHostKeyChecking=no \
  root@47.82.86.196 \
  "ls -d /opt/updates/*/ 2>/dev/null | sort -V | head -n -5 | xargs rm -rf"
```

**推荐: GitHub Releases**。

理由：
- 4 个安装包（macOS ARM/Intel, Windows, Linux portable）= 每个版本 ~100MB
- GitHub Releases 无限流量、免费
- CI 已经跑在 GitHub Actions，上传 Release 是现成的
- `tauri-plugin-updater` 原生支持从 GitHub Releases 拉取
- 后续需要国内加速再加 CDN 即可

### 技术组件清单

| 组件 | 来源 | 用途 |
|------|------|------|
| `tauri-plugin-updater` | 官方插件 | APP 内检查/下载/安装更新 |
| GitHub Releases | 免费 | 托管安装包 + 更新清单 JSON |
| 公私钥对 (Ed25519) | `openssl` 生成 | 签名更新包，防篡改 |
| `@tauri-apps/plugin-updater` | npm | 前端 JS API |

---

## 2. 架构总览

```
┌──────────────────────────────┐
│  开发者本地                   │
│  openssl genpkey             │
│  → private.pem (保密!)       │
│  → public.pem  (嵌入 APP)    │
└──────────┬───────────────────┘
           │ 私钥 → GitHub Secrets: UPDATER_PRIVATE_KEY
           │ 公钥 → src-tauri/updater_public.pem
           ▼
┌──────────────────────────────┐
│  GitHub Actions CI            │
│  1. git tag v1.2.4 → trigger │
│  2. set-version --auto       │
│  3. tauri build (三平台)     │
│  4. 用私钥签名每个安装包      │
│  5. 上传到 GitHub Releases   │
│  6. 生成 latest.json manifest│
└──────────┬───────────────────┘
           │ tauri-plugin-updater 自动读取
           ▼
┌──────────────────────────────┐
│  韭菜盒子 APP (客户端)        │
│  1. 启动 → checkUpdate()     │
│  2. 有新版? → 通知用户       │
│  3. 用户点"更新" → 下载     │
│  4. 下载完成 → 安装 → 重启   │
│  5. 公钥验签 → 防篡改        │
└──────────────────────────────┘
```

---

## 3. 服务端：GitHub Releases 作为更新服务器

### 3.1 发布物

每个版本在 GitHub Releases 上需要这些文件：

```
Release v1.2.4:
  ├── 韭菜盒子_1.2.4_aarch64.dmg          (macOS ARM)
  ├── 韭菜盒子_1.2.4_aarch64.dmg.sig       (签名)
  ├── 韭菜盒子_1.2.4_x64.dmg               (macOS Intel)
  ├── 韭菜盒子_1.2.4_x64.dmg.sig
  ├── 韭菜盒子_1.2.4_x64-setup.exe         (Windows)
  ├── 韭菜盒子_1.2.4_x64-setup.exe.sig
  ├── 韭菜盒子_1.2.4_x64-setup.nsis.zip.sig  (Windows NSIS 签名)
  ├── latest.json                          (更新清单)
  └── latest.json.sig                      (清单签名)
```

### 3.2 更新清单 JSON

APP 检查端点：`https://api.jiucaihezi.studio/updates/latest.json`

```json
{
  "version": "1.2.4",
  "notes": "修复登录持久化、消息输出对齐 OpenCode",
  "pub_date": "2026-07-09T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "url": "https://api.jiucaihezi.studio/updates/1.2.4/韭菜盒子_1.2.4_aarch64.dmg"
    },
    "darwin-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "url": "https://api.jiucaihezi.studio/updates/1.2.4/韭菜盒子_1.2.4_x64.dmg"
    },
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "url": "https://api.jiucaihezi.studio/updates/1.2.4/韭菜盒子_1.2.4_x64-setup.exe"
    }
  }
}
```

---

## 4. 客户端：tauri-plugin-updater

### 4.1 Tauri 配置

```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://api.jiucaihezi.studio/updates/latest.json"
      ],
      "pubkey": "<从 public.pem 提取的 base64>",
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

### 4.2 前端 (`src/composables/useUpdater.ts`)

```ts
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { ref } from 'vue'

export function useUpdater() {
  const updateAvailable = ref(false)
  const updateVersion = ref('')
  const updateNotes = ref('')
  const downloading = ref(false)
  const downloadProgress = ref(0)

  async function checkUpdate() {
    try {
      const update = await check()
      if (!update) return
      updateAvailable.value = true
      updateVersion.value = update.version
      updateNotes.value = update.body || ''
    } catch { /* 静默失败 */ }
  }

  async function downloadAndInstall() {
    try {
      const update = await check()
      if (!update) return
      downloading.value = true
      await update.downloadAndInstall((e) => {
        if (e.event === 'Progress') downloadProgress.value = Math.round((e.data.chunkLength / (e.data.contentLength || 1)) * 100)
        if (e.event === 'Finished') downloading.value = false
      })
      await relaunch()
    } catch { downloading.value = false }
  }

  return { updateAvailable, updateVersion, updateNotes, downloading, downloadProgress, checkUpdate, downloadAndInstall }
}
```

---

## 5. 密钥管理

### 5.1 生成（一次性）

```bash
openssl genpkey -algorithm Ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem
# 提取公钥 base64 填入 tauri.conf.json
cat public.pem | tail -n +2 | head -n -1 | tr -d '\n'
```

### 5.2 存放

| 密钥 | 位置 | 权限 |
|------|------|------|
| `private.pem` | GitHub Secrets `UPDATER_PRIVATE_KEY` | CI |
| `public.pem` | `src-tauri/updater_public.pem` | 嵌入 APP |
| pubkey b64 | `tauri.conf.json` | 配置 |

---

## 6. CI 集成

在 `build.yml` 的 `tauri build` 后加：

```yaml
      - name: Generate updater signatures
        if: startsWith(github.ref, 'refs/tags/v')
        env:
          UPDATER_PRIVATE_KEY: ${{ secrets.UPDATER_PRIVATE_KEY }}
        run: |
          echo "$UPDATER_PRIVATE_KEY" > /tmp/private.pem
          cd src-tauri/target/release/bundle
          for f in dmg/*.dmg nsis/*.exe; do
            [ -f "$f" ] && openssl dgst -sha256 -sign /tmp/private.pem -out "${f}.sig" "$f"
          done
          rm /tmp/private.pem

      - name: Upload to server
        if: startsWith(github.ref, 'refs/tags/v')
        env:
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
          DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
        run: |
          VERSION="${GITHUB_REF#refs/tags/v}"
          echo "$DEPLOY_SSH_KEY" > /tmp/deploy_key
          chmod 600 /tmp/deploy_key
          ssh -i /tmp/deploy_key -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} "mkdir -p /opt/updates/${VERSION}"
          cd src-tauri/target/release/bundle
          scp -i /tmp/deploy_key -o StrictHostKeyChecking=no dmg/*.dmg dmg/*.sig nsis/*.exe nsis/*.sig ${DEPLOY_USER}@${DEPLOY_HOST}:/opt/updates/${VERSION}/
          rm /tmp/deploy_key

      - name: Update latest.json
        if: startsWith(github.ref, 'refs/tags/v')
        env:
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
          DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
        run: |
          VERSION="${GITHUB_REF#refs/tags/v}"
          echo "$DEPLOY_SSH_KEY" > /tmp/deploy_key
          chmod 600 /tmp/deploy_key
          # 生成 latest.json 并上传
          cat > /tmp/latest.json << JSONEOF
          {
            "version": "$VERSION",
            "notes": "更新内容见 GitHub Releases",
            "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
            "platforms": {
              "darwin-aarch64": {
                "signature": "$(base64 < src-tauri/target/release/bundle/dmg/韭菜盒子_${VERSION}_aarch64.dmg.sig | tr -d '\n')",
                "url": "https://api.jiucaihezi.studio/updates/${VERSION}/韭菜盒子_${VERSION}_aarch64.dmg"
              },
              "darwin-x86_64": {
                "signature": "$(base64 < src-tauri/target/release/bundle/dmg/韭菜盒子_${VERSION}_x64.dmg.sig | tr -d '\n')",
                "url": "https://api.jiucaihezi.studio/updates/${VERSION}/韭菜盒子_${VERSION}_x64.dmg"
              },
              "windows-x86_64": {
                "signature": "$(base64 < src-tauri/target/release/bundle/nsis/韭菜盒子_${VERSION}_x64-setup.exe.sig | tr -d '\n')",
                "url": "https://api.jiucaihezi.studio/updates/${VERSION}/韭菜盒子_${VERSION}_x64-setup.exe"
              }
            }
          }
          JSONEOF
          scp -i /tmp/deploy_key -o StrictHostKeyChecking=no /tmp/latest.json ${DEPLOY_USER}@${DEPLOY_HOST}:/opt/updates/latest.json
          # 清理旧版本（保留最新 5 版）
          ssh -i /tmp/deploy_key -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} "ls -d /opt/updates/*/ 2>/dev/null | sort -V | head -n -5 | xargs rm -rf"
          rm /tmp/deploy_key
```

---

## 7. UI 交互

- APP 启动 3s 后自动检查 → 有新版本在 SettingsPanel 版本号旁显示 🟢
- SettingsPanel 底部加 `[检查更新]` 按钮
- 点击更新 → 下载进度条 → 完成后提示重启

---

## 8. 文件清单

| 文件 | 用途 | 状态 |
|------|------|:--:|
| `src-tauri/updater_public.pem` | Ed25519 公钥 | ⬜ |
| `src/composables/useUpdater.ts` | 检查/下载 composable | ⬜ |
| `src-tauri/tauri.conf.json` | `plugins.updater` 配置 | ⬜ |
| `src-tauri/Cargo.toml` | `tauri-plugin-updater` | ⬜ |
| `src/components/settings/SettingsPanel.vue` | 更新 UI 入口 | ⬜ |
| `.github/workflows/build.yml` | 签名 + scp 上传 | ⬜ |
| 服务器 `/opt/updates/` | 安装包存储 | ✅ |
| 服务器 Nginx `/updates/` | 静态文件服务 | ✅ |
| GitHub Secrets `DEPLOY_*` | CI SSH 凭据 | ✅ |
