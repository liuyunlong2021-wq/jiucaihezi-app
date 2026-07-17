Google Veo 视频生成 API 指南
概述

本指南面向希望通过 API 调用 Google Veo 视频生成模型的开发者。下游对接时，请使用 openai 渠道类型。

模型能力与价格
计费说明

下方价格根据当前平台配置计算，并以人民币（CNY）结算。

视频模型按每秒计价。最终费用 = 每秒单价 x 视频时长。例如：¥0.10/秒 x 8 秒 = ¥0.80。

Veo 3.0 Generate
veo-3.0-generate-001

参数	详情
支持时长	8 秒
支持分辨率	720p、1080p
宽高比	16:9、9:16，默认 16:9
音频	内置原生音频；不支持 generateAudio
价格： ¥0.10 每秒

时长 / 分辨率	计算方式	价格
8 秒 720p	¥0.10 x 8 秒	¥0.80
8 秒 1080p	¥0.10 x 8 秒	¥0.80
不支持 4K、4 秒和 6 秒输出。1080p 建议尽量使用 16:9；竖版视频请优先使用 720p。

Veo 3.0 Fast
veo-3.0-fast-generate-001

参数	详情
支持时长	8 秒
支持分辨率	720p、1080p
宽高比	16:9、9:16，默认 16:9
音频	内置原生音频；不支持 generateAudio
价格： ¥0.05 每秒

时长 / 分辨率	计算方式	价格
8 秒 720p	¥0.05 x 8 秒	¥0.40
8 秒 1080p	¥0.05 x 8 秒	¥0.40
不支持 4K、4 秒和 6 秒输出。1080p 建议尽量使用 16:9；竖版视频请优先使用 720p。

Veo 3.1 Generate
veo-3.1-generate-preview

参数	详情
支持时长	4、6 或 8 秒
支持分辨率	720p、1080p、4K
宽高比	16:9、9:16，默认 16:9
音频	内置原生音频；不支持 generateAudio
价格： ¥0.10 每秒

时长 / 分辨率	计算方式	价格
4 秒 720p	¥0.10 x 4 秒	¥0.40
6 秒 720p	¥0.10 x 6 秒	¥0.60
8 秒 720p	¥0.10 x 8 秒	¥0.80
8 秒 1080p	¥0.10 x 8 秒	¥0.80
8 秒 4K	¥0.15 x 8 秒	¥1.20
1080p 和 4K 仅支持 8 秒视频。4K 必须为 8 秒。参考图生成同样建议使用 8 秒。

Veo 3.1 Fast
veo-3.1-fast-generate-preview

参数	详情
支持时长	4、6 或 8 秒
支持分辨率	720p、1080p、4K
宽高比	16:9、9:16，默认 16:9
音频	内置原生音频；不支持 generateAudio
价格： ¥0.05 每秒，4K 约为 ¥0.116 每秒

时长 / 分辨率	计算方式	价格
4 秒 720p	¥0.05 x 4 秒	¥0.20
6 秒 720p	¥0.05 x 6 秒	¥0.30
8 秒 720p	¥0.05 x 8 秒	¥0.40
8 秒 1080p	¥0.05 x 8 秒	¥0.40
8 秒 4K	¥0.116 x 8 秒	¥0.93
1080p 和 4K 仅支持 8 秒视频。4K 必须为 8 秒。参考图生成同样建议使用 8 秒。

宽高比
你可以通过 metadata.aspectRatio 或表单字段 aspectRatio 设置宽高比：


{
  "metadata": {
    "aspectRatio": "9:16"
  }
}
如果未提供 aspectRatio，系统会根据 size 推断，例如 1280x720 -> 16:9，720x1280 -> 9:16
如果 size 也缺失，则默认为 16:9
aspectRatio 仅控制画面方向，不影响价格
音频
注意

所有 Veo 3 / Veo 3.1 模型均为原生音频视频模型，但当前 Gemini API 不支持 generateAudio 参数。传入该参数可能返回 INVALID_ARGUMENT。

如需控制音频内容，请在 prompt 中描述对白、环境音、音效或音乐风格。例如：

A lighthouse at sunset by the sea, waves tapping the rocks, distant low wind and seabirds, cinematic lighting, stable camera movement

图像输入
能力	是否支持	说明
单张首帧图生视频	支持	图像字段名必须为 input_reference
多张参考图	暂不支持	官方 Veo 3.1 最多支持 3 张图
首尾帧或插值	暂不支持	官方 Veo 3.1 支持此功能
视频续写	暂不支持	官方 Veo 3.1 支持此功能
图生视频限制

当前图生视频请求仅支持 一张图像。若发送多张图像，仅使用第一张。
使用 multipart/form-data 时，图像字段名必须为 input_reference。
不建议使用远程图像 URL。请改用 file 或 Base64 方式传递。
计费规则
API 参考
端点
推荐端点：

用途	方法	路径
创建任务	POST	/v1/videos
查询状态	GET	/v1/videos/{task_id}
下载结果	GET	/v1/videos/{task_id}/content
你也可以直接查询状态和结果 URL：

用途	方法	路径
查询状态和结果 URL	GET	/v1/video/generations/{task_id}
1. 鉴权

export BASE_URL="https://img-api.zxcode.vip"
export API_TOKEN="sk-xxxxxx"
每个请求都应包含：


-H "Authorization: Bearer $API_TOKEN"
2. 创建文生视频任务

curl -X POST "$BASE_URL/v1/videos" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "veo-3.1-generate-preview",
    "prompt": "A lighthouse by the sea at sunset, slow camera push-in, waves tapping the rocks, cinematic lighting, stable camera movement",
    "duration": 8,
    "size": "1280x720",
    "metadata": {
      "negativePrompt": "blurry, watermark, distorted, low quality",
      "resolution": "720p",
      "aspectRatio": "16:9",
      "seed": 20260401
    }
  }'
3. 创建图生视频任务
推荐的图生视频格式为 multipart/form-data。图像字段名必须为 input_reference。


curl -X POST "$BASE_URL/v1/videos" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Accept: application/json" \
  -F "model=veo-3.1-generate-preview" \
  -F "prompt=The girl in the image turns toward the camera, a light breeze moves her hair, city lights softly blur in the background, smooth camera push-in" \
  -F "input_reference=@./first-frame.png;type=image/png" \
  -F "seconds=8" \
  -F "size=1280x720" \
  -F "resolution=720p" \
  -F "aspectRatio=16:9" \
  -F "negativePrompt=blurry, watermark, deformed hands" \
  -F "seed=20260401"
4. 查询任务状态
保存创建请求返回的 id 或 task_id：


export TASK_ID="task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
然后查询状态：


curl -X GET "$BASE_URL/v1/videos/$TASK_ID" \
  -H "Authorization: Bearer $API_TOKEN"
5. 查询任务状态和结果 URL
如果你希望在查询响应中获取可下载的结果 URL，请调用：


curl -X GET "$BASE_URL/v1/video/generations/$TASK_ID" \
  -H "Authorization: Bearer $API_TOKEN"
6. 下载生成的视频
任务完成后，直接下载：


curl -L "$BASE_URL/v1/videos/$TASK_ID/content" \
  -H "Authorization: Bearer $API_TOKEN" \
  -o veo-result.mp4
7. 状态值
GET /v1/videos/{task_id} 返回的状态：

状态	含义
queued	排队中
in_progress	生成中
completed	已完成
failed	失败
GET /v1/video/generations/{task_id} 返回的状态：

状态	含义
queued	排队中
processing	生成中
succeeded	成功
failed	失败
8. 对接注意事项
重要

prompt 为必填。
图生视频请求中，图像字段名必须为 input_reference。
当前图生视频仅支持 一张 首帧图像。若发送多张图像，仅使用第一张。
不建议使用远程图像 URL。请改用 file 或 Base64 方式传递。
轮询 GET /v1/videos/{task_id}，并在 status=completed 后再下载。
Veo 3.1 模型支持 4、6 和 8 秒。若使用 1080p 或 4K，必须 使用 8 秒。
Veo 3.0 模型建议使用 8 秒及 720p / 1080p。
横版使用 aspectRatio=16:9，竖版使用 aspectRatio=9:16。若省略，默认为 16:9。
请勿 发送 generateAudio。Veo 3 / 3.1 模型内置原生音频，该参数可能返回 INVALID_ARGUMENT。
如需控制音频，请在 prompt 中描述对白、环境音、音效或音乐风格。