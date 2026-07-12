# OTA 自动更新 + 下载分发 — 完整设计文档

> **最后更新**: 2026-07-10
> **技术栈**: `tauri-plugin-updater` + 自建服务器 `api.jiucaihezi.studio` + CI `scp` 自动上传 + RSA 2048 签名
> **数据源**: `latest.json` 是唯一真相源，同时服务 OTA 更新和新用户下载
> **状态**: ✅ 全链路打通，已上线

---

## 1. 架构总览

```
开发者打 tag 推送 → GitHub Actions CI
  ├─ set-version --auto（同步版本号）
  ├─ tauri build（三平台）
  ├─ openssl RSA 签名
  ├─ scp 安装包 → api.jiucaihezi.studio:/opt/updates/{version}/
  └─ scp latest.json → api.jiucaihezi.studio:/opt/updates/
        ↓
【OTA 更新】
  APP 启动 → checkUpdate() → GET /updates/latest.json → 下载 → 验签 → 安装 → 重启

【新用户下载】
  点「下载APP」→ https://api.jiucaihezi.studio/download/
  → JS 读同源 /updates/latest.json → 渲染三个平台按钮 → 点即下载
```

---

## 2. 核心文件

| 层级 | 文件 | 作用 | 更新方式 |
|------|------|------|---------|
| Gateway Worker | `gateway/src/index.js` | `api.jiucaihezi.studio/` → 302 `/sign-in` | `pnpm wrangler deploy` |
| Nginx | `/etc/nginx/sites-enabled/api.jiucaihezi.studio.conf` | `/updates/`、`/download/`、logo 等 | `nginx -s reload` |
| 下载页 | `/opt/download/index.html` | 三平台下载按钮，读 `/updates/latest.json` | scp 上传 |
| Logo | `/opt/download/logo.svg` | 方形 viewBox 100×100 | 覆盖文件 |
| latest.json | `/opt/updates/latest.json` | CI 自动生成，含 version + platforms.*.url | CI scp |

## 3. 服务端目录

```
/opt/updates/
├── latest.json              ← APP 和下载页共同读取
└── 1.2.5/
    ├── 韭菜盒子_1.2.5_aarch64.dmg       # macOS ARM
    ├── 韭菜盒子_1.2.5_aarch64.dmg.sig   # RSA 签名
    ├── 韭菜盒子_1.2.5_x64.dmg           # macOS Intel
    ├── 韭菜盒子_1.2.5_x64.dmg.sig
    └── 韭菜盒子_v1.2.5_x64_windows_portable.zip

/opt/download/
├── index.html               ← 下载页（同源，零跨域）
└── logo.svg                 ← NewAPI 后台 logo
```

## 4. Nginx 关键配置

```nginx
location /updates/ {
    alias /opt/updates/;
    expires 1h;
    add_header Cache-Control "public, max-age=3600";
    add_header Access-Control-Allow-Origin *;    # 下载页可能来自不同域
}

location /download/ {
    alias /opt/download/;
}

location = /logo.svg  { alias /opt/download/logo.svg; }
location = /logo.png  { alias /opt/download/logo.svg; }
location /site-assets/ { alias /opt/new-api/static/; }
```

## 5. 下载链路

| 步骤 | 触发 | 跳转 |
|------|------|------|
| Web 版点「下载APP」 | `JcCloudLoginBox.vue` | `window.open('https://api.jiucaihezi.studio/download/')` |
| 桌面设置点下载 | `SettingsPanel.vue` `downloadApp()` | `openExternal('https://api.jiucaihezi.studio/download/')` |
| 版本更新弹窗 | `App.vue` `checkNewVersion()` | `window.open('https://api.jiucaihezi.studio/download/')` |
| 下载页渲染 | `/opt/download/index.html` | XMLHttpRequest → `/updates/latest.json` → 动态渲染三按钮 |

**无任何 GitHub Releases 引用。** 所有下载链走服务器直链。

## 6. 密钥管理（RSA 2048）

| 密钥 | 位置 | 用途 |
|------|------|------|
| `UPDATER_PRIVATE_KEY` | GitHub Secrets | CI 签名 |
| `src-tauri/updater_public.pem` | 嵌入 APP | 验签 |
| pubkey b64 | `tauri.conf.json` plugins.updater.pubkey | Tauri 插件读取 |

## 7. latest.json 格式

```json
{
  "version": "1.2.5",
  "pub_date": "2026-07-09T13:17:17Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://api.jiucaihezi.studio/updates/1.2.5/韭菜盒子_1.2.5_aarch64.dmg"
    },
    "darwin-x86_64": {
      "signature": "...",
      "url": "https://api.jiucaihezi.studio/updates/1.2.5/韭菜盒子_1.2.5_x64.dmg"
    }
    // Note: windows-x86_64 不在此 JSON 中，OTA 不支持 Windows portable zip
  }
}
```

## 8. 已知限制

- Windows 仅 portable zip，不支持 OTA（需 NSIS 安装器）
- macOS OTA 需用户手动确认安装（Tauri 限制）
- CI `publish-manifest` job 偶尔 GitHub runner 获取失败，重跑即可

