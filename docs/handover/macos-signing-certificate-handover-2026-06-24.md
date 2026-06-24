# macOS Developer ID 签名证书 — 交接文档

> **日期**: 2026-06-24 11:50
> **当前状态**: 🔴 卡在 .p12 导出（证书 + 私钥无法在钥匙串中形成 codesigning identity）
> **接手 AI**: 请完整阅读后再动手

---

## 一、已完成

| 项目 | 状态 | 详情 |
|------|:--:|------|
| Apple Developer 账号 | ✅ | liuyunlongsaner@gmail.com, Team ID: RXD4L9387J |
| Developer ID Application 证书 | ✅ | 新版证书 ID: `882DSS8XZB`，G2 Sub-CA，过期 2031-06-25 |
| 旧证书 | 🟡 | 3个旧证书在 Apple 后台（ID: 976YH7FRKL, G2MMHHGR94, 还有一个初始的），都不用管 |
| CSR + 私钥生成 | ✅ | 在本机通过 `openssl req` 生成，文件在 Desktop |
| .cer 下载 | ✅ | 已下载到 Desktop 和 Downloads |
| GitHub Actions workflow | ✅ | notarytool 公证步骤已存在（build.yml），条件守卫 `if: env.APPLE_APP_PASSWORD != ''` |
| GitHub Secrets | ❌ | 未设置（6个全缺，需要 .p12 base64 后才能设） |

## 二、当前卡点

**无法从钥匙串导出 .p12 文件**，具体表现：

1. `security find-identity -v -p codesigning` → **0 valid identities found**
2. 证书已导入钥匙串，但 macOS 无法将私钥与证书配对
3. `openssl pkcs12 -export` 生成的文件，`security import` 时报 **"MAC verification failed during PKCS12 import (wrong password?)"**
4. 尝试过的算法组合全部失败：SHA1+3DES, SHA256+AES256, 无密码, Python cryptography 库, legacy provider
5. Keychain Access 证书助理报错「在钥匙串中找不到指定的项」

## 三、Desktop 文件清单

```
~/Desktop/
├── developerID_application.cer          # 证书 (882DSS8XZB, G2 Sub-CA)
├── jiucaihezi-dev-key.pem               # RSA 2048 私钥
├── jiucaihezi-dev-csr.certSigningRequest # CSR（已上传到 Apple，生成了 882DSS8XZB）
├── jiucaihezi-dev-cert.pem              # 证书 PEM 格式（从 .cer 转换）
├── jc-final.p12                         # SHA256+AES256 PKCS12
├── jiucaihezi-dev-py.p12               # Python cryptography 库生成
├── jiucaihezi-dev-nopass.p12           # 无密码版本
└── jiucaihezi-nopass.p12               # 无加密版本
```

**验证**：.cer 和 CSR 公钥指纹一致（`281e1842c18a14c53338da252252ff4e8023d97a697969fc24744d548c569efc`），证明证书和私钥是配对的。

## 四、根因分析

**OpenSSL 3.6.2（本机版本）生成的密钥/PKCS12 与 macOS Security 框架不兼容。**

证据：
- OpenSSL 自身可以正常读取 p12（`openssl pkcs12 -info` 成功）
- 私钥有效（`openssl rsa -check` → "RSA key ok"）
- 但 `security import` 对所有 p12 变体均报 "MAC verification failed"
- 分开导入证书+私钥时，私钥 label 为 "Imported Private Key" 而非证书名，macOS 无法自动关联

本机环境：
- macOS + OpenSSL 3.6.2 (Homebrew)
- 未安装 Xcode 命令行工具中的旧版 OpenSSL

## 五、推荐解决方案（按优先级）

### 方案 A：用 Xcode 原生工具生成（⭐ 推荐）

如果本机装了 Xcode：

```bash
# Xcode 自带工具可以正确生成 CSR 并存入钥匙串
xcrun xcodebuild -create-xcframework ...
# 或者用 Xcode → Settings → Accounts → Manage Certificates
```

或在 Xcode 中：Settings → Accounts → 选 Apple ID → Manage Certificates → + → Developer ID Application

这会直接在钥匙串中创建正确的证书+私钥对，无需 OpenSSL。

### 方案 B：安装旧版 OpenSSL

```bash
brew install openssl@1.1
# 用旧版本创建 p12：
/opt/homebrew/opt/openssl@1.1/bin/openssl pkcs12 -export \
  -in ~/Desktop/developerID_application.cer \
  -inkey ~/Desktop/jiucaihezi-dev-key.pem \
  -out ~/Desktop/jc-old.p12 \
  -passout pass:jc2026 \
  -name "Developer ID Application: yunlong liu (RXD4L9387J)"

security import ~/Desktop/jc-old.p12 \
  -k ~/Library/Keychains/login.keychain-db \
  -P jc2026 \
  -T /usr/bin/codesign \
  -T /usr/bin/security
```

### 方案 C：用 Keychain Access 原生生成 CSR（之前报错需排查）

1. 先确保默认钥匙串是 login：
   ```bash
   security default-keychain -s ~/Library/Keychains/login.keychain-db
   security unlock-keychain ~/Library/Keychains/login.keychain-db
   ```
2. Keychain Access → 钥匙串访问 → 证书助理 → 从证书颁发机构请求证书
3. 填邮箱 + 名称，**勾选「存储到磁盘」+「让我指定密钥对信息」**
4. 密钥 2048 RSA
5. 保存 CSR 后用这个新 CSR 去 Apple 重新申请证书（第 4 个证书）
6. 下载 .cer，双击导入 → 私钥自动关联

### 方案 D：全新重来（终极方案）

1. 在 Apple Developer 后台删除所有旧 `Developer ID Application` 证书
2. 在 Keychain Access 中删除所有 "Developer ID" 和 "RXD4L9387J" 相关条目
3. 用方案 C 生成新 CSR
4. 去 Apple 创建新证书
5. 下载 .cer → 双击 → 自动生效

## 六、验收标准

成功标志：
```bash
security find-identity -v -p codesigning | grep "Developer ID"
# 应输出：
# 1) XXXXXXXX "Developer ID Application: yunlong liu (RXD4L9387J)"
```

然后在 Keychain Access 中右键证书 → 导出为 .p12 → base64 编码：
```bash
base64 -i ~/Desktop/DeveloperIDApplication.p12 | pbcopy
```

## 七、后续步骤（p12 就位后）

1. 设置 GitHub Secrets（6 个）：
   - `APPLE_CERTIFICATE` = p12 的 base64
   - `APPLE_CERTIFICATE_PASSWORD` = p12 密码
   - `APPLE_SIGNING_IDENTITY` = `Developer ID Application: yunlong liu (RXD4L9387J)`
   - `APPLE_TEAM_ID` = `RXD4L9387J`
   - `APPLE_ID` = `liuyunlongsaner@gmail.com`
   - `APPLE_APP_SPECIFIC_PASSWORD` = 从 appleid.apple.com 生成的 16 位密码

2. 修改 `src-tauri/tauri.conf.json`：`signingIdentity` 从 `"-"` 改为证书全名

3. 修改 `.github/workflows/build.yml`：tauri-action 步骤补回 `APPLE_CERTIFICATE` 等 env，并在之前加 `security import` 证书步骤（参考 tauri-action 官方文档）

4. 打 tag 推送触发 CI 构建

## 八、参考文件

| 文件 | 说明 |
|------|------|
| `CLAUDE.md` §16 | 发布流程 |
| `AGENTS.md` | 审查范围 |
| `docs/sdd/cross-platform-desktop-audit-shenji-sdd.md` §3.2 | macOS 签名公证方案 |
| `.github/workflows/build.yml` | CI workflow（notarytool 步骤已就位） |
| `src-tauri/tauri.conf.json` | `signingIdentity: "-"` 需修改 |

---

**祝顺利！核心记住一点：别用 OpenSSL 3.x 生成 p12，用 macOS 原生工具（Xcode / Keychain Access）生成密钥对。**
