# Midjourney接入向导

# Midjourney接入向导

## 模式接入点

2种模式价格不一致：

- **fast模式**: {{BASE_URL}}/mj-fast
- **relax模式**: {{BASE_URL}}/mj-relax
或通过令牌设置 设置模式、返回图片代理方式

## API接口类型

### 类型1：新任务创建

- 提交Imagine任务(文生图、文图生图): `/mj/submit/imagine`
- 提交Blend任务(图生图): `/mj/submit/blend`
- 提交Describe任务(图生文): `/mj/submit/describe`
- 提交Shorten任务(prompt分析): `/mj/submit/shorten`

### 类型2：任务再操作

- 执行动作(所有的关联按钮动作UPSCALE; VARIATION; REROLL; ZOOM等): `/mj/submit/action`
- 提交Modal(提交局部重绘、ZOOM): `/mj/submit/modal`

### 类型3：任务查询

- 指定ID获取任务: `/mj/task/{id}/fetch`

## 接入流程 Demo

以提交 Imagine 任务为 Demo

### 第一步: 提交类型1 Imagine 任务

接口说明 获取到任何ID result:1320098173412546

```sh
curl --request post \
  --url {{BASE_URL}}/fast/mj/submit/imagine \
  --header 'Authorization: Bearer sk-替换为你的key' \
  -H "Content-Type: application/json" \
  --data '{
  "base64Array": [],
  "prompt": "black cat"
}'
```

### 第二步: 根据任务ID获取任务结果

由第一步得到任务ID为 `1320098173412546`，得到返回结果。

```sh
curl --request GET \
  --url {{BASE_URL}}/fast/mj/task/1320098173412546/fetch \
  --header 'Authorization: Bearer sk-替换为你的key' \
  -H "Content-Type: application/json"
```
不断轮询查询任务接口，直到 progress 为 100% 
```sh
{
    "id": "1320098173412546",
    "action": "IMAGINE",
    "prompt": "cat --v 6.1",
    "promptEn": "cat --v 6.1",
    "description": "Submit success",
    "state": "",
    "submitTime": 1741531578038,
    "startTime": 1741531580190,
    "finishTime": 1741531608566,
    "imageUrl": "https://img.innk.cc/attachments/1320066655572987907/1348306030429470862/adam_rivera4952_cat_26d56b92-4ed6-45e2-8561-563797923135.png?ex=67cefb57\u0026is=67cda9d7\u0026hm=b87e6b24e4bc3c2f1584b72154075607d6115602d0e5c7777e6637c29b8d3bd5\u0026",
    "status": "SUCCESS",
    "progress": "100%",
    "failReason": "",
    "properties": {
        "botType": "MID_JOURNEY",
        "discordChannelId": 8774786694361674000,
        "discordInstanceId": 7415633538733103000,
        "finalPrompt": "cat --v 6.1 --sref \u003chttps://s.mj.run/ktqQpnwPoPk\u003e",
        "flags": 0,
        "messageContent": "**cat --v 6.1 --sref \u003chttps://s.mj.run/ktqQpnwPoPk\u003e** - \u003c@1343445981269594182\u003e (relaxed)",
        "messageHash": "26d56b92-4ed6-45e2-8561-563797923135",
        "messageId": "1348306030706036789",
        "nonce": "1619855216344100864",
        "notifyHook": "",
        "progressMessageId": "1348305922325479495"
    },
    "buttons": [
        {
            "customId": "MJ::JOB::upsample::1::26d56b92-4ed6-45e2-8561-563797923135",
            "emoji": "",
            "label": "U1",
            "style": 2,
            "type": 2
        },
        {
            "customId": "MJ::JOB::upsample::2::26d56b92-4ed6-45e2-8561-563797923135",
            "emoji": "",
            "label": "U2",
            "style": 2,
            "type": 2
        },
        {
            "customId": "MJ::JOB::upsample::3::26d56b92-4ed6-45e2-8561-563797923135",
            "emoji": "",
            "label": "U3",
            "style": 2,
            "type": 2
        },
        {
            "customId": "MJ::JOB::upsample::4::26d56b92-4ed6-45e2-8561-563797923135",
            "emoji": "",
            "label": "U4",
            "style": 2,
            "type": 2
        },
        {
            "customId": "MJ::JOB::reroll::0::26d56b92-4ed6-45e2-8561-563797923135::SOLO",
            "emoji": "🔄",
            "label": "",
            "style": 2,
            "type": 2
        },
        {
            "customId": "MJ::JOB::variation::1::26d56b92-4ed6-45e2-8561-563797923135",
            "emoji": "",
            "label": "V1",
            "style": 2,
            "type": 2
        },
        {
            "customId": "MJ::JOB::variation::2::26d56b92-4ed6-45e2-8561-563797923135",
            "emoji": "",
            "label": "V2",
            "style": 2,
            "type": 2
        },
        {
            "customId": "MJ::JOB::variation::3::26d56b92-4ed6-45e2-8561-563797923135",
            "emoji": "",
            "label": "V3",
            "style": 2,
            "type": 2
        },
        {
            "customId": "MJ::JOB::variation::4::26d56b92-4ed6-45e2-8561-563797923135",
            "emoji": "",
            "label": "V4",
            "style": 2,
            "type": 2
        }
    ]
}
```

### 第三步: 点击按钮，执行动作


查询接口返回的 buttons 属性为可点击按钮，将对应的按钮 customId，传入接口 /mj/submit/action 
```json
{
  "customId": "MJ::JOB::upsample::2::3dbbd469-36af-4a0f-8f02-df6c579e7011",
  "taskId": "14001934816969359"
}
```
### 第四步 根据任务ID获取任务结果
直到进度结束。可继续再次操作、获取



## 接口详细介绍

### 类型1：提交Imagine任务

- **接口地址**: `/mj/submit/imagine`
- **请求方式**: POST
- **请求数据类型**: application/json
- **响应数据类型**: /

#### 请求示例:

```json
{
  "base64Array": [],
  "prompt": "Cat"
}
```

#### 请求参数说明:

|参数名称|参数说明|请求类型|是否必须|数据类型|schema|
|--|--|--|--|--|--|
|imagineDTO|imagineDTO|body|true|Imagine提交参数|Imagine提交参数|
|base64Array|垫图base64数组|false|array|string||
|prompt|提示词|true|string|||

#### 响应状态说明:

|状态码|说明|schema|
|--|--|--|
|200|OK|提交结果|
|401|Unauthorized||
|403|Forbidden||
|404|Not Found||

#### 响应参数说明:

|参数名称|参数说明|类型|schema|
|--|--|--|--|
|code|状态码: 1(提交成功), 22(排队中), other(错误)|integer(int32)|integer(int32)|
|description|描述|string||
|properties|扩展字段|object||
|result|任务ID|string||

#### 响应示例:

```json
{
    "code": 1,
    "description": "提交成功",
    "properties": {},
    "result": 1320098173412546
}
```

### 提交Blend任务

- **接口地址**: `/mj/submit/blend`
- **请求方式**: POST
- **请求数据类型**: application/json
- **响应数据类型**: /

#### 请求示例:

```json
{
  "base64Array": [
    "data:image/png;base64,xxx1",
    "data:image/png;base64,xxx2"
  ],
  "dimensions": "SQUARE"
}
```

#### 请求参数说明:

|参数名称|参数说明|请求类型|是否必须|数据类型|schema|
|--|--|--|--|--|--|
|blendDTO|blendDTO|body|true|Blend提交参数|Blend提交参数|
|base64Array|图片base64数组|true|array|string||
|dimensions|比例: PORTRAIT(2:3); SQUARE(1:1); LANDSCAPE(3:2)|false|string|||

#### 响应示例:

```json
{
    "code": 1,
    "description": "提交成功",
    "properties": {},
    "result": 1320098173412546
}
```

### 提交图生文任务

- **接口地址**: `/mj/submit/describe`
- **请求方式**: POST
- **请求数据类型**: application/json
- **响应数据类型**: /

#### 请求示例:

```json
{
  "base64": "data:image/png;base64,xxx"
}
```

#### 请求参数说明:

|参数名称|参数说明|请求类型|是否必须|数据类型|schema|
|--|--|--|--|--|--|
|describeDTO|describeDTO|body|true|Describe提交参数|Describe提交参数|
|base64|图片base64|true|string|||

#### 响应示例:

```json
{
    "code": 1,
    "description": "提交成功",
    "properties": {},
    "result": 1320098173412546
}
```

### 提交Shorten任务

- **接口地址**: `/mj/submit/shorten`
- **请求方式**: POST
- **请求数据类型**: application/json
- **响应数据类型**: /

#### 请求示例:

```json
{
  "prompt": "Cat"
}
```

#### 请求参数说明:

|参数名称|参数说明|请求类型|是否必须|数据类型|schema|
|--|--|--|--|--|--|
|shortenDTO|shortenDTO|body|true|Shorten提交参数|Shorten提交参数|
|prompt|提示词|true|string|||

#### 响应示例:

```json
{
    "code": 1,
    "description": "提交成功",
    "properties": {},
    "result": 1320098173412546
}
```

### 类型2：执行动作

- **接口地址**: `/mj/submit/action`
- **请求方式**: POST
- **请求数据类型**: application/json
- **响应数据类型**: /

#### 请求示例:

```json
{
  "customId": "MJ::JOB::upsample::2::3dbbd469-36af-4a0f-8f02-df6c579e7011",
  "taskId": "14001934816969359"
}
```

#### 请求参数说明:

|参数名称|参数说明|请求类型|是否必须|数据类型|schema|
|--|--|--|--|--|--|
|actionDTO|actionDTO|body|true|执行动作参数|执行动作参数|
|customId|动作标识|true|string|||
|taskId|任务ID|true|string|||

#### 响应示例:

```json
{
    "code": 1,
    "description": "提交成功",
    "properties": {},
    "result": 1320098173412546
}
```

### 提交Modal

- **接口地址**: `/mj/submit/modal`
- **请求方式**: POST
- **请求数据类型**: application/json
- **响应数据类型**: /

#### 请求示例:

```json
{
  "maskBase64": "",
  "prompt": "",
  "taskId": "14001934816969359"
}
```

#### 请求参数说明:

|参数名称|参数说明|请求类型|是否必须|数据类型|schema|
|--|--|--|--|--|--|
|modalDTO|modalDTO|body|true|Modal提交参数|Modal提交参数|
|maskBase64|局部重绘的蒙版base64|false|string|||
|prompt|提示词|false|string|||
|taskId|任务ID|true|string|||

#### 响应示例:

```json
{
    "code": 1,
    "description": "提交成功",
    "properties": {},
    "result": 1320098173412546
}
```

### 指定ID获取任务

- **接口地址**: `/mj/task/{id}/fetch`
- **请求方式**: GET
- **请求数据类型**: application/x-www-form-urlencoded
- **响应数据类型**: /

#### 请求示例:

```sh
curl --request GET \
  --url {{BASE_URL}}/fast/mj/task/1320098173412546/fetch \
  --header 'Authorization: Bearer sk-替换为你的key' \
  -H "Content-Type: application/json"
```

#### 请求参数说明:

|参数名称|参数说明|请求类型|是否必须|数据类型|schema|
|--|--|--|--|--|--|
|id|任务ID|path|true|string||

#### 响应参数说明:

|参数名称|参数说明|类型|schema|
|--|--|--|--|
|action|任务类型, 值: IMAGINE, UPSCALE, VARIATION, ZOOM, PAN, DESCRIBE, BLEND, SHORTEN|string||
|buttons|可执行按钮，再操作的可选按钮|array||
|customId|动作标识|string||
|emoji|图标|string||
|label|文本|string||
|style|样式: 2（Primary）、3（Green）|integer(int32)||
|type|类型，系统内部使用|integer(int32)||
|description|任务描述|string||
|failReason|失败原因|string||
|finishTime|结束时间|integer(int64)|integer(int64)|
|id|ID|string||
|imageUrl|图片url|string||
|progress|任务进度|string||
|prompt|提示词|string||
|promptEn|提示词-英文|string||
|properties|扩展字段|object||
|startTime|开始执行时间|integer(int64)|integer(int64)|
|state|自定义参数|string||
|status|任务状态, 可用值: NOT_START, SUBMITTED, MODAL, IN_PROGRESS, FAILURE, SUCCESS|string||
|submitTime|提交时间|integer(int64)|integer(int64)|

#### 响应示例:

```json
{
    "action": "",
    "buttons": [
        {
            "customId": "",
            "emoji": "",
            "label": "",
            "style": 0,
            "type": 0
        }
    ],
    "description": "",
    "failReason": "",
    "finishTime": 0,
    "id": "",
    "imageUrl": "",
    "progress": "",
    "prompt": "",
    "promptEn": "",
    "properties": {},
    "startTime": 0,
    "state": "",
    "status": "",
    "submitTime": 0
}
```

