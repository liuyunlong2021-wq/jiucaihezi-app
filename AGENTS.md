# 韭菜盒子 Studio — AI 协作者手册

> **最后更新**: 2026-07-12 · **分支**: `0711-canvas` · **版本**: v1.2.6-dev

### 🔰 项目作者必读
**📖 [AI 编程生存手册](docs/wiki/学习/AI编程生存手册.md)** — 23 条常识，用本项目真实 bug 解释。
每修一个 bug，AI 在 commit 标注「涉及常识 #N」。翻手册对应条目，一年后你就是最懂编程的产品经理。

### 翻译方针
**韭菜盒子 Desktop = OpenCode Desktop 的 Tauri + Vue 语法翻译版+创作面板+skill仓库+newapi后端。** 不自创，不简化，不添加。
- 对照表: `docs/wiki/架构/对照表.md`
- 事实源: `/Users/by3/Documents/jiucaihezi-opencode/packages/desktop/src/`
- 📚 Wiki 首页: `docs/wiki/CLAUDE.md` · 🔥 热缓存: `docs/wiki/hot.md`
- 🧠 方法论: `CLAUDE.md` — 怎么修 bug（先审根因再修症状）

---

## 文档索引（渐进式披露 — 需要什么点什么）

| 你要什么 | 去这 |
|----------|------|
| 编程常识学习 | [AI 编程生存手册](docs/wiki/学习/AI编程生存手册.md) |
| 产品架构（双端/手机/存储/启动） | [产品架构](docs/wiki/架构/产品架构.md) |
| 历史改动记录 | [开发历史](docs/wiki/开发/开发历史.md) |
| OpenCode 差异 + 剩余问题 | [AI 交接手册](docs/wiki/开发/交接手册.md) |
| 画布架构、功能与排障 | [画布开发与排障](docs/wiki/开发/画布开发与排障.md) |
| 韭菜盒子↔OpenCode 文件映射 | [对照表](docs/wiki/架构/对照表.md) |
| 翻译方法论 | [翻译方案](docs/wiki/架构/翻译方针.md) |
| 发版前检查 | [审计清单](docs/wiki/开发/审计清单.md) |
| 服务器运维 | [运维手册](docs/wiki/运维/服务器运维.md) |
| RH 模型注册 | [模型注册手册](docs/wiki/运维/模型注册.md) |
| T8 图片异步下一阶段 | [交接文档](docs/wiki/运维/T8图片异步接入交接-2026-07-12.md) |

---

## 铁律（AI 每次遵守）

0. **翻译 OpenCode** — 对照表是唯一入口，不自创不简化不添加
1. **画布例外** — 先查 [LeaferJS](https://github.com/leaferjs/leafer)，没有才手写
2. **库优先** — 新功能先搜 npm/GitHub。反面教材: 手写 SSE → `@microsoft/fetch-event-source`
3. **CORS** — 本地用 `/__jc_api` proxy，不直连 `api.jiucaihezi.studio`
4. **跨平台** — M 芯片不是标准，Windows/Intel Mac 也要跑对
5. **媒体** — NewAPI 只透传 4 字段；媒体字节不进 SQLite
6. **commit 标注常识** — `涉及常识 #N`

---

## 关键文件（改之前读完上下文）

`useChat.ts`(对话核心) · `opencode.rs`(Rust进程) · `eventBridge.ts`(SSE桥) · `sessionStore.ts`(会话) · `newApiClient.ts`(登录) · `tauri.conf.json`(CSP)

---

## 命令

```bash
pnpm exec vue-tsc -b          # TS检查
cargo check --manifest-path src-tauri/Cargo.toml  # Rust检查
pnpm tauri dev                 # 桌面开发
pnpm tauri build               # 打包
git tag v1.2.4 && git push origin v1.2.4  # 发新版
```
