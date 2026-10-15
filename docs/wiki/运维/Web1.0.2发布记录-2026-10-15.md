# Web 1.0.2 发布记录

> 用户授权：提升 Web 版本、提交、推送、发布。源码分支 `1001-shoujiweb`，不合并 `main`，不发布桌面 tag。

- 仅将 `package.json.webVersion` 从 `1.0.1` 提升为 `1.0.2`；桌面 `version=2.1.64` 与 Rust 版本文件不变。
- 交付：[[开发/Web统一创作Runtime与Wiki记忆查询TDD-2026-10-15]] 与 [[开发/Web桌面UI对齐TDD-2026-10-15]]。
- 验证：关键618/618；完整前端1553项中1550通过，3项为既有失败；本次升版后 Web quick build、类型检查、产物审计、UI合同4/4与差异检查通过。完整回归不登记为全绿。
- 发布方式：当前分支提交推送到 `origin/1001-shoujiweb`，使用现有 Cloudflare Pages `jiucaihezi` 项目的 Production 环境部署 Web `dist/`。Pages 的生产分支参数不修改 Git `main`。
- 状态：已提交、推送并发布 Production，正式域名复检通过。首轮命令行直连超时，改用系统已有 `127.0.0.1:7897` 代理；Git 使用 HTTP/1.1 后推送成功，不修改凭据或系统网络配置。
- 未验收真实生成、新渠道/计费、远程 MCP OAuth、原生平台、手机与用户数据升级。

## 发布回执与线上复检

- 发布源码提交：`cf6441cc7824281b12031ce5704bdae4e8a1143e`，已推送 `origin/1001-shoujiweb`，同时包含此前 `9b4b36b7` 的 Web Runtime 提交；Git `main` 未修改。
- 执行现有 `wrangler pages deploy dist --project-name=jiucaihezi --branch=main --commit-hash=cf6441cc7824281b12031ce5704bdae4e8a1143e`。首轮一个上传批次挂起，停止后重试；第二轮返回 Uploaded 92 files（294 already uploaded）与 Deployment complete。
- 部署 ID：`09463179-7c2e-42e0-b45c-2f72e8ef800d`；Pages 列表确认为 `Production / main / cf6441c`。
- 正式入口：[官网](https://jiucaihezi.studio/)、[Web 工作台](https://jiucaihezi.studio/try/)。临时部署地址 `https://09463179.jiucaihezi.pages.dev` 受 Cloudflare Access 保护，未尝试绕过；正式域名可公开访问。
- 正式域名 5 项内容 SHA-256 与本地构建全部一致：
  - `/`：`3594bd9acb56c480fea4dea7029f897d4ed235f9d168a72d3374f8afa93b9b10`
  - `/try/`：`2e993c08fa5de16beea19fddd795ff8ba50fce978b4f8836679df9b4abd5e3f3`
  - `/assets/try-BHiMu4eS-jc20260610b.js`：`1dd62852e3b0d002d0c14b442a4e36b3cdae5702c93999e2c69bcccff3191e4d`，含 `Web 1.0.2`
  - `/skills/manju-route.json`：`fb7964a53a5a010a410ff1005e099f536a32ad8478fd20a467d59cce3fb908d8`
  - `/skills/wiki-artifacts.json`：`8cb3f4bf22f194522ba321e5e7400ec03f6442e98d57cf327b4df8020edfa1e5`
- 上一 Production 部署保留为 `091fb62c-ef2a-498c-b539-992cde3512c7`（源码 `05fe2bc`）；本轮未执行回滚、桌面 tag 或后端发布。
