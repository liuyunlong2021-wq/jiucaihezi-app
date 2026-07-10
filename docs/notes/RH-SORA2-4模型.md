# Sora2-文生视频-低价渠道版
接口:
/rhart-video-s/text-to-video


文生视频，是一款顶尖的音视频一体化生成模型，基于初代全能视频S技术底座打造。相较前代视频模型实现全面升级，具备更精准的物理运动效果、超高清的写实画质、音画同步匹配、更强的可控性，以及更丰富的风格表达维度，可满足多元创作需求。低价渠道版，价格远低于官方稳定版，不稳定。


### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/rhart-video-s/text-to-video' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "duration": "10",
  "prompt": "阳光透过高大的橡树洒在一片魔法森林中，小狐狸与会说话的蘑菇一起跳舞，远处有瀑布和漂浮的蒲公英。画面柔和温暖，手绘动画质感，色彩明亮饱和，镜头缓慢推进，风格致敬宫崎骏《龙猫》。",
  "aspectRatio": "9:16",
  "storyboard": false
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `duration` | String | 必填 | 枚举值: [10, 15] |
| `prompt` | String | 必填 | 文本长度限制: 5 - 4000 |
| `aspectRatio` | String | 必填 | 枚举值: [9:16, 16:9] |
| `storyboard` | Boolean | 可选 |  |

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
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/query' \
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

**Endpoint:** `https://www.runninghub.cn/openapi/v2/media/upload/binary`

**请求**

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/media/upload/binary' \
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



# Sora2-图生视频-低价渠道版
接口:
接口:
/rhart-video-s/image-to-video

图生视频，可将单张参考图转化为画面连贯、音频同步匹配的视频片段。依托全能视频S核心技术升级，该图生视频流程能完整保留主体身份、光影效果与画面构图，同时智能合成逼真的动态效果与专业镜头运镜，呈现极致惊艳的视觉表现。低价渠道版，价格远低于官方稳定版，不稳定


### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/rhart-video-s/image-to-video' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "imageUrl": "https://www.runninghub.cn/view?filename=7226c36bd0532c86b6f22780a6bc8e603b81b56e8ba83dd6411fcaced2228b84.png&type=input&subfolder=&Rh-Comfy-Auth=eyJ1c2VySWQiOiIzZjY1MTNlNWEwNjY1N2I4OGYyNjU5NTEzYmU3ZDM0YyIsInNpZ25FeHBpcmUiOjE3Njg5MTAyODM5MTksInRzIjoxNzY4MzA1NDgzOTE5LCJzaWduIjoiZTdhYThjMWU5ZjcxMWM5ZjIyMjA2NWYxNjQ1MTM2NmIifQ==&Rh-Identify=3f6513e5a06657b88f2659513be7d34c&rand=0.23897629876295323",
  "duration": "10",
  "aspectRatio": "9:16",
  "prompt": "基于原图生成10秒动态视频，角色使用地道男声京腔配音，语气带点胡同大爷的调侃劲儿。 0–2秒：狸花猫翘着二郎腿，爪尖轻敲桌面，斜眼笑：“咱这节目今天炸了啊！” 2–5秒：哈士奇一愣，领结歪了也不管，急问：“真的啊？咱上热搜了？” 5–10秒：哈士奇瞬间石化，瞳孔地震；狸花猫憋不住，“噗”地笑出声，拍桌打滚，耳机滑到耳朵尖，背景霓虹灯“Whisker & Howl”同步闪红——全场爆笑收尾！",
  "storyboard": false
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `imageUrl` | String | 必填 | 最多支持 1 项图片，每张 50 MB |
| `duration` | String | 必填 | 枚举值: [10, 15] |
| `aspectRatio` | String | 必填 | 枚举值: [9:16, 16:9] |
| `prompt` | String | 必填 | 文本长度限制: 5 - 4000 |
| `storyboard` | Boolean | 可选 |  |

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
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/query' \
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

**Endpoint:** `https://www.runninghub.cn/openapi/v2/media/upload/binary`

**请求**

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/media/upload/binary' \
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

# Sora2-图生视频-支持真人-官方稳定版
接口:
/rhart-video-s-official/image-to-video-realistic

可将单张参考图转化为连贯极致的写实视频片段，音画完美同步。全面整合全系列产品核心优势，涵盖身份锁定、物理精准、3D景深感知、电影级运镜、细节保真及强可控性；专属支持官方直连，性能稳定，可生成真人主体，动态自然、视觉效果高度还原真实。本接口采用官方原生 API 协议，该协议目前未开放对 Web/App 端个人角色库（Cameo）的访问，暂不支持通过 @ 语法引用角色。官方稳定版，稳定高效，价格低于直接模型官方。


### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/rhart-video-s-official/image-to-video-realistic' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "prompt": "生成一段视频",
  "duration": "4",
  "imageUrl": "https://www.runninghub.cn/view?filename=310765645fa209c394a6a673da7c69da23acdd8e0de199ae35f1bfc25b461fa9.png&type=input&subfolder=&Rh-Comfy-Auth=eyJ1c2VySWQiOiIzZjY1MTNlNWEwNjY1N2I4OGYyNjU5NTEzYmU3ZDM0YyIsInNpZ25FeHBpcmUiOjE3Njg5MTk3ODAxMzksInRzIjoxNzY4MzE0OTgwMTM5LCJzaWduIjoiYmM2Zjg3MWJjMDIzMDMxNWRmYTJlZWZmODVjMDFmNDAifQ==&Rh-Identify=3f6513e5a06657b88f2659513be7d34c&rand=0.8120873731053279"
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `prompt` | String | 必填 |  |
| `duration` | String | 必填 | 枚举值: [4, 8, 12] |
| `imageUrl` | String | 必填 | 最多支持 1 项图片，每张 10 MB |

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
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/query' \
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

**Endpoint:** `https://www.runninghub.cn/openapi/v2/media/upload/binary`

**请求**

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/media/upload/binary' \
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


# Sora2-角色上传-低价渠道版
接口:
/rhart-video-s/sora-upload-character
copy

根据视频创建对应的形象。低价渠道版，价格远低于官方稳定版，不稳定。
### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/rhart-video-s/sora-upload-character' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "videoUrl": null
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `videoUrl` | String | 必填 | 最多支持 1 项视频，每个 10 MB |

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
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/query' \
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

**Endpoint:** `https://www.runninghub.cn/openapi/v2/media/upload/binary`

**请求**

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/media/upload/binary' \
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

