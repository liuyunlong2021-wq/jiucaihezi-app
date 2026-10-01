# NewAPI 任务插件（NewAPI Task Plugins）

本目录存放**要给 NewAPI 上传的插件**（v1 契约，单文件同步 ES module）。
用途见 [[运维/适配器收编任务插件总方案-2026-10-01]]：把「每个线路一个独立 Python 服务」改成「NewAPI 里一个单文件插件」。

## 约定

| 约定 | 说明 |
|---|---|
| 文件名 | `<key>.plugin.js`，`key` 与 `meta.key` 一致 |
| 不含密钥 | 密钥只进渠道（宿主通过 `ctx.apiKey` 给插件），源码与仓库里**不得**出现任何 token |
| 事实源 | 插件顶上注明它取代哪个适配器；翻译逻辑以那个适配器为准 |
| 单文件 | 官方只收单文件（`icon.svg`/`icon.png` 可选作 sidecar），不允许 import / `fetch` / 文件系统 |

## 现有插件

| 文件 | key | 取代 | 状态 |
|---|---|---|---|
| `boluo.plugin.js` | `boluo` | `boluo-minimax-adapter` | 代码已就绪，**未上传、未验收** |
| `comfy.plugin.js` | `comfy` | 不取代（`comfy-adapter` 是执行器，插件只代理它） | 代码已就绪，**未上传** |
| `dola.plugin.js` | `dola` | 不取代（`dola-seedance-adapter` 是执行器：上游只吃 multipart，插件拿不到图片字节） | 代码已就绪，**未上传** |
| `rh.plugin.js` | `rh` | 不取代（`rh-adapter` 是执行器：AI App 媒体要换 RH `fileName` 令牌） | 代码已就绪，**未上传**；接 35 个模型（含 4 个 AI App 视频） |

## 本地验证

夹具是纯 Node 测试（不需要 NewAPI）：

```bash
node --test newapi-plugins/__tests__/<key>.test.mjs
```

`newapi-plugins/__tests__/*.test.mjs` 已接入 `scripts/run-focused-tests.mjs` 的 `externalNodeTests`，
所以 `pnpm run test:focused` 会一起跑。

官方另外提供更强的校验（装包后可用）：`new-api plugin lint <file>`、`new-api plugin test <file> --fixture golden.json`，
管理员页还有 Sandbox 可对单个 hook 干跑（不触上游）。

## 上传

管理员页插件页上传，或：

```bash
curl -X POST <NewAPI>/api/plugin/task \
  -H "Authorization: Bearer <root token>" \
  -H "Content-Type: application/json" \
  -d '{"source":"<plugin.js 内容>","remark":"..."}'
```

上传后需要为它建一个 **type 61「Task Plugin」渠道**（选 plugin key、填 Base URL 与密钥）。
