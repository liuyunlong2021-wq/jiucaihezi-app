# 接口:/gemini-omni-flash/image-to-video

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.ai/openapi/v2/gemini-omni-flash/image-to-video' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "prompt": "make the character smile and slowly turn around, cinematic camera motion",
  "imageUrls": [
    "https://www.runninghub.cn/view?filename=89bd1e7361fe8a9682566868c1e24faad30135b0d4b31d68d3bca9b2283d6c15.png&type=input&subfolder=&Rh-Comfy-Auth=eyJ1c2VySWQiOiI5Y2JhNWY0NmU5ZjA1MmU3NTliNDE3M2ZhOGE4Y2Q4OCIsInNpZ25FeHBpcmUiOjE3ODAxMDMzNjE4OTIsInRzIjoxNzc5NDk4NTYxODkyLCJzaWduIjoiMjg4MmM5ODU1N2QwMzYzODZkZGZjMWExMTRmZjU1YzMifQ==&Rh-Identify=9cba5f46e9f052e759b4173fa8a8cd88&rand=0.40633851303103974"
  ],
  "duration": "6",
  "resolution": "720p",
  "aspectRatio": "16:9"
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `prompt` | String | 必填 | 视频内容描述。建议详细描述参考图如何运动、镜头变化、画面风格和音频提示。<br>文本长度限制: 1 - 2048 |
| `imageUrls` | List(String) | 必填 | 参考图片。支持 1 张单图生视频或 3 张参考图融合；不支持 2 张图。<br>最多支持 3 项图片，每张 10 MB |
| `duration` | String | 必填 | 视频时长，单位为秒。仅支持 4、6、8、10。<br>枚举值: [4, 6, 8, 10] |
| `resolution` | String | 必填 | 视频分辨率。<br>枚举值: [720p, 1080p, 4k] |
| `aspectRatio` | String | 可选 | 视频宽高比。<br>枚举值: [16:9, 9:16] |

#### 响应示例

```json
{
  "taskId": "2013508786110730241",
  "status": "RUNNING",
  "errorCode": "",
  "errorMessage": "",
  "results": null,
  "clientId": "f828b9af25161bc066ef152db7b29ccc",
  "promptTips": "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"4\"], \"node_errors\": {}}"
}
```

#### 响应字段说明

| 参数说明 | 类型 | AI 应用程序生成的结果。 |
| --- | --- | --- |
| `taskId` | String | 任务ID，用于后续查询任务状态 |
| `status` | String | 当前任务状态，常见状态：QUEUED (排队中), RUNNING (运行中), SUCCESS (成功), FAILED (失败) |
| `errorCode` | String | 错误码，仅在失败时返回 |
| `errorMessage` | String | 错误具体信息 |
| `results` | List | 生成结果（提交时为 null） |
| ├ `url` | String | 重要提醒：该链接有效期仅为 24 小时。任务生成结束后，请务必在此时间窗口内将视频文件下载或转存至您的服务器。逾期后链接将永久失效且无法恢复。 |
| ├ `nodeId` | String | 生成该结果的工作流节点 ID |
| ├ `outputType` | String | 文件扩展名 (如 png, mp4, txt) |
| └ `text` | String | 如果输出是纯文本，内容将显示在此字段 |
| `clientId` | String | 客户端会话ID，用于标识本次连接 |
| `promptTips` | String (JSON) | ComfyUI 后端的校验信息，包含需执行的节点ID等调试信息 |

### 查询结果与 Webhook

如果在提交时添加了 "webhookUrl": "https://example.com/webhook" 请求体参数，RunningHub 会在任务完成时向您的URL发送POST请求

#### 请求示例

```curl
curl --location --request POST 'https://www.runninghub.ai/openapi/v2/query' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "taskId": "${RUNNINGHUB_TASKID}"
}'
```

#### 响应示例

```json
{
  "taskId": "2013508786110730241",
  "status": "SUCCESS",
  "errorCode": "",
  "errorMessage": "",
  "failedReason": {},
  "usage": {
    "consumeMoney": null,
    "consumeCoins": null,
    "taskCostTime": "0",
    "thirdPartyConsumeMoney": null
  },
  "results": [
    {
      "url": "https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/b04e28cad0ee39193921a30a2eb4dc00/output/ComfyUI_00001_plhjr_1768892915.png",
      "nodeId": "2",
      "outputType": "png",
      "text": null
    }
  ],
  "clientId": "",
  "promptTips": ""
}
```

#### 响应字段说明

| 参数说明 | 类型 | AI 应用程序生成的结果。 |
| --- | --- | --- |
| `taskId` | String | 任务 ID |
| `status` | String | 任务最终状态，SUCCESS 表示生成成功 |
| `results` | List | 生成结果列表，包含图片、视频或文本等输出 |
| ├ `url` | String | 重要提醒：该链接有效期仅为 24 小时。任务生成结束后，请务必在此时间窗口内将视频文件下载或转存至您的服务器。逾期后链接将永久失效且无法恢复。 |
| ├ `nodeId` | String | 生成该结果的工作流节点 ID |
| ├ `outputType` | String | 文件扩展名 (如 png, mp4, txt) |
| └ `text` | String | 如果输出是纯文本，内容将显示在此字段 |
| `errorCode` | String | 错误码 (如有) |
| `errorMessage` | String | 错误信息 (如有) |
| `failedReason` | Object | ComfyUI 相关的失败原因 |
| `usage` | Object | 任务消耗信息 |
| ├ `thirdPartyConsumeMoney` | String | 三方API消费金额 |
| ├ `consumeMoney` | String | 运行时长消耗金额 |
| ├ `consumeCoins` | String | 运行消耗的RH币 |
| └ `taskCostTime` | String | 运行耗时（ComfyUI 工作流运行时长） |
### 文件上传

资源文件（如 imageUrls）参数支持传入文件 URL 或 Base64 Data URI。

#### 公共 URL

直接传递可公开访问的 URL：

```json
{
  "imageUrls": [
    "https://example.com/image.png"
  ]
}
```

#### Base64 data URI

以 Base64 格式嵌入图片：

```json
{
  "images": [
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  ]
}
```

#### RH 上传接口

上传本地文件以获取一个 URL。

**Endpoint:** `https://www.runninghub.ai/openapi/v2/media/upload/binary`

**请求**

```curl
curl --location --request POST 'https://www.runninghub.ai/openapi/v2/media/upload/binary' \
--header 'Authorization: Bearer [Your API KEY]' \
--form 'file=@/path/to/image.png'
```

**响应**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "type": "image",
    "download_url": "xxxx.png",
    "fileName": "openapi/xxxx.png",
    "size": "3490"
  }
}
```

**备注:** 上传后获得的链接有效期为 1 天，超期将无法通过 URL 直接访问。


# /gemini-omni-flash/text-to-video
全能视频 Omni Flash 文生视频-低价渠道版
### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.ai/openapi/v2/gemini-omni-flash/text-to-video' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "prompt": "a beautiful sunset over the ocean with seagulls flying",
  "duration": "6",
  "resolution": "720p",
  "aspectRatio": "16:9"
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `prompt` | String | 必填 | 视频内容描述。建议详细描述场景、人物、动作、环境、镜头运动、画面风格和音频提示。<br>文本长度限制: 1 - 2048 |
| `duration` | String | 必填 | 视频时长，单位为秒。仅支持 4、6、8、10。<br>枚举值: [4, 6, 8, 10] |
| `resolution` | String | 必填 | 视频分辨率。<br>枚举值: [720p, 1080p, 4k] |
| `aspectRatio` | String | 可选 | 视频宽高比。<br>枚举值: [16:9, 9:16] |

#### 响应示例

```json
{
  "taskId": "2013508786110730241",
  "status": "RUNNING",
  "errorCode": "",
  "errorMessage": "",
  "results": null,
  "clientId": "f828b9af25161bc066ef152db7b29ccc",
  "promptTips": "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"4\"], \"node_errors\": {}}"
}
```

#### 响应字段说明

| 参数说明 | 类型 | AI 应用程序生成的结果。 |
| --- | --- | --- |
| `taskId` | String | 任务ID，用于后续查询任务状态 |
| `status` | String | 当前任务状态，常见状态：QUEUED (排队中), RUNNING (运行中), SUCCESS (成功), FAILED (失败) |
| `errorCode` | String | 错误码，仅在失败时返回 |
| `errorMessage` | String | 错误具体信息 |
| `results` | List | 生成结果（提交时为 null） |
| ├ `url` | String | 重要提醒：该链接有效期仅为 24 小时。任务生成结束后，请务必在此时间窗口内将视频文件下载或转存至您的服务器。逾期后链接将永久失效且无法恢复。 |
| ├ `nodeId` | String | 生成该结果的工作流节点 ID |
| ├ `outputType` | String | 文件扩展名 (如 png, mp4, txt) |
| └ `text` | String | 如果输出是纯文本，内容将显示在此字段 |
| `clientId` | String | 客户端会话ID，用于标识本次连接 |
| `promptTips` | String (JSON) | ComfyUI 后端的校验信息，包含需执行的节点ID等调试信息 |

### 查询结果与 Webhook

如果在提交时添加了 "webhookUrl": "https://example.com/webhook" 请求体参数，RunningHub 会在任务完成时向您的URL发送POST请求

#### 请求示例

```curl
curl --location --request POST 'https://www.runninghub.ai/openapi/v2/query' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "taskId": "${RUNNINGHUB_TASKID}"
}'
```

#### 响应示例

```json
{
  "taskId": "2013508786110730241",
  "status": "SUCCESS",
  "errorCode": "",
  "errorMessage": "",
  "failedReason": {},
  "usage": {
    "consumeMoney": null,
    "consumeCoins": null,
    "taskCostTime": "0",
    "thirdPartyConsumeMoney": null
  },
  "results": [
    {
      "url": "https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/b04e28cad0ee39193921a30a2eb4dc00/output/ComfyUI_00001_plhjr_1768892915.png",
      "nodeId": "2",
      "outputType": "png",
      "text": null
    }
  ],
  "clientId": "",
  "promptTips": ""
}
```

#### 响应字段说明

| 参数说明 | 类型 | AI 应用程序生成的结果。 |
| --- | --- | --- |
| `taskId` | String | 任务 ID |
| `status` | String | 任务最终状态，SUCCESS 表示生成成功 |
| `results` | List | 生成结果列表，包含图片、视频或文本等输出 |
| ├ `url` | String | 重要提醒：该链接有效期仅为 24 小时。任务生成结束后，请务必在此时间窗口内将视频文件下载或转存至您的服务器。逾期后链接将永久失效且无法恢复。 |
| ├ `nodeId` | String | 生成该结果的工作流节点 ID |
| ├ `outputType` | String | 文件扩展名 (如 png, mp4, txt) |
| └ `text` | String | 如果输出是纯文本，内容将显示在此字段 |
| `errorCode` | String | 错误码 (如有) |
| `errorMessage` | String | 错误信息 (如有) |
| `failedReason` | Object | ComfyUI 相关的失败原因 |
| `usage` | Object | 任务消耗信息 |
| ├ `thirdPartyConsumeMoney` | String | 三方API消费金额 |
| ├ `consumeMoney` | String | 运行时长消耗金额 |
| ├ `consumeCoins` | String | 运行消耗的RH币 |
| └ `taskCostTime` | String | 运行耗时（ComfyUI 工作流运行时长） |
### 文件上传

资源文件（如 imageUrls）参数支持传入文件 URL 或 Base64 Data URI。

#### 公共 URL

直接传递可公开访问的 URL：

```json
{
  "imageUrls": [
    "https://example.com/image.png"
  ]
}
```

#### Base64 data URI

以 Base64 格式嵌入图片：

```json
{
  "images": [
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  ]
}
```

#### RH 上传接口

上传本地文件以获取一个 URL。

**Endpoint:** `https://www.runninghub.ai/openapi/v2/media/upload/binary`

**请求**

```curl
curl --location --request POST 'https://www.runninghub.ai/openapi/v2/media/upload/binary' \
--header 'Authorization: Bearer [Your API KEY]' \
--form 'file=@/path/to/image.png'
```

**响应**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "type": "image",
    "download_url": "xxxx.png",
    "fileName": "openapi/xxxx.png",
    "size": "3490"
  }
}
```

**备注:** 上传后获得的链接有效期为 1 天，超期将无法通过 URL 直接访问。


# 接口:/gemini-omni-flash/video-edit

全能视频 Omni Flash 视频编辑-低价渠道版

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.ai/openapi/v2/gemini-omni-flash/video-edit' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "prompt": "生成参考图片中的小猫模仿参考视频中小猫动作的视频。",
  "imageUrls": [
    "https://www.runninghub.cn/view?filename=6ca9f2bc444d2a0b48f6853309306d59894a96761be98eebbfaacbf68e49d043.png&type=input&subfolder=&Rh-Comfy-Auth=eyJ1c2VySWQiOiJjMjdjNjJmNTBkM2RjNTI4YzNhNDQ3YmExNzJmNjE3YyIsInNpZ25FeHBpcmUiOjE3ODA1NjUyNDQ0NDMsInRzIjoxNzc5OTYwNDQ0NDQzLCJzaWduIjoiMDcyNmM2MjcyNTg3MjQ3Y2U0MjZhNDg3YWEzNjZlNzMifQ==&Rh-Identify=c27c62f50d3dc528c3a447ba172f617c&rand=0.6218910104744774"
  ],
  "resolution": "720p",
  "aspectRatio": "16:9",
  "videoUrl": "https://www.runninghub.cn/view?filename=165d5c40d236d30be89fdb7b8c768f106762703360c36bec7ee968d35c1fcfd2.mp4&type=input&subfolder=&Rh-Comfy-Auth=eyJ1c2VySWQiOiJjMjdjNjJmNTBkM2RjNTI4YzNhNDQ3YmExNzJmNjE3YyIsInNpZ25FeHBpcmUiOjE3ODA1NjUyNDQ0NDMsInRzIjoxNzc5OTYwNDQ0NDQzLCJzaWduIjoiMDcyNmM2MjcyNTg3MjQ3Y2U0MjZhNDg3YWEzNjZlNzMifQ==&Rh-Identify=c27c62f50d3dc528c3a447ba172f617c&rand=0.3790315147628933"
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `prompt` | String | 必填 | 视频内容描述。建议详细描述参考图如何运动、镜头变化、画面风格和音频提示。<br>文本长度限制: 1 - 2048 |
| `imageUrls` | List(String) | 可选 | 参考图片，仅支持 1 张或 3 张<br>最多支持 3 项图片，每张 10 MB |
| `resolution` | String | 必填 | 视频分辨率<br>枚举值: [720p, 1080p, 4k] |
| `aspectRatio` | String | 可选 | 视频宽高比<br>枚举值: [16:9, 9:16] |
| `videoUrl` | String | 必填 | 参考视频，可与 imageUrls 同时传入，图片作为身份或构图参考，视频作为动态参考。<br>最多支持 1 项视频，每个 10 MB |

#### 响应示例

```json
{
  "taskId": "2013508786110730241",
  "status": "RUNNING",
  "errorCode": "",
  "errorMessage": "",
  "results": null,
  "clientId": "f828b9af25161bc066ef152db7b29ccc",
  "promptTips": "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"4\"], \"node_errors\": {}}"
}
```

#### 响应字段说明

| 参数说明 | 类型 | AI 应用程序生成的结果。 |
| --- | --- | --- |
| `taskId` | String | 任务ID，用于后续查询任务状态 |
| `status` | String | 当前任务状态，常见状态：QUEUED (排队中), RUNNING (运行中), SUCCESS (成功), FAILED (失败) |
| `errorCode` | String | 错误码，仅在失败时返回 |
| `errorMessage` | String | 错误具体信息 |
| `results` | List | 生成结果（提交时为 null） |
| ├ `url` | String | 重要提醒：该链接有效期仅为 24 小时。任务生成结束后，请务必在此时间窗口内将视频文件下载或转存至您的服务器。逾期后链接将永久失效且无法恢复。 |
| ├ `nodeId` | String | 生成该结果的工作流节点 ID |
| ├ `outputType` | String | 文件扩展名 (如 png, mp4, txt) |
| └ `text` | String | 如果输出是纯文本，内容将显示在此字段 |
| `clientId` | String | 客户端会话ID，用于标识本次连接 |
| `promptTips` | String (JSON) | ComfyUI 后端的校验信息，包含需执行的节点ID等调试信息 |

### 查询结果与 Webhook

如果在提交时添加了 "webhookUrl": "https://example.com/webhook" 请求体参数，RunningHub 会在任务完成时向您的URL发送POST请求

#### 请求示例

```curl
curl --location --request POST 'https://www.runninghub.ai/openapi/v2/query' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "taskId": "${RUNNINGHUB_TASKID}"
}'
```

#### 响应示例

```json
{
  "taskId": "2013508786110730241",
  "status": "SUCCESS",
  "errorCode": "",
  "errorMessage": "",
  "failedReason": {},
  "usage": {
    "consumeMoney": null,
    "consumeCoins": null,
    "taskCostTime": "0",
    "thirdPartyConsumeMoney": null
  },
  "results": [
    {
      "url": "https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/b04e28cad0ee39193921a30a2eb4dc00/output/ComfyUI_00001_plhjr_1768892915.png",
      "nodeId": "2",
      "outputType": "png",
      "text": null
    }
  ],
  "clientId": "",
  "promptTips": ""
}
```

#### 响应字段说明

| 参数说明 | 类型 | AI 应用程序生成的结果。 |
| --- | --- | --- |
| `taskId` | String | 任务 ID |
| `status` | String | 任务最终状态，SUCCESS 表示生成成功 |
| `results` | List | 生成结果列表，包含图片、视频或文本等输出 |
| ├ `url` | String | 重要提醒：该链接有效期仅为 24 小时。任务生成结束后，请务必在此时间窗口内将视频文件下载或转存至您的服务器。逾期后链接将永久失效且无法恢复。 |
| ├ `nodeId` | String | 生成该结果的工作流节点 ID |
| ├ `outputType` | String | 文件扩展名 (如 png, mp4, txt) |
| └ `text` | String | 如果输出是纯文本，内容将显示在此字段 |
| `errorCode` | String | 错误码 (如有) |
| `errorMessage` | String | 错误信息 (如有) |
| `failedReason` | Object | ComfyUI 相关的失败原因 |
| `usage` | Object | 任务消耗信息 |
| ├ `thirdPartyConsumeMoney` | String | 三方API消费金额 |
| ├ `consumeMoney` | String | 运行时长消耗金额 |
| ├ `consumeCoins` | String | 运行消耗的RH币 |
| └ `taskCostTime` | String | 运行耗时（ComfyUI 工作流运行时长） |
### 文件上传

资源文件（如 imageUrls）参数支持传入文件 URL 或 Base64 Data URI。

#### 公共 URL

直接传递可公开访问的 URL：

```json
{
  "imageUrls": [
    "https://example.com/image.png"
  ]
}
```

#### Base64 data URI

以 Base64 格式嵌入图片：

```json
{
  "images": [
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  ]
}
```

#### RH 上传接口

上传本地文件以获取一个 URL。

**Endpoint:** `https://www.runninghub.ai/openapi/v2/media/upload/binary`

**请求**

```curl
curl --location --request POST 'https://www.runninghub.ai/openapi/v2/media/upload/binary' \
--header 'Authorization: Bearer [Your API KEY]' \
--form 'file=@/path/to/image.png'
```

**响应**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "type": "image",
    "download_url": "xxxx.png",
    "fileName": "openapi/xxxx.png",
    "size": "3490"
  }
}
```

**备注:** 上传后获得的链接有效期为 1 天，超期将无法通过 URL 直接访问。

