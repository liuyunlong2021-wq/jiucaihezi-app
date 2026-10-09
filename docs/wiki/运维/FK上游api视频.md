# 视频 API 对接

## 快速开始与鉴权

BASE URL：https://ai.fanke2026.xyz/api/open/v1
鉴权：Authorization: Bearer YOUR_API_KEY
公共模型编号请求头：X-Public-Model-Ids: 1
JSON 请求头：Content-Type: application/json

请使用本站账号创建的 API Key，从自己的服务端调用。不要把密钥放在公开网页或前端代码中。
主站账号使用主站地址，代理站账号使用所属代理站地址。余额、权限、独立定价和代理扣费关系与网站一致。
流程：读取模型 → 提交任务 → 保存 jobId → 查询状态 → 读取结果；文本直接返回回答。
以下响应为结构示例，实际编号、金额、时间和链接以接口返回为准。

## 模型列表与能力

GET https://ai.fanke2026.xyz/api/open/v1/models
兼容：GET https://ai.fanke2026.xyz/v1/models
携带 Authorization 和 X-Public-Model-Ids 请求头。

响应：{"object":"list","data":[...]}。
data[].id 是请求使用的 model，前缀为 ft-video-v1-… / ft-image-v1-… / ft-text-v1-…。
无需 modelVersion，不要使用模型显示名称代替编号。
公共字段：id、name、type、status、price。capabilities 是能力名称数组，例如 ["image_generation"]。
status=available 表示可用，replenishing 表示补量中。
视频按型号提供 resolutions、durations、resolution_durations、aspect_ratios、max_image_refs、max_video_refs、max_audio_refs、prompt_max_chars、audio_requires_image。
图片按型号提供 image_sizes、image_size_prices 等。
price.currency=CNY；unit=second 按秒、request 按次、million_tokens 按百万 token。
不同画质、参考视频和时长价格可见 resolution_prices、video_reference_prices、duration_prices。
官方 Seedance 2.0 Mini/Fast/满血、2.5 满血 720p：不带参考视频按秒，带参考视频按 video_reference_prices 的百万 Token 单价。预扣按预估 Token 费用，成功后读取 billing.usage.total_tokens 与 billing.charged_cost_cents，以 billing.settled=true 为结算完成；最终金额与预扣的差额多退少补，失败退回预扣。素材库转存由平台完成，调用方提交自己的公网 HTTPS 素材地址。字段存在与否以对应模型实际返回为准。
这四个型号的详细流程、失败退款限制和兼容接口说明，请查看独立的“官方渠道对接”页。
目录限制字段为 null 表示未声明，不是上游无限制。模型目录返回哪些型号，取决于当前账号权限；不要只按名称推断参数。

当前账号的模型、价格与规格见上方模型表。“复制全文”会一并包含模型清单。

## 提交视频任务

POST https://ai.fanke2026.xyz/api/open/v1/video/generate
Content-Type: application/json

{
  "model": "ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746",
  "prompt": "按参考素材创作视频",
  "ratio": "16:9",
  "duration": 1,
  "resolution": "768p",
  "imageUrls": [],
  "videoUrls": [],
  "audioUrls": []
}

model：公共模型 ID。prompt：提示词，长度限制按当前模型校验。
ratio / duration / resolution：须是该模型支持的组合；duration 为秒数。
imageUrls / videoUrls / audioUrls：对应素材的公网地址数组。
仅在模型允许无参考创作时，才省略对应数组或传空数组；部分模型至少需要 1 张参考图片。

curl 'https://ai.fanke2026.xyz/api/open/v1/video/generate' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Public-Model-Ids: 1' \
  -H 'Content-Type: application/json' \
  --data '{"model":"ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746","prompt":"按参考素材创作视频","ratio":"16:9","duration":1,"resolution":"768p","imageUrls":[],"videoUrls":[],"audioUrls":[]}'

## 参考素材与本地文件

素材必须能被服务器直接访问，不能使用 localhost、电脑文件路径或需要登录的网盘页面。
素材按数组顺序对应 @image1、@video1、@audio1。中文引用只在明确匹配已上传素材时归一化，可检查 normalizedPrompt、referenceMappings。
Wan 3.0 必须使用 HTTPS 素材；prompt_extend 默认 false，显式值原样传递。
数量、格式、大小、时长及音频是否必须配图，均按所选模型校验。

本地文件使用同一 generate 地址的 multipart/form-data：
curl 'https://ai.fanke2026.xyz/api/open/v1/video/generate' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'X-Public-Model-Ids: 1' \
  -F 'model=ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746' -F 'prompt=参考图片创作' \
  -F 'ratio=16:9' -F 'duration=1' -F 'resolution=768p' \
  -F 'images=@product.jpg'

多张文件重复 images 字段。支持视频/音频的型号可重复 videos / audios 字段。不要手动设置 multipart 的 Content-Type，客户端会生成 boundary。

## 提交响应与任务编号

常见受理响应：
{
  "success": true,
  "jobId": "cm_example_job",
  "taskId": "provider_task_example",
  "status": "submitted",
  "costYuan": "以实际金额为准"
}

jobId 为本站任务编号，请立即保存。taskId 可能暂未产生，排队时继续用 jobId 查询。
success=true 表示本次请求成功，不表示生成完成。

## 视频异步状态查询

GET https://ai.fanke2026.xyz/api/open/v1/video/status?jobId=返回的本站任务编号
携带同一账号的 Authorization: Bearer YOUR_API_KEY。
也支持 taskId 参数，建议始终使用 jobId。建议每 30 秒查询一次，读取 pollAfterSeconds。
使用 URLSearchParams 编码编号，可以添加 _t 时间戳避免缓存。

{
  "success": true,
  "jobId": "cm_example_job",
  "status": "success",
  "videoUrl": "https://ai.fanke2026.xyz/api/video/result/cm_example_job?exp=...&sig=...",
  "errorMessage": null,
  "checkedAt": "服务端查询时间",
  "pollAfterSeconds": 30
}

## 状态判断与费用

success：本次请求是否成功，不代表生成成功。
status=submitted：处理中，继续查询。
status=success：生成已完成，读取 videoUrl（contentUrl 为兼容字段）。
status=failed：生成失败，读取 errorMessage，停止轮询。
查询失败任务也可能返回 HTTP 200、success=true，必须检查 status。
部分渠道有 progress、costYuan、quota、billing，按实际返回读取，最终结算与退款以任务账单为准。
任务成功但结果不可用时，保留 jobId 联系平台核查，不要自动重复生成。

## 兼容视频接口与字段对应

POST https://ai.fanke2026.xyz/v1/videos
GET https://ai.fanke2026.xyz/v1/videos/{id}
GET https://ai.fanke2026.xyz/v1/videos/{id}/content

兼容提交使用 JSON，推荐与标准接口一致的 model、prompt、ratio、duration、resolution、imageUrls、videoUrls、audioUrls；不要假设所有 SDK 的 multipart 或 size 像素参数都适用。本地文件使用本站标准 video/generate 接口。
兼容提交通常返回 HTTP 202、id、job_id、task_id、status=queued、cost_yuan。保存 job_id（通常同 id）。
兼容查询 status=in_progress / completed / failed；state=submitted / success / failed；结果读取 video_url（url、content_url 为兼容字段），费用读取 cost_yuan，查询间隔读取 poll_after_seconds。
HTTP 200 不表示视频完成。不要混用标准接口的 jobId、videoUrl、costYuan 和兼容接口的下划线字段。
content 下载入口需要同账号 Authorization，未就绪可能返回 409，就绪后重定向到签名视频地址。浏览器直接打开这个入口不会自动带 Bearer 密钥，建议使用查询返回的完整签名 video_url。

当前兼容查询未透传完整 Token billing。有视频参考的官方渠道，以及其他需要 Token 结算明细的渠道，应使用 job_id 再调用 https://ai.fanke2026.xyz/api/open/v1/video/status?jobId=... 查询完整结算信息。

## 查询代码示例

// Node.js 18+：仅查询已有任务，不会再次提交生成。
const base = "https://ai.fanke2026.xyz/api/open/v1";
const key = process.env.FEITUO_API_KEY;
const jobId = process.env.FEITUO_JOB_ID;
if (!key || !jobId) throw new Error('请设置 API Key 和已保存的 jobId');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let result = null;
for (let attempt = 0; attempt < 120; attempt++) {
  const url = new URL(base + '/video/status');
  url.searchParams.set('jobId', jobId);
  url.searchParams.set('_t', String(Date.now()));
  let response;
  try {
    response = await fetch(url, {
      headers: {Authorization: 'Bearer ' + key, 'X-Public-Model-Ids': '1'},
      cache: 'no-store', signal: AbortSignal.timeout(90000)
    });
  } catch {
    await sleep(30000); continue; // 网络异常只重试查询
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    await sleep(Math.max(30, 10) * 1000); continue;
  }
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(JSON.stringify(data));
  if (data.status === 'failed') throw new Error(data.errorMessage || '生成失败');
  if (data.status === 'success') {
    if (data.billing?.mode === 'token' && data.billing.settled !== true) { await sleep(30000); continue; } // 按 Token 计费的任务需确认结算
    if (!data.videoUrl) throw new Error('视频已完成，文件暂不可用，请保留 jobId 联系平台');
    result = data; break;
  }
  if (data.status !== 'submitted') throw new Error('未知状态，请保留任务信息核查');
  await sleep(Math.max(30, Number(data.pollAfterSeconds) || 30) * 1000);
}
if (!result) throw new Error('本轮等待结束，保存 jobId 后可继续查询，不要重新提交');
console.log(result.videoUrl);

## 结果下载与签名

直接使用 videoUrl 中的完整链接，保留 exp、sig 等签名和全部查询参数。不要自行拼接供应商地址。
保存前检查 HTTP 状态与 Content-Type，不能把 JSON / HTML 错误页另存为媒体文件。
链接过期时重新查询任务取得结果地址。视频生成完成与文件归档完成可能有短暂间隔，下载返回 409 或暂不可用时，稍后重新查询并重试下载。
持续不可用时提供 jobId 给平台核查，不要重复付费生成。

## 错误处理与重试

400：参数、模型编号或规格组合无效，修改参数后重试。
401：API Key 缺失、无效或被停用。
402：可用余额不足。
403：没有模型或任务权限。
404：任务不存在或不属于当前账号/站点，核对 jobId 与 API Key 所属站点。
429：频率或并发限制，降低调用频率。
5xx / 网络超时：保存已有 jobId；查询可稍后重试，提交不可盲目重复。

错误可能出现在 error、error.message 或 errorMessage，以实际响应为准。
现有接口不保证 Idempotency-Key 或重复 POST 自动去重，不能在响应丢失后自动重发生成。
不要套用其他平台的 modelVersion、assetIds、积分扣费或接口地址。
并发上限由当前账号配置决定，示例频率不是统一额度。

## 当前账号模型清单

特价渠道 MiniMax H3-768p
model: ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746
价格：768p：0.06 元/秒
规格：768p
画面比例：16:9 / 4:3 / 1:1 / 3:4 / 9:16
时长：1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 0 视频 / 3 音频；目录未声明固定提示词上限，不代表上游无限制。

特价渠道 MiniMax H3 768p-2k
model: ft-video-v1-17c3294027e987b8f50f78a8c525d650
价格：768p：0.6 元/次；2k：1 元/次
规格：768p / 2k
画面比例：16:9 / 9:16 / 4:3 / 3:4 / 1:1 / 21:9
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 0 视频 / 0 音频；目录未声明固定提示词上限，不代表上游无限制。

特价渠道 MiniMax H3-2k
model: ft-video-v1-4edb37caf7f3ad2875378757cc1f1db5
价格：2k：1.8 元/次
规格：2k
画面比例：16:9 / 9:16 / 1:1 / 4:3 / 3:4
时长：10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：6 图 / 0 视频 / 0 音频；目录未声明固定提示词上限，不代表上游无限制。

测试seedance
model: ft-video-v1-43644108aaba72b7cbad4cd322737f6c
价格：720p：3 元/次
规格：720p
画面比例：16:9 / 9:16 / 4:3 / 3:4 / 1:1 / 21:9
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 0 视频 / 0 音频；目录未声明固定提示词上限，不代表上游无限制。

特价渠道 Seedance 2.0 mini 720p
model: ft-video-v1-dd97afc97a7c3cba8e78a6e429933597
价格：720p：1 元/次
规格：720p
画面比例：16:9 / 9:16 / 1:1 / 4:3 / 3:4
时长：5 / 10 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 0 视频 / 0 音频；目录未声明固定提示词上限，不代表上游无限制。

特价渠道 Seedance 2.0 mini 720p（带音频参考）
model: ft-video-v1-6310889dcaf8407cf7108bc45ef84325
价格：720p：1 元/次；480p：1 元/次
规格：720p / 480p
画面比例：16:9 / 9:16
时长：1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 0 视频 / 3 音频；目录未声明固定提示词上限，不代表上游无限制。

特价渠道 Seedance 2.0 fast 720p（900）
model: ft-video-v1-20205b9fbcec3a1094671e1c08ab7f93
价格：720p：1.5 元/次
规格：720p
画面比例：16:9 / 9:16
时长：5 / 10 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 0 视频 / 0 音频；目录未声明固定提示词上限，不代表上游无限制。

特价渠道 Seedance 2.0 满血 720p (900)
model: ft-video-v1-d40a056d0fc20901a8b7e33d737fef51
价格：720p：1.8 元/次
规格：720p
画面比例：16:9 / 9:16
时长：15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 0 视频 / 0 音频；目录未声明固定提示词上限，不代表上游无限制。

特价渠道 Seedance 2.0 满血 720p (933)
model: ft-video-v1-b92bdf13b031fea6d7e80431def22584
价格：720p：1.2 元/次
规格：720p
画面比例：9:16 / 16:9 / 1:1 / 4:3 / 3:4
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 3 视频 / 3 音频；目录未声明固定提示词上限，不代表上游无限制。

特价渠道 Seedance 2.0 满血 720p (933原生可真人)
model: ft-video-v1-d6adc02a19b36647bf74048a706aa2e7
价格：720p：0.23 元/秒
规格：720p
画面比例：16:9 / 9:16 / 4:3 / 3:4 / 1:1
时长：5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 3 视频 / 3 音频；目录未声明固定提示词上限，不代表上游无限制。

特价渠道 Seedance 2.5 满血 720p (9图)
model: ft-video-v1-69ef4c70291248a25c8198cd1c7c9c1f
价格：720p：1.2 元/次
规格：720p
画面比例：9:16 / 16:9 / 1:1 / 4:3 / 3:4
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 / 27 / 28 / 29 / 30 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 0 视频 / 0 音频；目录未声明固定提示词上限，不代表上游无限制。

特价渠道 Seedance 2.5 满血 720p (30图)
model: ft-video-v1-fe82aee0b8ce5ee1d790a56291dc5563
价格：720p：1.2 元/次
规格：720p
画面比例：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 / 27 / 28 / 29 / 30 秒；各画质时长组合以 resolution_durations 为准
参考上限：30 图 / 0 视频 / 0 音频；目录未声明固定提示词上限，不代表上游无限制。

特价官渠 Seedance 2.0 满血 720p (可返官链)
model: ft-video-v1-5b3d11bcce3881475c96d465c993449e
价格：720p：3.8 元/次
规格：720p
画面比例：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 0 视频 / 3 音频；目录未声明固定提示词上限，不代表上游无限制。

特价渠道 Seedance 2.5 满血 720p（可过真人）
model: ft-video-v1-99d13a482c1f6f0e71db1e36c4154b70
价格：720p：3.5 元/次
规格：720p
画面比例：16:9 / 9:16 / 1:1 / 4:3 / 3:4
时长：15 / 30 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 0 视频 / 0 音频；目录未声明固定提示词上限，不代表上游无限制。

长期特惠 Seedance 2.0 满血 720p（量大长期稳定，不保售后）
model: ft-video-v1-a4e45199f67ed84790ec03dfc2768a01
价格：720p：2.5 元/次
规格：720p
画面比例：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9
时长：5 / 10 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 3 视频 / 3 音频；提示词上限 6000 字符。

长期特惠 Seedance 2.5 满血 720p（量大长期稳定，不保售后）
model: ft-video-v1-bdf45387433ac0a9042ebab3fae0299d
价格：720p：2.5 元/次
规格：720p
画面比例：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9
时长：30 秒；各画质时长组合以 resolution_durations 为准
参考上限：30 图 / 10 视频 / 10 音频；提示词上限 6000 字符。

ld-Seedance 2.0 满血 720p（超分）
model: ft-video-v1-147de4bb09f8f058b934ea1ea4b1fefd
价格：720p：3.8 元/次
规格：720p
画面比例：21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 3 视频 / 3 音频；目录未声明固定提示词上限，不代表上游无限制。

ld-Seedance 2.0 满血 720p
model: ft-video-v1-3c519942e1f2c46e9000fefd4da3a3d1
价格：720p：4.8 元/次
规格：720p
画面比例：9:16 / 16:9 / 1:1 / 4:3 / 3:4
时长：5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 3 视频 / 3 音频；提示词上限 5000 字符。

Seedance 2.0 fast 720p（优）
model: ft-video-v1-55508bd5edd0bd74e40fafda5c8f997b
价格：720p：0.48 元/秒
规格：720p
画面比例：9:16 / 16:9 / 1:1 / 4:3 / 3:4
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 3 视频 / 3 音频；目录未声明固定提示词上限，不代表上游无限制。

Seedance 2.0 满血 720p（优）
model: ft-video-v1-eee6fc015866324b356a5ec183ea908b
价格：720p：0.55 元/秒
规格：720p
画面比例：9:16 / 16:9 / 1:1 / 4:3 / 3:4
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 3 视频 / 3 音频；目录未声明固定提示词上限，不代表上游无限制。

Seedance 2.5 满血 720p (全能参考)
model: ft-video-v1-8f202024a9e0dbf15f703ab479b0c161
价格：720p：6.8 元/次
规格：720p
画面比例：16:9 / 9:16 / 4:3 / 3:4 / 1:1
时长：30 秒；各画质时长组合以 resolution_durations 为准
参考上限：30 图 / 10 视频 / 10 音频；目录未声明固定提示词上限，不代表上游无限制。

XN2-Seedance 2.5 满血 480-720p
model: ft-video-v1-9f4e77de6c05f3c360c1c0b9938a44a4
价格：480p：0.28 元/秒；720p：0.4 元/秒
规格：480p / 720p
画面比例：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 / 27 / 28 / 29 秒；各画质时长组合以 resolution_durations 为准
参考上限：30 图 / 0 视频 / 10 音频；提示词上限 9999 字符。

官方渠道-Seedance 2.0 Mini 720p
model: ft-video-v1-e820a676bd820bff4a79d2571fdb7fde
价格：720p：0.3 元/秒（无参考视频）；带参考视频 ¥10.5/百万 Tokens，按预估 Token 费用预扣，实际用量多退少补
规格：720p
画面比例：16:9 / 9:16 / 1:1 / 21:9 / 4:3 / 3:4
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 3 视频 / 3 音频；目录未声明固定提示词上限，不代表上游无限制。

官方渠道-Seedance 2.0 Fast 720p
model: ft-video-v1-0a4bb4e7f4e95d0bd4ef584f2a4db1a3
价格：720p：0.5 元/秒（无参考视频）；带参考视频 ¥16.5/百万 Tokens，按预估 Token 费用预扣，实际用量多退少补
规格：720p
画面比例：16:9 / 9:16 / 1:1 / 21:9 / 4:3 / 3:4
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 3 视频 / 3 音频；目录未声明固定提示词上限，不代表上游无限制。

官方渠道-Seedance 2.0 满血 720p
model: ft-video-v1-24ee1a4df896ea53869d6a2e5ae59a30
价格：720p：0.6 元/秒（无参考视频）；带参考视频 ¥21/百万 Tokens，按预估 Token 费用预扣，实际用量多退少补
规格：720p
画面比例：16:9 / 9:16 / 1:1 / 21:9 / 4:3 / 3:4
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 秒；各画质时长组合以 resolution_durations 为准
参考上限：9 图 / 3 视频 / 3 音频；目录未声明固定提示词上限，不代表上游无限制。

官方渠道-Seedance 2.5 满血 720p
model: ft-video-v1-451adae35b0c4a3d275c2c46394abc98
价格：720p：0.85 元/秒（无参考视频）；带参考视频 ¥31.5/百万 Tokens，按预估 Token 费用预扣，实际用量多退少补
规格：720p
画面比例：16:9 / 9:16 / 1:1 / 21:9 / 4:3 / 3:4
时长：4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 / 27 / 28 / 29 / 30 秒；各画质时长组合以 resolution_durations 为准
参考上限：30 图 / 10 视频 / 10 音频；目录未声明固定提示词上限，不代表上游无限制。