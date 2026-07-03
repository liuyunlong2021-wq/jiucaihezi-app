# seedance2.0/多模态视频

## 开始使用

### 注册用户

先注册成为RunningHub网站的用户，并充值钱包。标准模型API仅支持企业级-共享API Key

### 获取您的 API Key

RunningHub 为每位用户自动生成一个独特的 32 位 API KEY

请妥善保存您的 API KEY，不要外泄，后续步骤将依赖此密钥进行操作

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0/multimodal-video' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "prompt": "@Image 1 图中的两个人，坐在一起吃火锅，火锅场景是@Video 1 ",
  "resolution": "720p",
  "duration": "5",
  "imageUrls": [
    "https://www.runninghub.cn/view?filename=749553f108589cc945859673785ab734d0e0b7e729e6c9382fcd3b5b6e7c45bc.jpg&type=input&subfolder=&Rh-Comfy-Auth=eyJ1c2VySWQiOiIzZjY1MTNlNWEwNjY1N2I4OGYyNjU5NTEzYmU3ZDM0YyIsInNpZ25FeHBpcmUiOjE3NzU4MjY4Nzg3MTEsInRzIjoxNzc1MjIyMDc4NzExLCJzaWduIjoiZDg1MTIwNmVkOGM4NjliNjcwZDNmYTdjMGEyNTM3ZmEifQ==&Rh-Identify=3f6513e5a06657b88f2659513be7d34c&rand=0.9945860180516704"
  ],
  "videoUrls": [
    "https://www.runninghub.cn/view?filename=32717a3776ec2205c8042a9971489f9593ff1f79aaaae2a20065d268ad20db37.mp4&type=input&subfolder=&Rh-Comfy-Auth=eyJ1c2VySWQiOiIzZjY1MTNlNWEwNjY1N2I4OGYyNjU5NTEzYmU3ZDM0YyIsInNpZ25FeHBpcmUiOjE3NzU4MjY4Nzg3MTEsInRzIjoxNzc1MjIyMDc4NzExLCJzaWduIjoiZDg1MTIwNmVkOGM4NjliNjcwZDNmYTdjMGEyNTM3ZmEifQ==&Rh-Identify=3f6513e5a06657b88f2659513be7d34c&rand=0.656071722827794"
  ],
  "audioUrls": [],
  "generateAudio": true,
  "ratio": "adaptive",
  "realPersonMode": true,
  "conversionSlots": [
    "all"
  ],
  "returnLastFrame": false
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `prompt` | String | 必填 | 视频生成提示词<br>文本长度限制: 1 - 20480 |
| `resolution` | String | 必填 | 视频分辨率。分为模型原生输出的分辨率（480p、720p、native1080p），与基于 720p 原生生成后进行超分放大的分辨率（1080p、2k、4k）。<br>枚举值: [480p, 720p, native1080p, 1080p, 2k, 4k] |
| `duration` | String | 必填 | 视频时长（秒），自动表示由模型智能选择<br>枚举值: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] |
| `imageUrls` | List(String) | 可选 | 参考图片（0-9张）<br>最多支持 9 项图片，每张 30 MB |
| `videoUrls` | List(String) | 可选 | 参考视频（0-3个，用于多模态参考/视频编辑/视频续写）。单个视频时长 [2, 15] s，最多传入 3 个参考视频，所有视频总时长不超过 15s。<br>最多支持 3 项视频，每个 50 MB |
| `audioUrls` | List(String) | 可选 | 参考音频（0-3个，需至少包含1个参考视频或图片）。单个音频时长 [2, 15] s，最多传入 3 段参考音频，所有音频总时长不超过 15 s。<br>最多支持 3 项音频，每个 50 MB |
| `generateAudio` | Boolean | 可选 | 是否生成视频音频 |
| `ratio` | String | 可选 | 视频宽高比<br>枚举值: [adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9] |
| `realPersonMode` | Boolean | 可选 | 真人模式，开启后系统会自动将图片/视频/音频转为火山资产（asset://），提升生成效果。 |
| `conversionSlots` | String | 可选 | 真人素材资产化槽位，多选；all 表示所有图片/视频槽位都做资产化。<br>枚举值: [all, image1, image2, image3, image4, image5, image6, image7, image8, image9, video1, video2, video3] |
| `returnLastFrame` | Boolean | 可选 | 是否返回视频尾帧图片 |

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


# seedance2.0/图生视频

## 开始使用

### 注册用户

先注册成为RunningHub网站的用户，并充值钱包。标准模型API仅支持企业级-共享API Key

### 获取您的 API Key

RunningHub 为每位用户自动生成一个独特的 32 位 API KEY

请妥善保存您的 API KEY，不要外泄，后续步骤将依赖此密钥进行操作

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0/image-to-video' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "prompt": null,
  "resolution": "720p",
  "duration": "5",
  "firstFrameUrl": "https://www.runninghub.cn/view?filename=45ea80db274a089663c6697824b4344e30a80fa71e3fc2dfb701e2a2a8687a59.jpg&type=input&subfolder=&Rh-Comfy-Auth=eyJ1c2VySWQiOiIzZjY1MTNlNWEwNjY1N2I4OGYyNjU5NTEzYmU3ZDM0YyIsInNpZ25FeHBpcmUiOjE3NzUwNDAwMzQxNzcsInRzIjoxNzc0NDM1MjM0MTc3LCJzaWduIjoiOGQxMDg4MjNjYjdiODYzNWJiNDhjNWY1NTBmNDkwMmUifQ==&Rh-Identify=3f6513e5a06657b88f2659513be7d34c&rand=0.32092521221860737",
  "lastFrameUrl": "https://www.runninghub.cn/view?filename=33dea2893419d2c92834bb9bd44cbf1a80319548b10a8a3e3ecbbbda451285ed.jpg&type=input&subfolder=&Rh-Comfy-Auth=eyJ1c2VySWQiOiIzZjY1MTNlNWEwNjY1N2I4OGYyNjU5NTEzYmU3ZDM0YyIsInNpZ25FeHBpcmUiOjE3NzUwNDAwMzQxNzcsInRzIjoxNzc0NDM1MjM0MTc3LCJzaWduIjoiOGQxMDg4MjNjYjdiODYzNWJiNDhjNWY1NTBmNDkwMmUifQ==&Rh-Identify=3f6513e5a06657b88f2659513be7d34c&rand=0.2920028145025285",
  "generateAudio": true,
  "ratio": "adaptive",
  "realPersonMode": true,
  "conversionSlots": [
    "all"
  ],
  "returnLastFrame": false
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `prompt` | String | 可选 | 视频生成提示词<br>文本长度限制: 0 - 20480 |
| `resolution` | String | 必填 | 视频分辨率。分为模型原生输出的分辨率（480p、720p、native1080p），与基于 720p 原生生成后进行超分放大的分辨率（1080p、2k、4k）。<br>枚举值: [480p, 720p, native1080p, 1080p, 2k, 4k] |
| `duration` | String | 必填 | 视频时长（秒），自动表示由模型智能选择<br>枚举值: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] |
| `firstFrameUrl` | String | 必填 | 首帧图片<br>最多支持 1 项图片，每张 30 MB |
| `lastFrameUrl` | String | 可选 | 尾帧图片（可选，首尾帧模式）<br>最多支持 1 项图片，每张 30 MB |
| `generateAudio` | Boolean | 可选 | 是否生成视频音频 |
| `ratio` | String | 可选 | 视频宽高比<br>枚举值: [adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9] |
| `realPersonMode` | Boolean | 可选 | 真人模式，开启后系统会自动将图片/视频/音频转为火山资产（asset://），提升生成效果。 |
| `conversionSlots` | String | 可选 | 真人素材资产化槽位，多选；all 表示首帧与尾帧都做资产化。<br>枚举值: [all, firstFrameUrl, lastFrameUrl] |
| `returnLastFrame` | Boolean | 可选 | 是否返回视频尾帧图片 |

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

# seedance2.0/文生视频

## 开始使用

### 注册用户

先注册成为RunningHub网站的用户，并充值钱包。标准模型API仅支持企业级-共享API Key

### 获取您的 API Key

RunningHub 为每位用户自动生成一个独特的 32 位 API KEY

请妥善保存您的 API KEY，不要外泄，后续步骤将依赖此密钥进行操作

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0/text-to-video' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "prompt": "一部武侠风格的电影级大片。大雨滂沱的暗夜竹林中，一名白衣剑客与一名披着蓑衣的刺客正在激烈近战。镜头首先是广角全景，展示两人在竹林中高速穿梭和见招拆招的肢体互动；随后镜头平滑且无缝地急推至极限特写，两把利剑在半空中猛烈碰撞，迸发出极其耀眼的火花。雨滴真实地溅落在冰冷的剑刃上并随动作瞬间甩出。人物面部表情清晰，物理运动规律极其准确。",
  "resolution": "720p",
  "duration": "5",
  "generateAudio": true,
  "ratio": "adaptive",
  "webSearch": false,
  "returnLastFrame": false
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `prompt` | String | 必填 | 视频生成提示词<br>文本长度限制: 1 - 20480 |
| `resolution` | String | 必填 | 视频分辨率。分为模型原生输出的分辨率（480p、720p、native1080p），与基于 720p 原生生成后进行超分放大的分辨率（1080p、2k、4k）。<br>枚举值: [480p, 720p, native1080p, 1080p, 2k, 4k] |
| `duration` | String | 必填 | 视频时长（秒），自动表示由模型智能选择<br>枚举值: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] |
| `generateAudio` | Boolean | 可选 | 是否生成视频音频 |
| `ratio` | String | 可选 | 视频宽高比<br>枚举值: [adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9] |
| `webSearch` | Boolean | 可选 | 启用联网搜索增强 |
| `returnLastFrame` | Boolean | 可选 | 是否返回视频尾帧图片 |

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

