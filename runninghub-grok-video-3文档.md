# 图生视频

## 开始使用

### 注册用户

先注册成为RunningHub网站的用户，并充值钱包。标准模型API仅支持企业级-共享API Key

### 获取您的 API Key

RunningHub 为每位用户自动生成一个独特的 32 位 API KEY

请妥善保存您的 API KEY，不要外泄，后续步骤将依赖此密钥进行操作

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/rhart-video-g/image-to-video' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "prompt": "少女缓缓在废墟中转身，她的液态金属皮肤随着动作产生流动感，反射着周围斑驳的火光。丝绸长裙在风中剧烈摆动，展现出真实的布料物理褶皱。少女伸出手，指尖在虚空中划出金色的火星，火星产生的强光在她的面部形成自然的动态阴影偏移。",
  "aspectRatio": "2:3",
  "imageUrls": [
    "https://www.runninghub.cn/view?filename=1c35849fb2547490f25c08dfecb2dbc587e720a4698eca9a4643c2a654d5c59d.jpg&type=input&subfolder=&Rh-Comfy-Auth=eyJ1c2VySWQiOiIzZjY1MTNlNWEwNjY1N2I4OGYyNjU5NTEzYmU3ZDM0YyIsInNpZ25FeHBpcmUiOjE3NzA5OTk0NDgwNTYsInRzIjoxNzcwMzk0NjQ4MDU2LCJzaWduIjoiNTNlY2U4YTY5OWRmMjA0OTE4YjE4NDVkMDFlNTU5OWEifQ==&Rh-Identify=3f6513e5a06657b88f2659513be7d34c&rand=0.79992383645995"
  ],
  "resolution": "480p",
  "duration": 14
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `prompt` | String | 必填 | 文本长度限制: 5 - 20000 |
| `aspectRatio` | String | 必填 | 枚举值: [2:3, 3:2, 1:1, 16:9, 9:16] |
| `imageUrls` | List(String) | 可选 | 最多支持 7 项图片，每张 10 MB |
| `resolution` | String | 必填 | 枚举值: [720p, 480p] |
| `duration` | Int | 可选 | 视频时长（秒），范围6-30秒<br>输入范围值: 6 - 30 |

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

# 文生视频

## 开始使用

### 注册用户

先注册成为RunningHub网站的用户，并充值钱包。标准模型API仅支持企业级-共享API Key

### 获取您的 API Key

RunningHub 为每位用户自动生成一个独特的 32 位 API KEY

请妥善保存您的 API KEY，不要外泄，后续步骤将依赖此密钥进行操作

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/rhart-video-g/text-to-video' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "prompt": "一个微观视角下的森林。一滴巨大的晨露从翠绿的叶尖滑落，正好击中下方平静的水洼，产生扩散的彩色涟漪。涟漪中映射出天空飞过的机械飞鸟。随着镜头上摇，阳光穿透厚重的云层，形成丁达尔效应，光束照亮了正在林间奔跑的一只半透明材质的电子鹿",
  "aspectRatio": "2:3",
  "resolution": "720p",
  "duration": 6
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `prompt` | String | 必填 | 文本长度限制: 5 - 20000 |
| `aspectRatio` | String | 必填 | 枚举值: [2:3, 3:2, 1:1, 16:9, 9:16] |
| `resolution` | String | 必填 | 枚举值: [720p, 480p] |
| `duration` | Int | 可选 | 视频时长（秒），范围6-30秒<br>输入范围值: 6 - 30 |

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

# 视频编辑

## 开始使用

### 注册用户

先注册成为RunningHub网站的用户，并充值钱包。标准模型API仅支持企业级-共享API Key

### 获取您的 API Key

RunningHub 为每位用户自动生成一个独特的 32 位 API KEY

请妥善保存您的 API KEY，不要外泄，后续步骤将依赖此密钥进行操作

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/rhart-video-g-official/edit-video' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "prompt": "将整个视频转换为经典的吉卜力2D动漫风格。画面色彩需要变得明亮温暖，阳光呈现出柔和的丁达尔效应。人物的衣着和狗的毛发需转化为细腻的手绘水彩质感。在人物奔跑和镜头移动的过程中，必须保持极高的时空一致性，确保背景中的树叶、草地以及人物边缘的线条平滑过渡，不出现任何画面闪烁、形变或闪动噪点。",
  "videoUrl": "https://www.runninghub.cn/view?filename=ae4f3202c15cee0fc7a560dae143206ea561c7feb423759dbdbbfe291922ec6c.mp4&type=input&subfolder=&Rh-Comfy-Auth=eyJ1c2VySWQiOiIzZjY1MTNlNWEwNjY1N2I4OGYyNjU5NTEzYmU3ZDM0YyIsInNpZ25FeHBpcmUiOjE3NzMwMzM3MTcyODQsInRzIjoxNzcyNDI4OTE3Mjg0LCJzaWduIjoiNjc4MDM1MTdiMjFjZThmMmI4MmZkNjJjY2I5MGE3ODgifQ==&Rh-Identify=3f6513e5a06657b88f2659513be7d34c&rand=0.3961472487197105",
  "resolution": "720p"
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `prompt` | String | 必填 | 文本长度限制: 5 - 800 |
| `videoUrl` | String | 必填 | 最多支持 1 项视频，每个 50 MB |
| `resolution` | String | 必填 | 枚举值: [720p, 480p] |

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

