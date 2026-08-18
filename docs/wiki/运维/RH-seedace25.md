# seedance2.5-global/多模态视频 Token

/bytedance/seedance-2.5-global-token/multimodal-video

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.ai/openapi/v2/bytedance/seedance-2.5-global-token/multimodal-video' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "prompt": "电影片段：纽约时代广场雨夜。新黑色调，变形宽银幕质感，克制、角色驱动，而非城市蒙太奇。  参考用法：参考图锁定时代广场构图、广告牌密度、霓虹配色与湿沥青反光；参考视频 1 决定人流节奏与镜头漂移；参考视频 2 决定室内延时能量；以参考音频作为配乐，压在雨声之下。  [00:00-00:07] 大雨中的大道全景，广告牌红蓝光在湿沥青上拖尾，黄色出租驶过积水，雨伞剪影穿越前景。缓慢横移。环境音：雨、胎水、远处警笛。 [00:07-00:13] 一个穿深色大衣的男人站在路口中央静止，人群从他身边流过；镜头缓慢前推，背景压缩成光斑。环境音：脚步、闷响车流。 [00:13-00:19] 切到透过雨痕玻璃看到的暖色酒吧内景：人影移动，琥珀色灯光溢到人行道；镜头沿玻璃横移，雨滴前景清晰。 [00:19-00:25] 回到室外，他转身背对镜头走进霓虹雾气；镜头锁定，雨势加强，剪影溶解进光里。渐黑并留出中心空间。  风格：新黑电影，变形眩光，饱和霓虹对深蓝阴影，湿地面高反光，浅景深，轻微胶片颗粒。 运镜：横移、缓慢前推、沿玻璃漂移、最终锁定。不要甩镜与快速变焦。 音频：雨与城市拟音叠低频爵士底，无对白。 避免：可读品牌 logo 或清晰广告牌文字；字幕与水印；面部与手部畸形；行人复制或穿模；跳切与闪烁。",
  "resolution": "720p",
  "duration": "5",
  "imageUrls": [
    "https://rh-images-switch-1252422369.cos.ap-guangzhou.myqcloud.com/input/openapi/seedance25-ref/example.jpg"
  ],
  "videoUrls": [
    "https://rh-images-switch-1252422369.cos.ap-guangzhou.myqcloud.com/input/openapi/seedance25-ref/example.mp4"
  ],
  "audioUrls": [
    "https://rh-images-switch-1252422369.cos.ap-guangzhou.myqcloud.com/input/openapi/seedance25-ref/example.mp3"
  ],
  "generateAudio": true,
  "ratio": "adaptive",
  "realPersonMode": true,
  "conversionSlots": [
    "all"
  ],
  "returnLastFrame": false,
  "bitrateMode": "standard",
  "seed": -1,
  "outputFormat": "mp4",
  "omniReferenceTaskType": "auto"
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `prompt` | String | 必填 | 视频生成提示词<br>文本长度限制: 1 - 20480 |
| `resolution` | String | 必填 | 视频分辨率。固定为模型原生输出的分辨率（native1080p），
| `duration` | String | 必填 | 视频时长（秒）。-1 为智能时长；4-30 秒可选。<br>枚举值: [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] |
| `imageUrls` | List(String) | 可选 | 参考图片（0-30 张）<br>最多支持 30 项图片，每张 50 MB |
| `videoUrls` | List(String) | 可选 | 参考视频（0-10 个，用于多模态参考/视频编辑/续写）。单个视频时长 [2, 30] s，所有视频总时长不超过 30s。<br>最多支持 10 项视频，每个 50 MB |
| `audioUrls` | List(String) | 可选 | 参考音频（0-10 段）。单个音频时长 [2, 30] s，所有音频总时长不超过 30s。<br>最多支持 10 项音频，每个 50 MB |
| `generateAudio` | Boolean | 可选 | 是否生成视频音频 |
| `ratio` | String | 可选 | 视频宽高比<br>枚举值: [adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9] |
| `realPersonMode` | Boolean | 可选 | 真人模式，开启后系统会自动将图片/视频/音频转为火山资产（asset://），提升生成效果。 |
| `conversionSlots` | List(String) | 可选 | 真人素材资产化槽位，多选；all 表示所有槽位都做资产化。<br>枚举值: [all, image1, image2, image3, image4, image5, image6, image7, image8, image9, image10, image11, image12, image13, image14, image15, image16, image17, image18, image19, image20, image21, image22, image23, image24, image25, image26, image27, image28, image29, image30, video1, video2, video3, video4, video5, video6, video7, video8, video9, video10] |
| `returnLastFrame` | Boolean | 可选 | 是否返回视频尾帧图片 |
| `bitrateMode` | String | 可选 | 画质档位。standard 标准；high 高画质（文件体积约为标准的 3-5 倍）。<br>枚举值: [standard, high] |
| `seed` | Int | 可选 | 种子整数，用于控制生成内容的随机性。<br>输入范围值: -1 - 2147483647 |
| `outputFormat` | String | 可选 | 输出视频的格式。mp4：通用格式，兼容性最好；mov：专业高色彩精度，推荐编辑/延长场景。<br>枚举值: [mp4, mov] |
| `omniReferenceTaskType` | String | 可选 | 全模态参考生视频任务类型引导。auto：模型自动判定；reference：参考生视频（ratio/duration 无特殊限制）；edit：视频编辑（须含 reference_video 且时长 4-30s，ratio 须 adaptive，duration 须 -1）；extend：视频延长（须含 reference_video，ratio 须 adaptive）。<br>枚举值: [auto, reference, edit, extend] |

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

