极速数字人
/run/ai-app/2028055408421642241

# 极速数字人 

## 1. 开始使用

### 注册用户

注册 RunningHub 账号并充值钱包后，即可开始使用 AI 应用 API 和 ComfyUI 工作流 API。
请注意：若您使用 消费级-会员 API Key，需拥有 基础版及以上会员 才能调用上述接口。
使用 企业级-共享 或 企业级-独占 API Key 的用户不受此限制。

### 获取您的 API Key

RunningHub 为每位用户自动生成一个独特的 32 位 API KEY

请妥善保存您的 API KEY，不要外泄，后续步骤将依赖此密钥进行操作

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/run/ai-app/2028055408421642241' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "nodeInfoList": [
    {
      "nodeId": "3",
      "fieldName": "audio",
      "fieldValue": "4cced0edde941aa71e2d1bb1abf28b5c9ce72f0396f05c9bb5f1102942e3243d.MP3",
      "description": "audio"
    },
    {
      "nodeId": "4",
      "fieldName": "image",
      "fieldValue": "ae67bddc8f1ed1ab2a2ddbeeaf0ca09dc66b6ba2fc18886455b42adda301fd73.png",
      "description": "image"
    },
    {
      "nodeId": "10",
      "fieldName": "value",
      "fieldValue": "832",
      "description": "value"
    }
  ],
  "instanceType": "default",
  "usePersonalQueue": "false"
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `nodeInfoList` | List | 必填 | 节点参数映射列表，用于动态修改工作流参数 |
| `instanceType` | String | 可选 | 指定运行实例的类型<br>default (24G显存), plus (48G显存) |
| `usePersonalQueue` | Boolean | 可选 | 是否使用个人独占队列 |
| `retainSeconds` | Integer | 可选 | 实例保留时长（秒）。仅企业共享 API Key 生效；任务成功结束后会在指定时长内优先复用同用户同工作流实例，减少冷启动与排队。该保留时段会产生额外费用，按实际保留时长计费。可选范围：10~180 秒。 |
| `webhookUrl` | String | 可选 | Webhook 回调地址，任务完成时会向该地址发送 POST 请求 |

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

如果在提交时添加了 "webhookUrl": "<https://example.com/webhook>" 请求体参数，RunningHub 会在任务完成时向您的URL发送POST请求

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

声音克隆
/run/ai-app/2046193597401276417

# 声音克隆

## 1. 开始使用

### 注册用户

注册 RunningHub 账号并充值钱包后，即可开始使用 AI 应用 API 和 ComfyUI 工作流 API。
请注意：若您使用 消费级-会员 API Key，需拥有 基础版及以上会员 才能调用上述接口。
使用 企业级-共享 或 企业级-独占 API Key 的用户不受此限制。

### 获取您的 API Key

RunningHub 为每位用户自动生成一个独特的 32 位 API KEY

请妥善保存您的 API KEY，不要外泄，后续步骤将依赖此密钥进行操作

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/run/ai-app/2046193597401276417' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "nodeInfoList": [
    {
      "nodeId": "4",
      "fieldName": "audio",
      "fieldValue": "ad2295dad3771d5a0d642c628f1b0cad04bbd9c07bb1bfcd3af2156052ea652a.MP3",
      "description": "参考音频"
    },
    {
      "nodeId": "6",
      "fieldName": "start_time",
      "fieldValue": "0:00",
      "description": "参考音频开始时间"
    },
    {
      "nodeId": "6",
      "fieldName": "end_time",
      "fieldValue": "0:11",
      "description": "参考音频结束时间"
    },
    {
      "nodeId": "36",
      "fieldName": "text",
      "fieldValue": "该吃吃该喝喝，遇事别忘心里搁，不吃不喝，死了谁说，良子大胃袋，属实挺带派，味真足！",
      "description": "参考音频文字内容"
    },
    {
      "nodeId": "11",
      "fieldName": "text",
      "fieldValue": "# 主流程\n\n1. 用户提交高层目标\n2. 系统创建 Task\n3. Orchestrator 读取：\n   - 用户目标\n   - 当前上下文\n   - 长脑子中相关知识\n4. Orchestrator 输出：\n   - 当前任务理解\n   - 当前阶段目标\n   - 下一步要调用的节点\n   - 该节点的输入参数\n   - 预期产出\n5. Event Bus 投递任务到对应节点\n6. 节点执行，输出结构化结果\n7. 执行结果写入长脑子：\n   - type\n   - title\n   - tags\n   - summary\n   - source_label\n   - indexed_content\n   - task_id\n   - node_id\n   - parent_step_id\n8. Orchestrator 重新读取最新状态和结果\n9. 判断：\n   - 是否继续下一步\n   - 是否切换节点\n   - 是否需要重试\n   - 是否需要用户确认\n   - 是否已经完成\n10. 循环直到任务结束\n11. Final Assembler 汇总所有关键结果返回用户",
      "description": "输出音频文字内容"
    },
    {
      "nodeId": "1",
      "fieldName": "语言",
      "fieldData": "[[\"自动\", \"中文\", \"英文\", \"日文\", \"韩文\", \"德文\", \"法文\", \"俄文\", \"葡萄牙文\", \"西班牙文\", \"意大利文\"], {\"default\": \"自动\"}]",
      "fieldValue": "中文",
      "description": "语言"
    }
  ],
  "instanceType": "default",
  "usePersonalQueue": "false"
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `nodeInfoList` | List | 必填 | 节点参数映射列表，用于动态修改工作流参数 |
| `instanceType` | String | 可选 | 指定运行实例的类型<br>default (24G显存), plus (48G显存) |
| `usePersonalQueue` | Boolean | 可选 | 是否使用个人独占队列 |
| `retainSeconds` | Integer | 可选 | 实例保留时长（秒）。仅企业共享 API Key 生效；任务成功结束后会在指定时长内优先复用同用户同工作流实例，减少冷启动与排队。该保留时段会产生额外费用，按实际保留时长计费。可选范围：10~180 秒。 |
| `webhookUrl` | String | 可选 | Webhook 回调地址，任务完成时会向该地址发送 POST 请求 |

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

如果在提交时添加了 "webhookUrl": "<https://example.com/webhook>" 请求体参数，RunningHub 会在任务完成时向您的URL发送POST请求

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

设计语音
/run/ai-app/2035739697670000642

# 声音设计

## 1. 开始使用

### 注册用户

注册 RunningHub 账号并充值钱包后，即可开始使用 AI 应用 API 和 ComfyUI 工作流 API。
请注意：若您使用 消费级-会员 API Key，需拥有 基础版及以上会员 才能调用上述接口。
使用 企业级-共享 或 企业级-独占 API Key 的用户不受此限制。

### 获取您的 API Key

RunningHub 为每位用户自动生成一个独特的 32 位 API KEY

请妥善保存您的 API KEY，不要外泄，后续步骤将依赖此密钥进行操作

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/run/ai-app/2035739697670000642' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "nodeInfoList": [
    {
      "nodeId": "12",
      "fieldName": "语言",
      "fieldData": "[[\"自动\", \"中文\", \"英文\", \"日文\", \"韩文\", \"德文\", \"法文\", \"俄文\", \"葡萄牙文\", \"西班牙文\", \"意大利文\"], {\"default\": \"自动\"}]",
      "fieldValue": "中文",
      "description": "语言"
    },
    {
      "nodeId": "14",
      "fieldName": "text",
      "fieldValue": "白起：秦国最狠的一把刀，为什么最后死在自己人手里？\n\n你要说战国谁最能打，白起肯定绕不过去。\n这人厉害到什么程度？伊阙打韩魏，攻楚拿郢都，长平直接把赵国脊梁打断。\n但最有意思的不是他多会打，而是他越能打，最后反而死得越快。\n所以白起这人，不能光当“战神”看。\n他其实是秦国统一路上最锋利的一把刀，也是最先被收起来的一把刀。\n白起到底强在哪\n白起跟一般猛将不一样。\n有些将军是猛，有些将军是敢拼，但白起最可怕的地方，是他不光会赢，他还会设计怎么赢。\n他特别擅长看局：地形怎么用，粮道怎么断，对手什么时候会急，什么时候会乱，他脑子里想的不是一场仗，而是怎么把对面整个拖进死局。\n所以他打仗有个很明显的特点：稳，冷，狠。\n不轻易出手，但一旦出手，往往就是奔着把对面国运打残去的。",
      "description": "文稿"
    },
    {
      "nodeId": "15",
      "fieldName": "text",
      "fieldValue": "\"30岁男性声音，清亮有活力，像知识区视频博主。\n语气轻松但不轻浮，有互动感，\n关键知识点加重语气，整体节奏明快。\"",
      "description": "【人设】+【音色特征】+【风格】+【情感】+【节奏】"
    }
  ],
  "instanceType": "default",
  "usePersonalQueue": "false"
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `nodeInfoList` | List | 必填 | 节点参数映射列表，用于动态修改工作流参数 |
| `instanceType` | String | 可选 | 指定运行实例的类型<br>default (24G显存), plus (48G显存) |
| `usePersonalQueue` | Boolean | 可选 | 是否使用个人独占队列 |
| `retainSeconds` | Integer | 可选 | 实例保留时长（秒）。仅企业共享 API Key 生效；任务成功结束后会在指定时长内优先复用同用户同工作流实例，减少冷启动与排队。该保留时段会产生额外费用，按实际保留时长计费。可选范围：10~180 秒。 |
| `webhookUrl` | String | 可选 | Webhook 回调地址，任务完成时会向该地址发送 POST 请求 |

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

如果在提交时添加了 "webhookUrl": "<https://example.com/webhook>" 请求体参数，RunningHub 会在任务完成时向您的URL发送POST请求

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

数字人
/run/ai-app/2036019863617015809

# 数字人

## 1. 开始使用

### 注册用户

注册 RunningHub 账号并充值钱包后，即可开始使用 AI 应用 API 和 ComfyUI 工作流 API。
请注意：若您使用 消费级-会员 API Key，需拥有 基础版及以上会员 才能调用上述接口。
使用 企业级-共享 或 企业级-独占 API Key 的用户不受此限制。

### 获取您的 API Key

RunningHub 为每位用户自动生成一个独特的 32 位 API KEY

请妥善保存您的 API KEY，不要外泄，后续步骤将依赖此密钥进行操作

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/run/ai-app/2036019863617015809' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "nodeInfoList": [
    {
      "nodeId": "20",
      "fieldName": "prompt",
      "fieldValue": "女人一边说话，一边往前走",
      "description": "简单提示词"
    },
    {
      "nodeId": "41",
      "fieldName": "prompt",
      "fieldValue": "你忘记了吗？上次学术会议，你喝醉了。",
      "description": "台词"
    },
    {
      "nodeId": "43",
      "fieldName": "image",
      "fieldValue": "e844fd88f318c8279d6e50851c685652d0084167aa2956b5a0a4182b70cec008.png",
      "description": "上传首帧图"
    },
    {
      "nodeId": "40",
      "fieldName": "audio",
      "fieldValue": "67777ea420dde63c6e8cd31f303d66c0d96b374ed7cac9d7a1f60f9badbec1bc.WAV",
      "description": "上传参考音频"
    },
    {
      "nodeId": "47",
      "fieldName": "value",
      "fieldValue": "960",
      "description": "高"
    },
    {
      "nodeId": "48",
      "fieldName": "value",
      "fieldValue": "540",
      "description": "宽"
    }
  ],
  "instanceType": "default",
  "usePersonalQueue": "false"
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `nodeInfoList` | List | 必填 | 节点参数映射列表，用于动态修改工作流参数 |
| `instanceType` | String | 可选 | 指定运行实例的类型<br>default (24G显存), plus (48G显存) |
| `usePersonalQueue` | Boolean | 可选 | 是否使用个人独占队列 |
| `retainSeconds` | Integer | 可选 | 实例保留时长（秒）。仅企业共享 API Key 生效；任务成功结束后会在指定时长内优先复用同用户同工作流实例，减少冷启动与排队。该保留时段会产生额外费用，按实际保留时长计费。可选范围：10~180 秒。 |
| `webhookUrl` | String | 可选 | Webhook 回调地址，任务完成时会向该地址发送 POST 请求 |

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

如果在提交时添加了 "webhookUrl": "<https://example.com/webhook>" 请求体参数，RunningHub 会在任务完成时向您的URL发送POST请求

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


### 我是导演
 /run/ai-app/2029950473750454274
# 欢迎使用 RunningHub API，轻松调用 RunningHub 云端的 ComfyUI 工作流

## 1. 开始使用

### 注册用户

注册 RunningHub 账号并充值钱包后，即可开始使用 AI 应用 API 和 ComfyUI 工作流 API。
请注意：若您使用 消费级-会员 API Key，需拥有 基础版及以上会员 才能调用上述接口。
使用 企业级-共享 或 企业级-独占 API Key 的用户不受此限制。

### 获取您的 API Key

RunningHub 为每位用户自动生成一个独特的 32 位 API KEY

请妥善保存您的 API KEY，不要外泄，后续步骤将依赖此密钥进行操作

### 提交请求

提交 API 请求。RunningHub API 已为您处理 API Key，您只需提交请求即可

```curl
curl --location --request POST 'https://www.runninghub.cn/openapi/v2/run/ai-app/2029950473750454274' \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${RUNNINGHUB_API_KEY}" \
--data-raw '{
  "nodeInfoList": [
    {
      "nodeId": "57",
      "fieldName": "image",
      "fieldValue": "7d778fe74ff35746e3679a094d2cdcb3e62eeab9a72cddc1022e512c3b25d3e8.png",
      "description": "你想让谁演"
    },
    {
      "nodeId": "997",
      "fieldName": "video",
      "fieldValue": "aa21d5a62a8e8eac100c24b72faf1d98a8e39ad6b11e26545b72dd382139ff48.mp4",
      "description": "你想让她/他演啥"
    },
    {
      "nodeId": "1019",
      "fieldName": "text",
      "fieldValue": "女人在跳舞",
      "description": "简单说下动作是啥"
    },
    {
      "nodeId": "999",
      "fieldName": "value",
      "fieldValue": "480",
      "description": "宽（竖屏不用动，横屏换下数字）"
    },
    {
      "nodeId": "1000",
      "fieldName": "value",
      "fieldValue": "832",
      "description": "高（竖屏不用动，横屏换下数字）"
    }
  ],
  "instanceType": "default",
  "usePersonalQueue": "false"
}'
```

#### 请求参数说明

| 参数说明 | 类型 | 必填/可选 | AI 应用程序生成的结果。 |
| --- | --- | --- | --- |
| `nodeInfoList` | List | 必填 | 节点参数映射列表，用于动态修改工作流参数 |
| `instanceType` | String | 可选 | 指定运行实例的类型<br>default (24G显存), plus (48G显存) |
| `usePersonalQueue` | Boolean | 可选 | 是否使用个人独占队列 |
| `retainSeconds` | Integer | 可选 | 实例保留时长（秒）。仅企业共享 API Key 生效；任务成功结束后会在指定时长内优先复用同用户同工作流实例，减少冷启动与排队。该保留时段会产生额外费用，按实际保留时长计费。可选范围：10~180 秒。 |
| `webhookUrl` | String | 可选 | Webhook 回调地址，任务完成时会向该地址发送 POST 请求 |

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

