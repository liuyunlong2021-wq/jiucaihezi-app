# SDD: RH 生成结果 CDN CSP 与本地缓存修复

> 状态：待实施
> 日期：2026-06-09
> 范围：创作面板 / 媒体任务结果缓存 / Tauri CSP / RH 输出 CDN
> 目标：RH 图片/视频生成成功后，结果 URL 能稳定保存到本地画廊，不再因 `webstatic.aiproxy.vip` 被 CSP 拦截而显示失败。

---

## 0. 背景与现象

用户在创作面板使用 RH 渠道生成图片时，后台日志显示：

```text
GET https://api.jiucaihezi.studio/rh/tasks/2064258177071190017
response status: 200
response data keys: Array(4)
data[0]: {"revised_prompt":"...","url":"https://webstatic.aiproxy.vip/output/20260609/...png"}

Connecting to 'https://webstatic.aiproxy.vip/output/...png' violates the following Content Security Policy directive:
"connect-src 'self' data: blob: https://api.jiucaihezi.studio ..."

Fetch API cannot load https://webstatic.aiproxy.vip/output/...png.
Refused to connect because it violates the document's Content Security Policy.
```

这说明：

1. RH 任务提交成功。
2. `/rh/tasks/:id` 轮询成功。
3. 上游已经返回可用媒体 URL。
4. 失败发生在前端下载该媒体 URL 进行本地缓存时，不是 RH 渠道没有生成。

---

## 1. 当前调用链

```text
CreationPanel
  -> mediaTaskStore.submitTask()
  -> generateImage() / generateVideo()
  -> api.jiucaihezi.studio /rh/submit 或 /v1/images/generations
  -> pollTask('/rh/tasks/:id')
  -> 返回 https://webstatic.aiproxy.vip/output/...
  -> addSettledCreationTaskToGallery()
  -> cacheCreationMediaResult()
  -> fetchMediaAsDataUrl()
  -> fetch(url) 或 Tauri http_download_base64
  -> fileStore.addMedia()
```

关键文件：

| 文件 | 责任 |
|---|---|
| `src/components/creation/CreationPanel.vue` | 任务完成后把成功结果加入画廊，并调用 `cacheCreationMediaResult()` |
| `src/stores/mediaTaskStore.ts` | 统一媒体任务状态机，成功后校验结果 URL 并广播 settled 事件 |
| `src/api/media-generation.ts` | RH 任务提交、轮询、结果 URL 提取 |
| `src/utils/creationMediaCache.ts` | 下载远端结果，转成本地媒体文件引用 |
| `src/utils/urlSafety.ts` | 结果 URL 安全白名单 |
| `src-tauri/tauri.conf.json` | WebView CSP，控制浏览器 `fetch` 可连接域名 |

---

## 2. 根因

### 2.1 URL 安全白名单与 CSP 不一致

`src/utils/urlSafety.ts` 已允许 `aiproxy.vip`：

```ts
/(^|\.)aiproxy\.vip$/i
```

但 `src-tauri/tauri.conf.json` 的 `connect-src` 没有允许：

```text
https://*.aiproxy.vip
```

所以 URL 安全检查通过，但 WebView 的 CSP 阻止了后续 `fetch()` 下载。

### 2.2 `img-src` 允许展示，不等于 `connect-src` 允许下载

当前 CSP 中：

```text
img-src 'self' data: blob: https:;
```

这意味着 `<img src="https://webstatic.aiproxy.vip/...">` 可以展示。

但创作面板不是只展示远端图，而是要下载并缓存到本地画廊：

```text
fetch("https://webstatic.aiproxy.vip/output/...")
```

`fetch()` 受 `connect-src` 控制，因此被拦。

### 2.3 桌面端 Rust 下载桥没有覆盖本次路径

`creationMediaCache.ts` 中已经有桌面端 Rust 下载桥：

```ts
if (isTauriRuntime()) {
  invoke('http_download_base64', ...)
}
```

Rust 侧下载不受 WebView CSP 限制。日志里出现 `Fetch API cannot load ...`，说明本次运行实际走到了浏览器 `fetch()` fallback。可能原因：

1. 用户在 Web/preview 环境测试，不是 Tauri 桌面壳。
2. Tauri runtime 检测未命中。
3. 某些打包/预览路径下 `isTauriRuntime()` 返回 false。

这个问题不影响最小修复判断：即使在 Web fallback，CSP 也应该允许被产品白名单认可的媒体结果 CDN。

---

## 3. 目标与非目标

### 3.1 目标

1. 当前 `https://webstatic.aiproxy.vip/output/...` 结果可被下载缓存。
2. RH 生成成功后，画廊显示成功卡片，而不是“生成成功但保存到本地画廊失败”。
3. URL 安全白名单和 CSP allowlist 保持一致。
4. 桌面端优先通过 Rust `http_download_base64` 下载媒体，降低 CSP 与 CORS 风险。
5. 增加测试防止以后新增 CDN 白名单时漏配 CSP。

### 3.2 非目标

1. 不重构 RH adapter。
2. 不改变 NewAPI 鉴权、计费或渠道选择。
3. 不扩大到任意 `https:` 的 `connect-src`。
4. 不允许用户输入任意域名作为可下载结果。
5. 不在本次实现媒体代理服务，代理方案仅作为后续可选项。

---

## 4. 方案总览

### 4.1 P0 最小修复：CSP 增加 RH 输出 CDN

修改 `src-tauri/tauri.conf.json`：

```text
connect-src ... https://*.aiproxy.vip https://aiproxy.vip ...
```

理由：

1. 当前实际返回域名是 `webstatic.aiproxy.vip`。
2. `urlSafety.ts` 已经允许 `aiproxy.vip`，安全边界已有显式控制。
3. 只放行该 CDN 域，不放开所有 `https:` 连接。

### 4.2 P1 稳态修复：桌面端下载桥优先并可诊断

保留 `creationMediaCache.ts` 当前策略：

```text
Tauri 桌面端 -> invoke('http_download_base64')
Web fallback -> fetch(url)
```

但要增加诊断能力：

1. 当走 Web fallback 时，在开发日志里输出：

```text
[creationMediaCache] downloading via browser fetch
```

2. 当走 Tauri bridge 时，在开发日志里输出：

```text
[creationMediaCache] downloading via Tauri http_download_base64
```

3. 如果用户在 Tauri 桌面壳里仍走 browser fetch，需要单独排查 `isTauriRuntime()`。

### 4.3 P2 防回归测试：CSP 与 URL 白名单一致性

新增静态测试，读取：

1. `src/utils/urlSafety.ts`
2. `src-tauri/tauri.conf.json`

断言：

1. `urlSafety.ts` 允许 `aiproxy.vip`。
2. `connect-src` 包含 `https://*.aiproxy.vip`。
3. `connect-src` 不包含宽泛的 `https:`。

### 4.4 P3 可选长期方案：媒体下载代理

未来如果 RH 或其它上游频繁返回不同 CDN，可以新增网关代理：

```text
POST /api/creations/cache-media
body: { url, type }
```

前端只连接：

```text
https://api.jiucaihezi.studio
```

网关负责：

1. URL 白名单校验。
2. 服务端下载。
3. 返回 base64 或本地可访问引用。

本次不做该方案，因为当前问题可由 P0/P1 低风险解决。

---

## 5. 实施任务

### Task 1：CSP 放行 `aiproxy.vip`

**文件：**

- 修改：`src-tauri/tauri.conf.json`

**修改点：**

在 `app.security.csp` 的 `connect-src` 中加入：

```text
https://*.aiproxy.vip https://aiproxy.vip
```

**验收：**

```text
connect-src 中包含 https://*.aiproxy.vip
connect-src 中包含 https://aiproxy.vip
connect-src 中不新增宽泛 https:
```

### Task 2：增加 CSP/白名单一致性测试

**文件：**

- 新增或修改：`src/utils/__tests__/urlSafety.test.ts`

**测试意图：**

增加静态断言，避免 `urlSafety.ts` 允许某个结果域名，但 Tauri CSP 没有同步允许。

**建议测试：**

```ts
test('Tauri CSP allows approved creation result CDN hosts used for media caching', () => {
  const csp = readFileSync(join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8')
  assert.match(csp, /https:\/\/\*\.aiproxy\.vip/)
  assert.match(csp, /https:\/\/aiproxy\.vip/)
})
```

如果继续扩展其它 CDN，必须同步扩展该测试。

### Task 3：增加下载路径诊断日志

**文件：**

- 修改：`src/utils/creationMediaCache.ts`

**修改点：**

仅在下载入口增加低噪音开发日志，不输出 token、不输出完整 data URL。

```ts
if (isTauriRuntime()) {
  console.debug('[creationMediaCache] downloading via Tauri http_download_base64', new URL(url).hostname)
  ...
}

console.debug('[creationMediaCache] downloading via browser fetch', new URL(url).hostname)
```

**验收：**

1. 桌面端生成后应优先看到 Tauri bridge 日志。
2. Web/preview 环境允许看到 browser fetch 日志。
3. 日志不包含 token、prompt、base64 内容。

### Task 4：人工回归验证

**步骤：**

1. 启动桌面端或预览环境。
2. 打开创作面板。
3. 选择会返回 `webstatic.aiproxy.vip` 的 RH 图片模型，例如 `rh-pro-image` 或实际复现模型。
4. 输入简单 prompt。
5. 等待生成完成。
6. 确认画廊出现成功图片卡片。
7. 确认控制台没有：

```text
violates the following Content Security Policy directive: "connect-src ..."
Fetch API cannot load https://webstatic.aiproxy.vip
```

8. 删除/重启/重新打开 App，确认本地缓存引用仍能解析展示。

---

## 6. 验收标准

### 6.1 功能验收

- RH 生成返回 `https://webstatic.aiproxy.vip/output/...` 时，创作面板不再出现缓存失败卡片。
- 成功结果保存到本地画廊。
- 画廊卡片刷新后仍可显示。
- 视频结果如果同样返回 `aiproxy.vip`，也能被下载缓存。

### 6.2 安全验收

- CSP 只新增 `aiproxy.vip` 精确域名，不新增全局 `https:` 到 `connect-src`。
- `urlSafety.ts` 继续阻止非白名单结果 URL。
- `http_download_base64` 继续使用 Rust 侧 URL 校验和超时。
- 不在日志中输出 token、完整 base64、用户敏感 prompt。

### 6.3 测试验收

运行：

```bash
pnpm run test:focused:build
pnpm run test:focused:run
pnpm run test:tauri
```

期望：

```text
focused tests PASS
tauri tests PASS
```

如果只做前端静态验证，也至少运行：

```bash
pnpm run test:focused:build
pnpm run test:focused:run
```

---

## 7. 风险与边界

| 风险 | 说明 | 缓解 |
|---|---|---|
| CDN 域名继续变化 | RH/NewAPI 可能返回新的输出 CDN | 先观察失败域名，再按白名单流程加入，不开放 `https:` |
| Web/preview 仍受 CSP | Web fallback 只能依赖 CSP 放行 | P0 已覆盖当前 CDN |
| Tauri runtime 检测异常 | 桌面端本应走 Rust bridge，却走了 browser fetch | P1 诊断日志暴露路径 |
| CORS 失败 | CSP 放行后，远端仍可能不允许浏览器跨域读取 | 桌面端走 Rust bridge；Web 环境后续可考虑代理 |
| CSP 修改后需重打包 | Tauri CSP 在打包产物中生效 | 修复后必须重新构建桌面包验证 |

---

## 8. 推荐实施顺序

1. P0：给 `connect-src` 加 `https://*.aiproxy.vip https://aiproxy.vip`。
2. P2：补静态测试，锁住 CSP 与 URL 白名单一致性。
3. P1：加下载路径诊断日志。
4. 手动复现 RH 生成，确认不再出现 CSP 报错。
5. 如果仍失败，再判断是 CORS、Tauri runtime 检测，还是上游返回新 CDN。

---

## 9. 最终判断

当前问题不是 RH 任务生成失败，而是：

```text
RH 成功返回 webstatic.aiproxy.vip 结果
  -> 前端为了本地缓存执行 fetch(resultUrl)
  -> Tauri CSP connect-src 未放行 aiproxy.vip
  -> WebView 拦截
  -> 创作面板记录为缓存/画廊失败
```

最低成本、低风险修复是同步 CSP allowlist；稳态修复是确保桌面端优先使用 Rust 下载桥，并用测试锁住 URL 白名单与 CSP 的一致性。
