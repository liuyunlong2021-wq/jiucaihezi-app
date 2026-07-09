# OTA 自动更新 + 下载分发 — 完整设计文档

> **目标**: 用户无需重新下载安装包，APP 内点击"更新"即可自动升级；新用户从首页/设置页下载也走同一服务器。
> **技术栈**: `tauri-plugin-updater` + 自建服务器 `api.jiucaihezi.studio/updates/` + CI `scp` 自动上传 + Ed25519 签名。
> **数据源**: `latest.json` 是唯一真相源，同时服务 OTA 更新和新用户下载。
> **服务器已就绪**: Nginx `/updates/` ✅ | CI SSH 密钥 ✅ | GitHub Secrets ✅
> **状态**: 代码已实现，CI 签名+scp 已验证通过，publish-manifest 待 GitHub runner 恢复后验证

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

新用户下载（首页/设置面板"下载APP"按钮）:
  → GET latest.json → 取 platforms.*.url → 渲染下载链接
  → macOS ARM / macOS Intel / Windows 三个按钮各指各的
```

### latest.json 双用途

同一个 JSON，两类消费者：

| 消费者 | 用哪些字段 | 场景 |
|--------|-----------|------|
| `tauri-plugin-updater` | `version`, `platforms.{arch}.signature`, `platforms.{arch}.url` | APP 内 OTA |
| 首页/设置面板 | `version`, `platforms.{arch}.url` | 新用户下载 |

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

### 3.4 下载分发

`latest.json` 同时服务两类消费者：

| 消费者 | 场景 | 代码 |
|--------|------|------|
| `tauri-plugin-updater` | APP 内 OTA 更新 | Rust 插件自动读 |
| 首页 `landing/index.html` | 新用户下载 | JS fetch → 动态填充下载按钮 |
| `JcCloudLoginBox.vue` | 设置面板分享 | 跳转首页（首页按钮已动态化） |

首页下载按钮带 `data-platform` 属性（`darwin-aarch64` / `darwin-x86_64` / `windows-x86_64` / `auto`），JS 从 `latest.json` 读取对应 URL。如果服务端不可用，fallback 到 GitHub Releases 链接。

### 3.5 仓库私有化前的引导步骤

CI 上传完新版后，保留最新 5 版，删更老的：

```bash
ssh -i /tmp/deploy_key -o StrictHostKeyChecking=no \
  root@47.82.86.196 \
  "ls -d /opt/updates/*/ 2>/dev/null | sort -V | head -n -5 | xargs rm -rf"
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
| `src-tauri/updater_public.pem` | RSA 2048 公钥 | ✅ |
| `src/composables/useUpdater.ts` | 检查/下载 composable | ✅ |
| `src-tauri/tauri.conf.json` | `plugins.updater` 配置 | ✅ |
| `src-tauri/Cargo.toml` | `tauri-plugin-updater` | ✅ |
| `src-tauri/src/lib.rs` | 注册 updater 插件 | ✅ |
| `src-tauri/capabilities/default.json` | updater/process 权限 | ✅ |
| `src/components/settings/SettingsPanel.vue` | 更新 UI 入口 | ✅ |
| `.github/workflows/build.yml` | 签名 + scp 上传 + manifest | ✅ |
| `scripts/set-version.mjs` | --auto 模式 + Windows 路径修复 | ✅ |
| 服务器 `/opt/updates/` | 安装包存储 | ✅ |
| 服务器 Nginx `/updates/` | 静态文件服务 | ✅ |
| GitHub Secrets `DEPLOY_*` | CI SSH 凭据 | ✅ |
| GitHub Secrets `UPDATER_PRIVATE_KEY` | RSA 签名密钥 | ✅ |

---

## 9. 审计注意点

| 问题 | 等级 | 说明 |
|------|:--:|------|
| **latest.json 多平台合并** | 🔴 | 当前每个平台 job 各自生成 latest.json 并 scp。三个 job 并行时最后一个会覆盖前两个。**修复**: 改成一个独立 `publish-manifest` job，等三个构建全部完成后统一生成。 |
| `base64` 跨平台 | 🟡 | macOS runner 用 `base64 < file` 即可，如果某个 job 跑在 Linux 上需改为 `base64 -w0 < file` |
| DMG 公证 | 🟡 | 未公证的 DMG 在 macOS 上会被 Gatekeeper 拦截，CI 需加 notarize 步骤或让用户右键打开 |
| scp 通配符 | 🟢 | `dmg/*.dmg` 在 CI 中需要 `shopt -s globstar` 或改用 for 循环 |
