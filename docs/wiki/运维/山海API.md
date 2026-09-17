山海画布 API 文档

模型调用文档
使用画布账户创建的 API Key 调用已发布的文本、图片和视频模型。

下载 OpenAPI JSON
Base URL
https://shanhai.vnshu.cn/api/v1
鉴权
Authorization: Bearer oc_live_...
异步任务
POST /generations → GET /tasks/{id}
当前已发布模型
以下内容读取当前模型目录。请求时请使用第三方 API 模型 ID，并以该模型返回的能力和价格为准。

文档版本 17，最近更新于 2026/9/12 02:57:28。

模型名称	第三方 API 模型 ID	类型	价格与计费方式	分辨率	比例	时长	参考图上限
image-2（中质量）
shanhai-image-2	image	
0 山海币 / 次
1k: 0.06 · 2k: 0.08 · 4k: 0.12
1K, 2K, 4K	1:1, 16:9, 9:16, 4:3, 3:4	-	-
Nano Banana-pro
shanhai-nano-banana-pro	image	
0 山海币 / 次
1k: 0.06 · 2k: 0.08 · 4k: 0.12
1K, 2K, 4K	1:1, 16:9, 9:16, 4:3, 3:4	-	-
Nano Banana-2
shanhai-nano-banana-2	image	
0 山海币 / 次
1k: 0.05 · 2k: 0.07 · 4k: 0.09
1K, 2K, 4K	1:1, 16:9, 9:16, 4:3, 3:4	-	-
sd-2.5-30秒（9图特价）+号中
shanhai-dola-seedance-v2-5-30-9-0-7	video	
0.7 山海币 / 次
720p: 0.7
720p	21:9, 16:9, 4:3, 1:1, 3:4, 9:16	4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30	9
seedance_30/10/10（测试）
oc-chaopianyi-seedance-v2-5-301010	video	
3 山海币 / 次
720p: 3
720p	21:9, 16:9, 4:3, 1:1, 3:4, 9:16	4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30	9
dola（9图30秒）-（可用）
oc-model-r5cfh8	video	
0.9 山海币 / 次
720p: 0.9
720p	21:9, 16:9, 4:3, 1:1, 3:4, 9:16	30	10
seedance-2.5-480p-10秒-2.3/条
oc-model-1tu4mj	video
2.3 山海币 / 次
720p: 2.3
720P	16:9, 9:16	5, 10, 15, 20, 30	-
sd2.0-mini（480p=15秒/720p=10秒）（可用）
shanhai-seedance2-0-mini-903-720-10-480-15	video	
0.88 山海币 / 次
480p: 0.88 · 720p: 0.88
480p, 720p	auto, 16:9, 9:16, 1:1, 4:3, 3:4, 21:9	4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15	9
sd-2.0（官渠）-极稳-（可用）
oc-model-1iq31f	video	
0 山海币 / 秒
1080p: 1.58 · 480p: 0.48 · 720p: 0.78
480p, 720p, 1080p	16:9, 9:16	5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15	9
gemini-3.1-pro
shanhai-gemini-3-1-pro	text	
0.03 山海币 / 次
-	-	-	-
deepseek-v4-pro
shanhai-deepseek-v4-pro	text	
0.03 山海币 / 次
-	-	-	-
minimax-H3 （768）903参考-（可用）
shanhai-minimax-h3-2k-903	video	
1.5 山海币 / 次
2k: 1.5 · 768p: 1.5
768p	1:1, 16:9, 9:16	5, 10, 15	-
调用流程
1. 登录画布账户，在账户中心的“API 接入”创建 API Key；Key 使用该账户的画布余额。
2. 调用 GET /models 查看已发布模型。
3. 需要音频参考时，先调用 POST /uploads/audio 上传文件并取得 HTTPS 地址。
4. 调用 POST /generations 创建任务。
5. 图片和视频任务使用返回的任务 ID 轮询 GET /tasks/{taskId}。
音频上传与音频参考
使用 POST /uploads/audio 上传音频。请求使用 multipart/form-data，文件字段名固定为 file。

支持 MP3 和 WAV，最大 25MB。上传成功后返回的 url 是可被模型读取的 HTTPS 地址。

先通过 GET /models 确认模型的 capabilities.audio_input 为 true。生成时将该地址放入 inputs，类型为 audio；音频参考还必须同时提供至少一张参考图或一段参考视频。

curl -X POST https://shanhai.vnshu.cn/api/v1/uploads/audio \
  -H "Authorization: Bearer oc_live_xxxxxxxxx" \
  -F "file=@./reference.mp3"
curl -X POST https://shanhai.vnshu.cn/api/v1/generations \
  -H "Authorization: Bearer oc_live_xxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "$MODEL_ID_FROM_GET_MODELS",
    "prompt": "Animate the character in time with the audio reference",
    "media_type": "video",
    "inputs": [
      { "type": "image", "url": "https://cdn.example.com/reference.jpg" },
      { "type": "audio", "url": "$URL_RETURNED_BY_AUDIO_UPLOAD" }
    ],
    "options": { "aspect_ratio": "16:9", "resolution": "720p", "duration": "15" }
  }'
视频生成示例
请先调用 GET /models，将返回的 data[].id 原样填入请求的 model 字段。不要填写显示名称。

curl -X POST https://shanhai.vnshu.cn/api/v1/generations \
  -H "Authorization: Bearer oc_live_xxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "$MODEL_ID_FROM_GET_MODELS",
    "prompt": "A cinematic mountain sunrise",
    "media_type": "video",
    "options": { "aspect_ratio": "16:9", "resolution": "720p", "duration": "15" }
  }'
参考图与图床要求
支持参考图的模型使用 inputs 数组；数组中的每一项必须是公开可访问的 HTTPS 直链。

图床可以是你自己的 CDN、对象存储公开地址或其他图床，不要求使用山海画布；不能填写本地路径、登录后页面、HTML 预览页或仅浏览器能访问的地址。

请查看 GET /models 返回的 capabilities.max_reference_images，数量不能超过该值。图片必须在任务处理期间保持有效。

旧版单图请求仍可使用 input；多图必须使用 inputs，不能同时传两个字段。

curl -X POST https://shanhai.vnshu.cn/api/v1/generations \
  -H "Authorization: Bearer oc_live_xxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "$MODEL_ID_FROM_GET_MODELS",
    "prompt": "Animate the reference images into a cinematic scene",
    "media_type": "video",
    "inputs": [
      { "type": "image", "url": "https://cdn.example.com/reference-1.jpg" },
      { "type": "image", "url": "https://cdn.example.com/reference-2.jpg" }
    ],
    "options": { "aspect_ratio": "16:9", "resolution": "720p", "duration": "15" }
  }'
查询任务与下载成片
图片和视频任务请持续查询 GET /tasks/{taskId}；仅当 status 为 succeeded 时，才读取 output.url。

output.url 是山海画布提供的受鉴权下载地址。请求它时必须携带查询任务时使用的同一枚 Bearer API Key；接口直接返回媒体文件。

视频首次下载可能比后续下载稍慢；接口支持播放、断点续传和重新下载。

视频下载支持 HTTP Range，可用于播放器分段读取和断点续传。

{
  "id": "run_xxxxxxxxx",
  "object": "generation",
  "status": "succeeded",
  "model": "$MODEL_ID_FROM_GET_MODELS",
  "output": {
    "url": "https://shanhai.vnshu.cn/api/v1/media/runs/run_xxxxxxxxx",
    "mime_type": "video/mp4",
    "type": "video"
  },
  "usage": { "credits": 12 }
}
下载视频示例：

curl -L \
  -H "Authorization: Bearer oc_live_xxxxxxxxx" \
  -o video.mp4 \
  "https://shanhai.vnshu.cn/api/v1/media/runs/run_xxxxxxxxx"
获取模型与参数
模型 ID、模型类型、价格和能力以接口返回为准。不要直接猜测模型名称；将 GET /models 返回的 id 填入生成请求。新接入模型发布后会自动出现在接口返回中，无需客户端写死模型列表。

curl https://shanhai.vnshu.cn/api/v1/models \
  -H "Authorization: Bearer oc_live_xxxxxxxxx"
{
  "object": "list",
  "data": [{
    "id": "$MODEL_ID_FROM_GET_MODELS",
    "display_name": "山海视频模型",
    "type": "video",
    "price_credits": 30,
    "billing_unit": "per_request",
    "resolution_prices": { "720p": 30, "1080p": 45 },
    "pricing": {
      "credits": 30,
      "unit": "per_request",
      "currency": "canvas_credits",
      "resolution_prices": { "720p": 30, "1080p": 45 }
    },
    "capabilities": {
      "max_reference_images": 10,
      "aspect_ratios": ["16:9", "9:16"],
      "resolutions": ["480p", "720p", "1080p"],
      "durations": ["5", "10", "15", "30"]
    }
  }]
}
Use the id returned by this endpoint in generation requests. display_name, pricing, and description identify the model and its credit cost.

data[].id 是稳定调用 ID；后台修改 display_name 不会改变该 ID。请保存并持续使用 ID，不要使用显示名称或上游模型名称。

price_credits 是当前已发布的基础扣费价格。若返回 resolution_prices，所选分辨率对应的价格优先于基础价格。

当 billing_unit 为 per_second 时，价格按所选时长计算；为 per_request 时，每个任务按一次计费。

model
已发布模型 ID，必填。

prompt
文本提示词，最长 20,000 字符。

media_type
text、image 或 video，应与模型类型一致。

文本调用
curl -X POST https://shanhai.vnshu.cn/api/v1/generations \
  -H "Authorization: Bearer oc_live_xxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"$MODEL_ID_FROM_GET_MODELS","prompt":"Summarize this paragraph","media_type":"text"}'
文本任务通常直接返回 succeeded 和 output.text。

图片调用
curl -X POST https://shanhai.vnshu.cn/api/v1/generations \
  -H "Authorization: Bearer oc_live_xxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"$MODEL_ID_FROM_GET_MODELS","prompt":"A moonlit mountain","media_type":"image","options":{"aspect_ratio":"16:9","resolution":"1K"}}'
图片和视频输入地址必须是 HTTPS；生成结果通过任务接口轮询。

JavaScript
const response = await fetch(
  'https://shanhai.vnshu.cn/api/v1/generations',
  {
    method: 'POST',
    headers: {
      Authorization: 'Bearer oc_live_xxxxxxxxx',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
    model: '$MODEL_ID_FROM_GET_MODELS',
      prompt: 'A cinematic mountain sunrise',
      media_type: 'video'
    })
  }
);
const task = await response.json();
Python
import requests

response = requests.post(
    "https://shanhai.vnshu.cn/api/v1/generations",
    headers={"Authorization": "Bearer oc_live_xxxxxxxxx"},
    json={"model": "$MODEL_ID_FROM_GET_MODELS", "prompt": "A cinematic mountain sunrise", "media_type": "video"},
)
task = response.json()
响应、错误和额度
创建任务会返回任务对象；媒体任务使用返回的 ID 轮询 GET /tasks/{taskId}。

{
  "id": "run_xxxxxxxxx",
  "object": "generation",
  "status": "queued",
  "model": "$MODEL_ID_FROM_GET_MODELS",
  "output": null,
  "usage": { "credits": 12 }
}
401
Key 缺失、错误或已撤销。

403
Key 没有对应权限。

422
参数、模型或输入地址不合法。

429
超过该 Key 的每分钟限流。

每次成功提交会按模型价格从画布账户余额扣除；任务失败会按系统规则处理。API Key 的限流和账户余额都由账户中心管理。

返回状态
queued 任务已创建，等待执行。

running 已发布模型正在生成。

succeeded 已完成，可读取 output.url。

failed 生成失败，查看 error。

安全说明
API Key 只应放在第三方服务端，不能写入浏览器前端代码。

输入图片或视频必须使用 HTTPS 地址。

可调用模型由后台发布控制，额度来自画布账户余额，撤销 Key 后立即失效。

下载 output.url 时也要带上同一个 Bearer API Key。
