suno
# 补充

# 代理 Suno，实现 api 形式调用 Suno 文生歌

## API接口说明

默认地址例子：
https://{BASE_URL}/suno/submit/music
https://{BASE_URL}}/suno/fetch

已兼容 GoAmz 格式
GoAmz 接入地址前缀：{{BaseURL}}/suno/v1
GoAmz 切换 v3.5 接入地址前缀：{{BaseURL}}/suno/v1/mv-3.5

已兼容 SunoAPI 格式
SunoAPI 接入地址前缀：{{BaseURL}}/suno




# GoAmz 配置方式

GoAmz 接入地址前缀：
{{BaseURL}}/suno/v1
GoAmz 切换 v3.5 接入地址前缀：
{{BaseURL}}/suno/v1/mv-3.5

可以指定多种版本：
各版本对应 mv 参数值


|  版本 | mv |
| --- | --- |
|  v3.0 | mv-v3.0 |
|  v3.5 | mv-v3.5 |
|  v4.0 | mv-v4 |
|  v4.5 | mv-auk |
|  v4.5+ | mv-bluejay |
|  v5 | mv-crow |
|  v5.5 | chirp-fenix |

{{BaseURL}}/suno/v1/mv-3.0
{{BaseURL}}/suno/v1/mv-3.5
{{BaseURL}}/suno/v1/mv-4
{{BaseURL}}/suno/v1/mv-auk
{{BaseURL}}/suno/v1/mv-bluejay
{{BaseURL}}/suno/v1/mv-5

# 音乐版本以及生成参数介绍

Suno 版本介绍
提交任务接口中 mv 参数控制 suno 版本
```
{
    "prompt": "",
    "mv": "chirp-v4"
}
```
各版本对应 mv 参数值

| 版本     | mv              | 上线时间    | prompt 限制 | tag 限制 | 歌曲最长时长 |
| -------- | --------------- | ----------- | ----------- | -------- | ------------ |
| v5.5     | chirp-fenix     | 2026.03.27  | 5000        | 1000     | 8 分钟       |
| v5       | chirp-crow      | 2025.09.23  | 5000        | 1000     | 8 分钟       |
| v4.5+    | chirp-bluejay   | 2025.07.17  | 5000        | 1000     | 8 分钟       |
| v4.5-all | chirp-auk-turbo | 2025.05.03  | 5000        | 1000     | 4 分钟       |
| v4.5     | chirp-auk       | 2025.05.03  | 5000        | 1000     | 4 分钟       |
| v4       | chirp-v4        | 2024.12.17  | 3000        | 200      | 150 秒       |
| v3.5     | chirp-v3-5      | 已下线      | 3000        | 200      | 120 秒       |
| v3.0     | chirp-v3.0      | 已下线      | 3000        | 200      | 120 秒       |


## 自定义创作模式
### 普通生成
| 参数名            | 类型   | 描述                     | 备注                                                                 |
|------------------|--------|--------------------------|---------------------------------------------------------------------|
| title            | String | 音乐标题                 |                                                                     |
| tags             | String | 音乐风格, 使用半角逗号隔开 |                                                                     |
| generation_type  | String | 生成类型                 | 默认为 TEXT                                                         |
| prompt           | String | 音乐创作提示词, 包括但不限于歌词 |                                                                     |
| negative_tags    | String | 不希望出现的风格         | 可以为空字符串                                                      |
| mv               | String | 模型                     | 默认为 chirp-v4, 可选 chirp-v3-5，chirp-v3-0。非必须参数。当扩展上传的音频文件时，使用 chirp-v3-5-upload |



### 续写
| 参数名            | 类型   | 描述                     | 备注                                                                 |
|------------------|--------|--------------------------|---------------------------------------------------------------------|
| task_id            | String | 续写的前任务id                 |       
| title            | String | 音乐标题                 |                                                                     |
| tags             | String | 音乐风格, 使用半角逗号隔开 |                                                                     |
| generation_type  | String | 生成类型                 | 默认为 TEXT                                                         |
| prompt           | String | 音乐创作提示词, 包括但不限于歌词 |                                                                     |
| negative_tags    | String | 不希望出现的风格         | 可以为空字符串                                                      |
| mv               | String | 模型                     | 默认为 chirp-v4, 可选 chirp-v3-5，chirp-v3-0|
| continue_at      | Float  |                          | 需要继续创作时使用。含义为，从第几秒开始继续创作，例如 120.00 或者 61.59 |
| continue_clip_id | String |                          | 需要继续创作时使用。含义为，需要继续创作的歌曲 id                      |
| task | String |          extend                |   默认为 extend   |



### 上传生成
| 参数名                   | 类型   | 描述                     | 备注                                                       |
|--------------------------|--------|--------------------------|------------------------------------------------------------|
| prompt                   | String | 音乐创作提示词           | 可以为空字符串                                             |
| generation_type          | String | 生成类型                 | 默认为 TEXT                                                |
| tags                     | String | 音乐风格                 | 使用半角逗号隔开                                           |
| negative_tags            | String | 不希望出现的风格         | 可以为空字符串                                             |
| mv                       | String | 模型                     | 请使用 chirp-v3-5-tau                                      |
| title                    | String | 音乐标题                 |                                                            |
| continue_clip_id         | String | 需要继续创作的歌曲id     | 非必传参数，可以为 null                                    |
| continue_at              | Float  | 从第几秒开始继续创作     | 非必传参数，可以为 null                                    |
| continued_aligned_prompt | String | 继续创作的对齐提示词     | 非必传参数，可以为 null                                    |
| infill_start_s           | Float  | 填充开始时间（秒）       | 非必传参数，可以为 null                                    |
| infill_end_s             | Float  | 填充结束时间（秒）       | 非必传参数，可以为 null                                    |
| task                     | String | 任务类型                 | 使用 Cover 功能，所以是 cover                              |
| cover_clip_id            | String | 要翻唱的原曲id，或者上传的音频 clip id | 用于 Cover 功能                                            |
| task_id            | String | 续写的前任务id                 |       


# 场景一: 灵感模式

提交都是 post 到 {{BASE_URL}}/suno/generate
获取结果 都是 get {{BASE_URL}}/suno/feed/clipsId1,clipsId2
通过下面 请求体能产生不同的效果

```
curl --request POST \
  --url {{BASE_URL}}/suno/generate \
  --header 'Authorization: Bearer your-key' \
  --header 'Content-Type: application/json' \
  --data '{
  "gpt_description_prompt": "乡愁"
}'
```
# 场景二: 自定义.歌词歌名

提交都是 post 到 {{BASE_URL}}/suno/generate
获取结果 都是 get {{BASE_URL}}/suno/feed/clipsId1,clipsId2
通过下面 请求体能产生不同的效果

```
{
  "prompt": "[Verse]\n连续的日子一直忙碌\n文件成堆无尽头\n把梦想藏在抽屉深处\n咖啡杯已经冷透\n\n[Verse 2]\n早上八点打卡上班\n疲惫的眼睛没神采\n同事间的闲聊都没意思\n只盼着时间快快跑起来\n\n[Chorus]\n工作工作老板的呼喊\n做完做完这才算平安\n加班加班才有些钱赚\n梦想梦想何时能实现\n\n[Verse 3]\n午餐时间吃个便当\n看窗外阳光正灿烂\n生活离梦想好远\n眼前只有办公桌和椅子\n\n[Bridge]\n老板的脚步声像雷鸣\n心跳随着节奏加速\n桌上的文件一大堆\n抱怨的声音渐渐消失\n\n[Chorus]\n工作工作老板的呼喊\n做完做完这才算平安\n加班加班才有些钱赚\n梦想梦想何时能实现",
  "mv": "chirp-v3-5",
  "title": "工作",
  "tags": " edm"
}
```
# 场景三: 纯音乐.自定义

提交都是 post 到 {{BASE_URL}}/suno/generate
获取结果 都是 get {{BASE_URL}}/suno/feed/clipsId1,clipsId2
通过下面 请求体能产生不同的效果

```
{
  "prompt": "",
  "tags": "heavy metal",
  "mv": "chirp-v3-5",
  "title": "北京",
  "continue_clip_id": null,
  "continue_at": null,
  "infill_start_s": null,
  "infill_end_s": null
}
```
# 场景四: 纯音乐.灵感模式

提交都是 post 到 {{BASE_URL}}/suno/generate
获取结果 都是 get {{BASE_URL}}/suno/feed/clipsId1,clipsId2
通过下面 请求体能产生不同的效果

```
{
  "gpt_description_prompt": "一首关于彻夜跳舞的国歌舞蹈流行歌曲",
  "mv": "chirp-v3-5",
  "prompt": "",
  "make_instrumental": true
}
```
# 场景五: 续写自定义音频

提交都是 post 到 {{BASE_URL}}/suno/generate
获取结果 都是 get {{BASE_URL}}/suno/feed/clipsId1,clipsId2
通过下面 请求体能产生不同的效果

### A.上传音乐
首先通过上传接口得到 clip_id 值为 abcd-1234-1234-1234-abd

### B.扩展音乐.带版本信息
mv 为 chirp-v4 chirp-auk chirp-bluejay
task 为 upload_extend
```json
{
  "prompt": "歌词",
  "tags": "",
  "negative_tags": "",
  "mv": "chirp-v4",
  "title": "标题",
  "continue_clip_id": "ca94a97d-d3f2-4a63-aeee-ba3a43384bcd",
  "continue_at": 10,
  "task": "upload_extend"
}
```
### C.扩展音乐.将弃用
注意：这里的 mv 是 chirp-v3-5-upload 或者 chirp-v4-upload

```json
{
  "prompt": "[Verse]\n连续的日子一直忙碌\n文件成堆无尽头\n把梦想藏在抽屉深处\n咖啡杯已经冷透\n\n[Verse 2]\n早上八点打卡上班\n疲惫的眼睛没神采\n同事间的闲聊都没意思\n只盼着时间快快跑起来\n\n[Chorus]\n工作工作老板的呼喊\n做完做完这才算平安\n加班加班才有些钱赚\n梦想梦想何时能实现\n\n[Verse 3]\n午餐时间吃个便当\n看窗外阳光正灿烂\n生活离梦想好远\n眼前只有办公桌和椅子\n\n[Bridge]\n老板的脚步声像雷鸣\n心跳随着节奏加速\n桌上的文件一大堆\n抱怨的声音渐渐消失\n\n[Chorus]\n工作工作老板的呼喊\n做完做完这才算平安\n加班加班才有些钱赚\n梦想梦想何时能实现",
  "tags": "heavy metal",
  "mv": "chirp-v3-5-upload",
  "title": "工作",
  "continue_clip_id": "abcd-1234-1234-1234-abd",
  "continue_at": 30.792
}
```
D.拼接完整音乐
注意 ：is_infill 为 false
得后一首替换完的歌曲 id,通过查询接口获取状态
扣费：一首歌的费用
post {{BASE_URL}}/suno/generate/concat

```shell
curl --request POST \
  --url {{BASE_URL}}/suno/generate/concat \
  --header 'Authorization: Bearer hk-your-key' \
  --header 'Content-Type: application/json' \
  --data '{
  "clip_id": "newid-1234-1234-1234-one",
  "is_infill": false
}'
```
请求体

```json
{
  "clip_id": "newid-1234-1234-1234-one",
  "is_infill": false
}
```
# 场景六: 续写音乐并获取完整音乐

注意：续写官方产生的音乐 自定义不可用

### A.生成音乐
可以通过场景 1 2 3 生成音乐 获取其中的一首歌的 clip_id 值为 abcd-1234-1234-1234-abd

### B.扩展音乐
会得到 2 个新的clip_id 其中一个 newid-1234-1234-1234-one

```json
{
  "prompt": "[Verse]\n连续的日子一直忙碌\n文件成堆无尽头\n把梦想藏在抽屉深处\n咖啡杯已经冷透\n\n[Verse 2]\n早上八点打卡上班\n疲惫的眼睛没神采\n同事间的闲聊都没意思\n只盼着时间快快跑起来\n\n[Chorus]\n工作工作老板的呼喊\n做完做完这才算平安\n加班加班才有些钱赚\n梦想梦想何时能实现\n\n[Verse 3]\n午餐时间吃个便当\n看窗外阳光正灿烂\n生活离梦想好远\n眼前只有办公桌和椅子\n\n[Bridge]\n老板的脚步声像雷鸣\n心跳随着节奏加速\n桌上的文件一大堆\n抱怨的声音渐渐消失\n\n[Chorus]\n工作工作老板的呼喊\n做完做完这才算平安\n加班加班才有些钱赚\n梦想梦想何时能实现",
  "tags": "heavy metal",
  "mv": "chirp-v3-5",
  "title": "工作",
  "continue_clip_id": "abcd-1234-1234-1234-abd",
  "continue_at": 30,
  "task": "extend"
}
```
### C.拼接完整音乐
注意 ：is_infill 为 false
得后一首替换完的歌曲 id,通过查询接口获取状态
扣费：100 积分(1 分钱)
post {{BASE_URL}}/suno/generate/concat

```shell
curl --request POST \
  --url {{BASE_URL}}/suno/generate/concat \
  --header 'Authorization: Bearer hk-your-key' \
  --header 'Content-Type: application/json' \
  --data '{
  "clip_id": "newid-1234-1234-1234-one",
  "is_infill": false
}'
```
请求体

```json
{
  "clip_id": "newid-1234-1234-1234-one",
  "is_infill": false
}
```
# 场景七: Cover 音乐翻版\修改风格

### A.生成音乐
可以通过场景 1 2 3 生成音乐 获取其中的一首歌的 clip_id 值为 abcd-1234-1234-1234-abd
也可以通过上传接口得到 clip_id 这样就可以 cover 自定义音频

### B.Cover 音乐
注意 mv为chirp-v3-5-tau 或者 chirp-v4-tau 或者 chirp-auk 或 chirp-bluejay

task 为 cover
可跨账号使用 不用担心账号下线
cover_clip_id 如果是 upload 的 clip_id 为不可跨账号

```json
{
  "prompt": "[Verse]\n连续的日子一直忙碌\n文件成堆无尽头\n把梦想藏在抽屉深处\n咖啡杯已经冷透\n\n[Verse 2]\n早上八点打卡上班\n疲惫的眼睛没神采\n同事间的闲聊都没意思\n只盼着时间快快跑起来\n\n[Chorus]\n工作工作老板的呼喊\n做完做完这才算平安\n加班加班才有些钱赚\n梦想梦想何时能实现\n\n[Verse 3]\n午餐时间吃个便当\n看窗外阳光正灿烂\n生活离梦想好远\n眼前只有办公桌和椅子\n\n[Bridge]\n老板的脚步声像雷鸣\n心跳随着节奏加速\n桌上的文件一大堆\n抱怨的声音渐渐消失\n\n[Chorus]\n工作工作老板的呼喊\n做完做完这才算平安\n加班加班才有些钱赚\n梦想梦想何时能实现",
  "generation_type": "TEXT",
  "tags": "rock, punk",
  "negative_tags": "",
  "mv": "chirp-v4-tau",
  "title": "工作 (Cover)",
  "continue_clip_id": null,
  "continue_at": null,
  "continued_aligned_prompt": null,
  "infill_start_s": null,
  "infill_end_s": null,
  "task": "cover",
  "cover_clip_id": "abcd-1234-1234-1234-abd"
}```
# 场景八: Replace Section.替换片段

### A.生成音乐
可以通过场景 1 2 3 生成音乐 获取其中的一首歌的 clip_id 值为 abcd-1234-1234-1234-abd

### B.Replace Section
注意 mv为chirp-v3-5-tau 或者 chirp-v4-tau 或者 chirp-auk 或 chirp-bluejay
提醒：替换的歌词 要跟原来的歌词有重复的地方，最好相应的时间能对应上
可跨账号使用 不用担心账号下线
会得到 2 个新的clip_id 选择其中一个 newid-1234-1234-1234-one 给下一步使用
```json
{
  "prompt": "[Verse]\n连续的日子一直忙碌\n文件成堆无尽头\n把梦想藏在抽屉深处\n咖啡杯已经冷透\n\n[Verse 2]\n早上八点打卡上班\n疲惫的眼睛没神采\n同事间的闲聊都没意思\n只盼着时间快快跑起来\n\n[Chorus]\n工作工作老板的呼喊\n做完做完这才算平安\n加班加班才有些钱赚\n梦想梦想何时能实现\n\n[Verse 3]\n午餐时间吃个便当\n看窗外阳光正灿烂\n生活离梦想好远\n眼前只有办公桌和椅子\n\n[Bridge]\n老板的脚步声像雷鸣\n心跳随着节奏加速\n桌上的文件一大堆\n抱怨的声音渐渐消失\n\n[Chorus]\n工作工作老板的呼喊\n做完做完这才算平安\n加班加班才有些钱赚\n梦想梦想何时能实现",
  "generation_type": "TEXT",
  "tags": "rock, punk",
  "negative_tags": "",
  "mv": "chirp-v3-5-tau",
  "title": "工作 (replace)",
  "continue_clip_id": "abcd-1234-1234-1234-abd",
  "continue_at": null,
  "continued_aligned_prompt": null,
  "infill_start_s": 50,
  "infill_end_s": 64.8,
  "task": "infill"
}
```
### C.确认.拼接完整音乐
注意 ：is_infill 为 true
得后一首替换完的歌曲 id,通过查询接口获取状态
扣费：100 积分(1 分钱)
post {{BASE_URL}}/suno/generate/concat

```shell
curl --request POST \
  --url {{BASE_URL}}/suno/generate/concat \
  --header 'Authorization: Bearer hk-your-key' \
  --header 'Content-Type: application/json' \
  --data '{
  "clip_id": "newid-1234-1234-1234-one",
  "is_infill": true
}'
```
请求体

```json
{
  "clip_id": "newid-1234-1234-1234-one",
  "is_infill": true
}```
# 场景九: Persona.歌手风格

### A.生成音乐
可以通过场景 1 2 3 生成音乐 获取其中的一首歌的 clip_id 值为 54834687-5e79-4f08-8e14-cf188f15b598

### B.新建 Persona
post {{BASE_URL}}/suno/persona/create/

clip_id 需要系统内存在的,非 uploader
不能跨账号 所以可能账号下线用不了
为防止滥用 会扣 100 积分
请求体

``` json
{
  "root_clip_id": "54834687-5e79-4f08-8e14-cf188f15b598",
  "name": "Persona 标题",
  "description": "Persona 描述",
  "clips": ["54834687-5e79-4f08-8e14-cf188f15b598"],
  "is_public": true
}
```
返回体 关键的得到 id 为 fd213afd-ac1c-4822-9802-c1c0ea45e77b 设定为 persona_id 供下一步使用

```json
{
  "id": "fd213afd-ac1c-4822-9802-c1c0ea45e77b",
  "name": "food",
  "description": "123",
  "root_clip_id": "54834687-5e79-4f08-8e14-cf188f15b598",
  "clip": {
    "id": "54834687-5e79-4f08-8e14-cf188f15b598",
    "video_url": "https://cdn1.suno.ai/54834687-5e79-4f08-8e14-cf188f15b598.mp4",
    "audio_url": "https://cdn1.suno.ai/54834687-5e79-4f08-8e14-cf188f15b598.mp3",
    "image_url": "https://cdn2.suno.ai/image_54834687-5e79-4f08-8e14-cf188f15b598.jpeg",
    "image_large_url": "https://cdn2.suno.ai/image_large_54834687-5e79-4f08-8e14-cf188f15b598.jpeg",
    "major_model_version": "v4",
    "model_name": "chirp-v4",
    "metadata": {
      "tags": "electronic pop, tropical house fusion",
      "prompt": "",
      "type": "gen",
      "duration": 190,
      "refund_credits": false,
      "stream": true
    },
    "is_liked": false,
    "user_id": "21de6d0f-398c-467c-9957-8fa9065f3ca6",
    "display_name": "SensoryRecorders4685",
    "handle": "sensoryrecorders4685",
    "is_handle_updated": false,
    "avatar_image_url": "https://cdn1.suno.ai/defaultPink.webp",
    "is_trashed": false,
    "created_at": "2024-12-23T10:34:30.144Z",
    "status": "complete",
    "title": "noks noko wane",
    "play_count": 0,
    "upvote_count": 0,
    "is_public": false
  },
  "user_display_name": "SensoryRecorders4685",
  "user_handle": "sensoryrecorders4685",
  "user_image_url": "https://cdn1.suno.ai/defaultPink.webp",
  "persona_clips": [
    {
      "clip": {
        "id": "54834687-5e79-4f08-8e14-cf188f15b598",
        "video_url": "https://cdn1.suno.ai/54834687-5e79-4f08-8e14-cf188f15b598.mp4",
        "audio_url": "https://cdn1.suno.ai/54834687-5e79-4f08-8e14-cf188f15b598.mp3",
        "image_url": "https://cdn2.suno.ai/image_54834687-5e79-4f08-8e14-cf188f15b598.jpeg",
        "image_large_url": "https://cdn2.suno.ai/image_large_54834687-5e79-4f08-8e14-cf188f15b598.jpeg",
        "major_model_version": "v4",
        "model_name": "chirp-v4",
        "metadata": {
          "tags": "electronic pop, tropical house fusion",
          "prompt": "",
          "type": "gen",
          "duration": 190,
          "refund_credits": false,
          "stream": true
        },
        "is_liked": false,
        "user_id": "21de6d0f-398c-467c-9957-8fa9065f3ca6",
        "display_name": "SensoryRecorders4685",
        "handle": "sensoryrecorders4685",
        "is_handle_updated": false,
        "avatar_image_url": "https://cdn1.suno.ai/defaultPink.webp",
        "is_trashed": false,
        "created_at": "2024-12-23T10:34:30.144Z",
        "status": "complete",
        "title": "noks noko wane",
        "play_count": 0,
        "upvote_count": 0,
        "is_public": false
      },
      "id": 11288925
    }
  ]
}
```
### C.使用 persona_id 创作
post {{BASE_URL}}/suno/generate

注意 mv 为 chirp-v3-5-tau 或者 chirp-v4-tau
task 为 artist_consistency
persona_id 为 B 步骤得到的
artist_clip_id 就是 A 步骤中的 clip_id
可跨账号
```json
{
  "prompt": "[Verse]\n你从清晨到黄昏\n一直在我身边温暖\n风吹雨打也不怕\n紧握手永不分开\n\n[Verse 2]\n有你在我不孤单\n就像繁星在夜晚\n路再长也不觉得远\n因为你是我的光\n\n[Chorus]\n老公老公我爱你\n你是世界的唯一\n无论在天涯海角\n心如影随形不离\n\n[Verse 3]\n你是我的避风港\n每天夜里梦都是你\n即使前路多辛苦\n有你一切多美丽\n\n[Chorus]\n老公老公我爱你\n你是世界的唯一\n无论在天涯海角\n心如影随形不离\n\n[Bridge]\n生命中的每一刻\n有你陪伴去体会\n所有明天都更好\n因为有你我无敌",
  "generation_type": "TEXT",
  "tags": "electronic, pop",
  "negative_tags": "",
  "mv": "chirp-v4-tau",
  "title": "老公",
  "task": "artist_consistency",
  "persona_id": "0f6e8077-a7ba-4fc8-8f60-de02c66e56ce",
  "artist_clip_id": "a5fa604c-18b8-4e7f-8d25-9412d4ba8163"
}
```
返回体

```json
{
  "id": "2d453a5f-c539-4fe0-9a66-24058c5dfb6a",
  "clips": [
    {
      "id": "0e6937df-64d8-41f9-82c6-b6dadc4426a8",
      "video_url": "",
      "audio_url": "",
      "major_model_version": "v4",
      "model_name": "chirp-v4",
      "metadata": {
        "tags": "electronic, pop",
        "prompt": "[Verse]\n你从清晨到黄昏\n一直在我身边温暖\n风吹雨打也不怕\n紧握手永不分开\n\n[Verse 2]\n有你在我不孤单\n就像繁星在夜晚\n路再长也不觉得远\n因为你是我的光\n\n[Chorus]\n老公老公我爱你\n你是世界的唯一\n无论在天涯海角\n心如影随形不离\n\n[Verse 3]\n你是我的避风港\n每天夜里梦都是你\n即使前路多辛苦\n有你一切多美丽\n\n[Chorus]\n老公老公我爱你\n你是世界的唯一\n无论在天涯海角\n心如影随形不离\n\n[Bridge]\n生命中的每一刻\n有你陪伴去体会\n所有明天都更好\n因为有你我无敌",
        "type": "gen",
        "stream": true,
        "has_vocal": false,
        "artist_clip_id": "a5fa604c-18b8-4e7f-8d25-9412d4ba8163",
        "persona_id": "0f6e8077-a7ba-4fc8-8f60-de02c66e56ce",
        "task": "artist_consistency"
      },
      "is_liked": false,
      "user_id": "a3da04d5-0442-4bd3-b837-4c73ff600914",
      "display_name": "TwinklingVenue1595",
      "handle": "twinklingvenue1595",
      "is_handle_updated": false,
      "avatar_image_url": "https://cdn1.suno.ai/defaultPink.webp",
      "is_trashed": false,
      "created_at": "2024-12-23T10:37:43.596Z",
      "status": "submitted",
      "title": "老公",
      "play_count": 0,
      "upvote_count": 0,
      "is_public": false
    },
    {
      "id": "fff58de4-7ccc-4b95-937b-3b66ec07cc65",
      "video_url": "",
      "audio_url": "",
      "major_model_version": "v4",
      "model_name": "chirp-v4",
      "metadata": {
        "tags": "electronic, pop",
        "prompt": "[Verse]\n你从清晨到黄昏\n一直在我身边温暖\n风吹雨打也不怕\n紧握手永不分开\n\n[Verse 2]\n有你在我不孤单\n就像繁星在夜晚\n路再长也不觉得远\n因为你是我的光\n\n[Chorus]\n老公老公我爱你\n你是世界的唯一\n无论在天涯海角\n心如影随形不离\n\n[Verse 3]\n你是我的避风港\n每天夜里梦都是你\n即使前路多辛苦\n有你一切多美丽\n\n[Chorus]\n老公老公我爱你\n你是世界的唯一\n无论在天涯海角\n心如影随形不离\n\n[Bridge]\n生命中的每一刻\n有你陪伴去体会\n所有明天都更好\n因为有你我无敌",
        "type": "gen",
        "stream": true,
        "has_vocal": false,
        "artist_clip_id": "a5fa604c-18b8-4e7f-8d25-9412d4ba8163",
        "persona_id": "0f6e8077-a7ba-4fc8-8f60-de02c66e56ce",
        "task": "artist_consistency"
      },
      "is_liked": false,
      "user_id": "a3da04d5-0442-4bd3-b837-4c73ff600914",
      "display_name": "TwinklingVenue1595",
      "handle": "twinklingvenue1595",
      "is_handle_updated": false,
      "avatar_image_url": "https://cdn1.suno.ai/defaultPink.webp",
      "is_trashed": false,
      "created_at": "2024-12-23T10:37:43.596Z",
      "status": "submitted",
      "title": "老公",
      "play_count": 0,
      "upvote_count": 0,
      "is_public": false
    }
  ],
  "metadata": {
    "tags": "electronic, pop",
    "prompt": "[Verse]\n你从清晨到黄昏\n一直在我身边温暖\n风吹雨打也不怕\n紧握手永不分开\n\n[Verse 2]\n有你在我不孤单\n就像繁星在夜晚\n路再长也不觉得远\n因为你是我的光\n\n[Chorus]\n老公老公我爱你\n你是世界的唯一\n无论在天涯海角\n心如影随形不离\n\n[Verse 3]\n你是我的避风港\n每天夜里梦都是你\n即使前路多辛苦\n有你一切多美丽\n\n[Chorus]\n老公老公我爱你\n你是世界的唯一\n无论在天涯海角\n心如影随形不离\n\n[Bridge]\n生命中的每一刻\n有你陪伴去体会\n所有明天都更好\n因为有你我无敌",
    "type": "gen",
    "stream": true,
    "has_vocal": false,
    "artist_clip_id": "a5fa604c-18b8-4e7f-8d25-9412d4ba8163",
    "persona_id": "0f6e8077-a7ba-4fc8-8f60-de02c66e56ce",
    "task": "artist_consistency"
  },
  "major_model_version": "v4",
  "status": "complete",
  "created_at": "2024-12-23T10:37:43.581Z",
  "batch_size": 1
}```
# 场景十: 上传续写


![image.png](https://api.apifox.com/api/v1/projects/3868318/resources/522899/image-preview)

## API 有 6 个步骤

### 1.上传请求
post {{BASE_URL}}/suno/uploads/audio

请求体

```json
{ "extension": "mp3" }
```
返回

```json
{
  "id": "c25a8c59-000a-481f-ac28-efde2dc9e677",
  "url": "https://suno-uploads.s3.amazonaws.com/",
  "fields": {
    "Content-Type": "audio/mpeg",
    "key": "raw_uploads/c25a8c59-000a-481f-ac28-efde2dc9e677.mp3",
    "AWSAccessKeyId": "<aws_access_key_id_removed>",
    "policy": "eyJleHBpcmF0aW9uIjogIjIwMjQtMDYtMTdUMDY6MTg6MzJaIiwgImNvbmRpdGlvbnMiOiBbWyJjb250ZW50LWxlbmd0aC1yYW5nZSIsIDAsIDEwNDg1NzYwMF0sIFsic3RhcnRzLXdpdGgiLCAiJENvbnRlbnQtVHlwZSIsICJhdWRpby9tcGVnIl0sIHsiYnVja2V0IjogInN1bm8tdXBsb2FkcyJ9LCB7ImtleSI6ICJyYXdfdXBsb2Fkcy9jMjVhOGM1OS0wMDBhLTQ4MWYtYWMyOC1lZmRlMmRjOWU2NzcubXAzIn1dfQ==",
    "signature": "yjfB/HTNgPHURNLRdeizNMVgG6k="
  }
}
```

这里的 id 是下文的 audio_id, 同时 url 是第二步的请求 URL

### 2.上传文件
post https://suno-uploads.s3.amazonaws.com/

```shell
curl --request POST \
  --url https://suno-uploads.s3.amazonaws.com/ \
  --header 'content-type: multipart/form-data' \
  --form Content-Type=audio/mpeg \
  --form key=raw_uploads/c25a8c59-000a-481f-ac28-efde2dc9e677.mp3 \
  --form AWSAccessKeyId=<aws_access_key_id_removed> \
  --form policy=eyJleHBpcmF0aW9uIjogIjIwMjQtMDYtMTdUMDY6MTg6MzJaIiwgImNvbmRpdGlvbnMiOiBbWyJjb250ZW50LWxlbmd0aC1yYW5nZSIsIDAsIDEwNDg1NzYwMF0sIFsic3RhcnRzLXdpdGgiLCAiJENvbnRlbnQtVHlwZSIsICJhdWRpby9tcGVnIl0sIHsiYnVja2V0IjogInN1bm8tdXBsb2FkcyJ9LCB7ImtleSI6ICJyYXdfdXBsb2Fkcy9jMjVhOGM1OS0wMDBhLTQ4MWYtYWMyOC1lZmRlMmRjOWU2NzcubXAzIn1dfQ== \
  --form signature=yjfB/HTNgPHURNLRdeizNMVgG6k= \
  --form file=@/you_mp3_dir_file.mp3
```
请求体由上面的fields 加 file的 mp3 文件
返回 20x就表示成功
### 3.报告上传完毕
post {{BASE_URL}}/suno/uploads/audio/{id}/upload-finish

请求体

```json
{ "upload_type": "file_upload", "upload_filename": "you_mp3_name.mp3" }
```
### 4.查询上传处理状态
get {{BASE_URL}}/suno/uploads/audio/{id}

返回体

```json
{
  "id": "c25a8c59-000a-481f-ac28-efde2dc9e677",
  "status": "complete",
  "error_message": null,
  "s3_id": "m_05c9b477-4519-4810-9ffa-00580c082067",
  "title": "S-100096-100096-84069F8B",
  "image_url": "https://cdn1.suno.ai/image_05c9b477-4519-4810-9ffa-00580c082067.png"
}
```

status 当为 complete 时表示完成

### 5.初始化音频文件
post {{BASE_URL}}/suno/uploads/audio/{id}/initialize-clip

请求体

```json
{}
```
返回体

```json
{
  "clip_id": "05c9b477-4519-4810-9ffa-00580c082067"
}
```
### 6.获取与进行二次创作
通过获取歌曲接口 将上面的 clip_id 带到 id 上
已经弃用 通过创建歌曲任务定制模型 将接口中的 continue_clip_id 填入 clip_id得值 ,mv填入chirp-v3-5-upload
带不同版本的方式
```json
{
  "prompt": "歌词",
  "tags": "",
  "negative_tags": "",
  "mv": "chirp-v4",
  "title": "标题",
  "continue_clip_id": "ca94a97d-d3f2-4a63-aeee-ba3a43384bcd",
  "continue_at": 10,
  "task": "upload_extend"
}```
# 场景十一：stems声曲分离 Vocals Instrumental

分离后 Vocals 人声
分离后 Instrumental 纯音乐 伴奏
A.生成音乐
可以通过场景 1 2 3 生成音乐 获取其中的一首歌的 clip_id 值为 a624123d-22cc-4d4d-bf28-78d312f61597

B.声曲分离.新
post {{BASE_URL}}/suno/generate

请求体

注意 mv为 chirp-auk
task 为 gen_stem
stem_task 为 two
stem_type_group_name 为 Two
continue_clip_id 就是 A 步骤中的 clip_id
可跨账号
计费:一次生成费用

{
  "task": "gen_stem",
  "generation_type": "TEXT",
  "title": "安全之弦",
  "mv": "chirp-auk",
  "prompt": "",
  "make_instrumental": true,
  "continue_clip_id": "4720ad51-6d31-417c-a3a7-346b0b99abbc",
  "continued_aligned_prompt": null,
  "continue_at": null,
  "stem_type_id": 91,
  "stem_type_group_name": "Two",
  "stem_task": "two"
}

返回体

{
  "clips": [
    {
      "id": "5f3587e2-75fb-4c36-84b3-3ec113897a4c",
      "video_url": "",
      "audio_url": "",
      "major_model_version": "",
      "model_name": "",
      "metadata": {
        "tags": "Chinese",
        "prompt": "在那遥远的星空之下，如今谁还在彷徨？\n就像无法游泳的鱼儿，我却只能责怪自己没有坚强的鳍片。\n快将彷徨化成力量，快把挫折当做指南。\n直到梦想实现之前，我坚定地守候着。\n昨天流逝了岁月，明天我将追随风的脚步，攀上高峰。\n呼唤吧，让我们出发，骑在梦想龙的脊背，穿越命运的坎坷。\n摆脱困境的束缚，即使失去了一切，人仍然渴望温暖的拥抱。\n人之所以能体会到他人的快乐，是因为心灵的善良。\n快将彷徨化成力量，快把挫折当做指南。\n我还是那只无法游泳的鱼儿，责怪自己没有坚强的鳍片。",
        "stem_from_id": "a624123d-22cc-4d4d-bf28-78d312f61597",
        "type": "stem",
        "duration": 217.24
      },
      "is_liked": false,
      "user_id": "58387c47-dc80-466f-a7b1-a2eed61c24fb",
      "display_name": "FluidXylophone2289",
      "handle": "fluidxylophone2289",
      "is_handle_updated": false,
      "avatar_image_url": "https://cdn1.suno.ai/defaultPink.webp",
      "is_trashed": false,
      "created_at": "2024-12-25T16:51:36.619Z",
      "status": "queued",
      "title": "骑在梦想龙的脊背 - Vocals",
      "play_count": 0,
      "upvote_count": 0,
      "is_public": false
    },
    {
      "id": "9c85d619-4cac-4561-8fa3-604c116fa1c5",
      "video_url": "",
      "audio_url": "",
      "major_model_version": "",
      "model_name": "",
      "metadata": {
        "tags": "Chinese",
        "prompt": "",
        "stem_from_id": "a624123d-22cc-4d4d-bf28-78d312f61597",
        "type": "stem",
        "duration": 217.24
      },
      "is_liked": false,
      "user_id": "58387c47-dc80-466f-a7b1-a2eed61c24fb",
      "display_name": "FluidXylophone2289",
      "handle": "fluidxylophone2289",
      "is_handle_updated": false,
      "avatar_image_url": "https://cdn1.suno.ai/defaultPink.webp",
      "is_trashed": false,
      "created_at": "2024-12-25T16:51:36.625Z",
      "status": "queued",
      "title": "骑在梦想龙的脊背 - Instrumental",
      "play_count": 0,
      "upvote_count": 0,
      "is_public": false
    }
  ]
}

C.获取结果
get {{BASE_URL}}/suno/feed/5f3587e2-75fb-4c36-84b3-3ec113897a4c,9c85d619-4cac-4561-8fa3-604c116fa1c5
返回体
[
  {
    "audio_url": "https://cdn1.suno.ai/5f3587e2-75fb-4c36-84b3-3ec113897a4c.mp3",
    "avatar_image_url": "https://cdn1.suno.ai/defaultPink.webp",
    "created_at": "2024-12-25T16:51:36.619Z",
    "display_name": "FluidXylophone2289",
    "handle": "fluidxylophone2289",
    "id": "5f3587e2-75fb-4c36-84b3-3ec113897a4c",
    "image_large_url": "https://cdn2.suno.ai/image_large_5f3587e2-75fb-4c36-84b3-3ec113897a4c.jpeg",
    "image_url": "https://cdn2.suno.ai/image_5f3587e2-75fb-4c36-84b3-3ec113897a4c.jpeg",
    "is_handle_updated": false,
    "is_liked": false,
    "is_public": false,
    "is_trashed": false,
    "major_model_version": "",
    "metadata": {
      "duration": 217.24,
      "prompt": "在那遥远的星空之下，如今谁还在彷徨？\n就像无法游泳的鱼儿，我却只能责怪自己没有坚强的鳍片。\n快将彷徨化成力量，快把挫折当做指南。\n直到梦想实现之前，我坚定地守候着。\n昨天流逝了岁月，明天我将追随风的脚步，攀上高峰。\n呼唤吧，让我们出发，骑在梦想龙的脊背，穿越命运的坎坷。\n摆脱困境的束缚，即使失去了一切，人仍然渴望温暖的拥抱。\n人之所以能体会到他人的快乐，是因为心灵的善良。\n快将彷徨化成力量，快把挫折当做指南。\n我还是那只无法游泳的鱼儿，责怪自己没有坚强的鳍片。",
      "stem_from_id": "a624123d-22cc-4d4d-bf28-78d312f61597",
      "tags": "Chinese",
      "type": "stem"
    },
    "model_name": "",
    "play_count": 0,
    "status": "complete",
    "title": "骑在梦想龙的脊背 - Vocals",
    "upvote_count": 0,
    "video_url": "https://cdn1.suno.ai/5f3587e2-75fb-4c36-84b3-3ec113897a4c.mp4"
  },
  {
    "audio_url": "https://cdn1.suno.ai/9c85d619-4cac-4561-8fa3-604c116fa1c5.mp3",
    "avatar_image_url": "https://cdn1.suno.ai/defaultPink.webp",
    "created_at": "2024-12-25T16:51:36.625Z",
    "display_name": "FluidXylophone2289",
    "handle": "fluidxylophone2289",
    "id": "9c85d619-4cac-4561-8fa3-604c116fa1c5",
    "image_large_url": "https://cdn2.suno.ai/image_large_9c85d619-4cac-4561-8fa3-604c116fa1c5.jpeg",
    "image_url": "https://cdn2.suno.ai/image_9c85d619-4cac-4561-8fa3-604c116fa1c5.jpeg",
    "is_handle_updated": false,
    "is_liked": false,
    "is_public": false,
    "is_trashed": false,
    "major_model_version": "",
    "metadata": {
      "duration": 217.24,
      "prompt": "",
      "stem_from_id": "a624123d-22cc-4d4d-bf28-78d312f61597",
      "tags": "Chinese",
      "type": "stem"
    },
    "model_name": "",
    "play_count": 0,
    "status": "complete",
    "title": "骑在梦想龙的脊背 - Instrumental",
    "upvote_count": 0,
    "video_url": "https://cdn1.suno.ai/9c85d619-4cac-4561-8fa3-604c116fa1c5.mp4"
  }
]
# 场景十二：Timing:歌词、音频时间线

A.生成音乐
可以通过场景 1 2 3 生成音乐 获取其中的一首歌的 clip_id 值为 54834687-5e79-4f08-8e14-cf188f15b598

B.获取歌词
可跨账号
get {{BASE_URL}}/suno/act/timing/a624123d-22cc-4d4d-bf28-78d312f61597

{
  "aligned_words": [
    {
      "word": "[Verse]\nWinter ",
      "success": true,
      "start_s": 8.38,
      "end_s": 8.78,
      "p_align": 0.982
    },
    {
      "word": "winds ",
      "success": true,
      "start_s": 8.78,
      "end_s": 9.54,
      "p_align": 0.961
    },
    {
      "word": "they ",
      "success": true,
      "start_s": 9.54,
      "end_s": 9.93,
      "p_align": 0.99
    },
    {
      "word": "cut ",
      "success": true,
      "start_s": 9.93,
      "end_s": 10.41,
      "p_align": 0.998
    },
    {
      "word": "so ",
      "success": true,
      "start_s": 10.41,
      "end_s": 10.93,
      "p_align": 0.996
    },
    {
      "word": "deep\n",
      "success": true,
      "start_s": 10.93,
      "end_s": 11.93,
      "p_align": 0.997
    },
    ....
  ],
  "waveform_data": [
    0.001, 0.00109, 0.04219, 0.03597, ....
  ],
  "hoot_cer": 0.03556771545827633,
  "is_streamed": false
}
# 场景十二：Timing:歌词、音频时间线

A.生成音乐
可以通过场景 1 2 3 生成音乐 获取其中的一首歌的 clip_id 值为 54834687-5e79-4f08-8e14-cf188f15b598

B.获取歌词
可跨账号
get {{BASE_URL}}/suno/act/timing/a624123d-22cc-4d4d-bf28-78d312f61597

{
  "aligned_words": [
    {
      "word": "[Verse]\nWinter ",
      "success": true,
      "start_s": 8.38,
      "end_s": 8.78,
      "p_align": 0.982
    },
    {
      "word": "winds ",
      "success": true,
      "start_s": 8.78,
      "end_s": 9.54,
      "p_align": 0.961
    },
    {
      "word": "they ",
      "success": true,
      "start_s": 9.54,
      "end_s": 9.93,
      "p_align": 0.99
    },
    {
      "word": "cut ",
      "success": true,
      "start_s": 9.93,
      "end_s": 10.41,
      "p_align": 0.998
    },
    {
      "word": "so ",
      "success": true,
      "start_s": 10.41,
      "end_s": 10.93,
      "p_align": 0.996
    },
    {
      "word": "deep\n",
      "success": true,
      "start_s": 10.93,
      "end_s": 11.93,
      "p_align": 0.997
    },
    ....
  ],
  "waveform_data": [
    0.001, 0.00109, 0.04219, 0.03597, ....
  ],
  "hoot_cer": 0.03556771545827633,
  "is_streamed": false
}

# 生成歌曲(自定义模式)

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/submit/music:
    post:
      summary: 生成歌曲(自定义模式)
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                mv:
                  type: string
                title:
                  type: string
                tags:
                  type: string
                continue_at:
                  type: integer
                continue_clip_id:
                  type: string
                task:
                  type: string
                make_instrumental:
                  type: boolean
              required:
                - prompt
                - mv
                - title
                - tags
                - continue_at
                - continue_clip_id
                - task
                - make_instrumental
              x-apifox-orders:
                - prompt
                - mv
                - title
                - tags
                - continue_at
                - continue_clip_id
                - task
                - make_instrumental
            example:
              prompt: |-
                [Verse]
                Move your paws
                Left and right
                Jump around
                Feel the light
                Whiskers twitch
                Tails in the air
                Dancing cats
                Everywhere

                [Chorus]
                Cat dance
                Oh
                Let's go!
                Swing your tails
                Don’t say no (don’t say no!)
                Purr and twirl
                Like a show
                Cat dance
                Let's steal the glow

                [Verse 2]
                Tiptoe steps
                Soft and sweet
                Tiny paws
                Unbeatable beat
                Meow to the rhythm
                Claws precise
                Every move
                Feline paradise

                [Chorus]
                Cat dance
                Oh
                Let's go!
                Swing your tails
                Don’t say no (don’t say no!)
                Purr and twirl
                Like a show
                Cat dance
                Let's steal the glow

                [Bridge]
                Ooh-ooh
                Bounce and sway (ooh-ooh!)
                Moonlit grooves
                Night turns to day
                Lean and stretch
                Strike your pose
                Every kitty steals the show

                [Chorus]
                Cat dance
                Oh
                Let's go!
                Swing your tails
                Don’t say no (don’t say no!)
                Purr and twirl
                Like a show
                Cat dance
                Let's steal the glow
              mv: chirp-v4
              title: Cat Dance
              tags: romantic raga
              continue_at: 123
              continue_clip_id: 4c4c80c4-6318-48c7-a314-71dd03ba3a11
              task: extend
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-290935144-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 生成歌曲(灵感模式)

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/submit/music:
    post:
      summary: 生成歌曲(灵感模式)
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                mv:
                  type: string
                title:
                  type: string
                tags:
                  type: string
                continue_at:
                  type: integer
                continue_clip_id:
                  type: string
                task:
                  type: string
                make_instrumental:
                  type: boolean
              required:
                - prompt
                - mv
                - title
                - tags
                - continue_at
                - continue_clip_id
                - task
                - make_instrumental
              x-apifox-orders:
                - prompt
                - mv
                - title
                - tags
                - continue_at
                - continue_clip_id
                - task
                - make_instrumental
            examples: {}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apifox-orders: []
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-290934291-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 生成歌曲(续写模式)

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/submit/music:
    post:
      summary: 生成歌曲(续写模式)
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                mv:
                  type: string
                title:
                  type: string
                tags:
                  type: string
                continue_at:
                  type: integer
                continue_clip_id:
                  type: string
                task:
                  type: string
                make_instrumental:
                  type: boolean
              required:
                - prompt
                - mv
                - title
                - tags
                - continue_at
                - continue_clip_id
                - task
                - make_instrumental
              x-apifox-orders:
                - prompt
                - mv
                - title
                - tags
                - continue_at
                - continue_clip_id
                - task
                - make_instrumental
            examples: {}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apifox-orders: []
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-290942843-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 生成歌曲(歌手风格) 

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/submit/music:
    post:
      summary: '生成歌曲(歌手风格) '
      deprecated: false
      description: |+
        # 接入步骤：
        ### A.生成音乐
        可以通过场生成歌曲接口生成后，获取其中的一首歌的 clip_id 值为 54834687-5e79-4f08-8e14-cf188f15b598

        ### B.新建 Persona
        clip_id 需要系统内存在的,非 uploader
        不能跨账号 所以可能账号下线用不了

        ### C.使用 persona_id 创作
        注意 mv 为 chirp-v3-5-tau 或者 chirp-v4-tau
        task 为 artist_consistency
        persona_id 为 B 步骤得到的
        artist_clip_id 就是 A 步骤中的 clip_id
        可跨账号

      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                generation_type:
                  type: string
                tags:
                  type: string
                negative_tags:
                  type: string
                mv:
                  type: string
                title:
                  type: string
                task:
                  type: string
                persona_id:
                  type: string
                artist_clip_id:
                  type: string
              required:
                - prompt
                - generation_type
                - tags
                - negative_tags
                - mv
                - title
                - task
                - persona_id
                - artist_clip_id
              x-apifox-orders:
                - prompt
                - generation_type
                - tags
                - negative_tags
                - mv
                - title
                - task
                - persona_id
                - artist_clip_id
            example:
              prompt: |-
                [Verse]
                你从清晨到黄昏
                一直在我身边温暖
                风吹雨打也不怕
                紧握手永不分开

                [Verse 2]
                有你在我不孤单
                就像繁星在夜晚
                路再长也不觉得远
                因为你是我的光

                [Chorus]
                老公老公我爱你
                你是世界的唯一
                无论在天涯海角
                心如影随形不离

                [Verse 3]
                你是我的避风港
                每天夜里梦都是你
                即使前路多辛苦
                有你一切多美丽

                [Chorus]
                老公老公我爱你
                你是世界的唯一
                无论在天涯海角
                心如影随形不离

                [Bridge]
                生命中的每一刻
                有你陪伴去体会
                所有明天都更好
                因为有你我无敌
              generation_type: TEXT
              tags: electronic, pop
              negative_tags: ''
              mv: chirp-v4-tau
              title: 老公
              task: artist_consistency
              persona_id: 0f6e8077-a7ba-4fc8-8f60-de02c66e56ce
              artist_clip_id: a5fa604c-18b8-4e7f-8d25-9412d4ba8163
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: developing
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-294754915-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 生成歌曲(上传歌曲二次创作)

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/submit/music:
    post:
      summary: 生成歌曲(上传歌曲二次创作)
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                mv:
                  type: string
                title:
                  type: string
                tags:
                  type: string
                continue_at:
                  type: integer
                continue_clip_id:
                  type: string
                  description: 上传的初始化歌曲id
                task:
                  type: string
                  x-apifox-mock: upload_extend
                  description: upload_extend
                make_instrumental:
                  type: boolean
              required:
                - prompt
                - mv
                - title
                - tags
                - continue_at
                - continue_clip_id
                - task
                - make_instrumental
              x-apifox-orders:
                - prompt
                - mv
                - title
                - tags
                - continue_at
                - continue_clip_id
                - task
                - make_instrumental
            example:
              prompt: 歌词
              tags: ''
              negative_tags: ''
              mv: chirp-v4
              title: 标题
              continue_clip_id: ca94a97d-d3f2-4a63-aeee-ba3a43384bcd
              continue_at: 10
              task: upload_extend
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-294753410-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 生成歌曲(拼接歌曲)

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/submit/concat:
    post:
      summary: 生成歌曲(拼接歌曲)
      deprecated: false
      description: |-
        1. 先生成音乐（2首
        2. 续写又得到音乐（2首
        3. 把要续写的音乐id 给放这，拼接得到完整音乐
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: Content-Type
          in: header
          description: ''
          required: false
          example: application/json
          schema:
            type: string
        - name: Accept
          in: header
          description: ''
          required: false
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                clip_id:
                  type: string
                  description: extend 后的 歌曲ID
                is_infill:
                  type: boolean
              x-apifox-orders:
                - clip_id
                - is_infill
              required:
                - clip_id
            example:
              clip_id: extend 后的 歌曲ID
              is_infill: false
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                  message:
                    type: string
                  data:
                    type: string
                    description: task_id
                x-apifox-orders:
                  - code
                  - message
                  - data
                required:
                  - code
                  - message
                  - data
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-208365078-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 生成歌曲(曲声分离)

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/submit/music:
    post:
      summary: 生成歌曲(曲声分离)
      deprecated: false
      description: |-
        请求体

        注意 mv为 chirp-auk
        task 为 gen_stem
        stem_task 为 two
        stem_type_group_name 为 Two
        continue_clip_id 就是 A 步骤中的 clip_id
        可跨账号
        计费:一次生成费用
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                task:
                  type: string
                generation_type:
                  type: string
                title:
                  type: string
                mv:
                  type: string
                prompt:
                  type: string
                make_instrumental:
                  type: boolean
                continue_clip_id:
                  type: string
                continued_aligned_prompt:
                  type: 'null'
                continue_at:
                  type: 'null'
                stem_type_id:
                  type: integer
                stem_type_group_name:
                  type: string
                stem_task:
                  type: string
              required:
                - task
                - generation_type
                - title
                - mv
                - prompt
                - make_instrumental
                - continue_clip_id
                - continued_aligned_prompt
                - continue_at
                - stem_type_id
                - stem_type_group_name
                - stem_task
              x-apifox-orders:
                - task
                - generation_type
                - title
                - mv
                - prompt
                - make_instrumental
                - continue_clip_id
                - continued_aligned_prompt
                - continue_at
                - stem_type_id
                - stem_type_group_name
                - stem_task
            examples: {}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apifox-orders: []
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-318769173-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 生成歌词

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/submit/lyrics:
    post:
      summary: 生成歌词
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: Content-Type
          in: header
          description: ''
          required: false
          example: application/json
          schema:
            type: string
        - name: Accept
          in: header
          description: ''
          required: false
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                  description: 歌词提示词
                notify_hook:
                  type: string
                  description: 回调地址
              x-apifox-orders:
                - prompt
                - notify_hook
              required:
                - prompt
            example:
              prompt: dance
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                  message:
                    type: string
                  data:
                    type: string
                    description: task_id
                x-apifox-orders:
                  - code
                  - message
                  - data
                required:
                  - code
                  - message
                  - data
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-175774406-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 上传请求

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /sunoi/uploads/audio:
    post:
      summary: 上传请求
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                extension:
                  type: string
              required:
                - extension
              x-apifox-orders:
                - extension
            example:
              extension: mp3
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-294748271-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 报告上传完毕

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /sunoi/uploads/audio/{id}/upload-finish:
    post:
      summary: 报告上传完毕
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: id
          in: path
          description: ''
          required: true
          schema:
            type: string
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                upload_type:
                  type: string
                upload_filename:
                  type: string
              required:
                - upload_type
                - upload_filename
              x-apifox-orders:
                - upload_type
                - upload_filename
            example:
              upload_type: file_upload
              upload_filename: you_mp3_name.mp3
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-294752192-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 查询上传处理状态

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /sunoi/uploads/audio/{id}:
    get:
      summary: 查询上传处理状态
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: id
          in: path
          description: ''
          required: true
          schema:
            type: string
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-294752734-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 初始化音频文件

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /sunoi/uploads/audio/{id}/initialize-clip:
    post:
      summary: 初始化音频文件
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: id
          in: path
          description: ''
          required: true
          schema:
            type: string
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties: {}
              x-apifox-orders: []
            example: {}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-294753238-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# Persona:创建歌手风格

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/persona/create/:
    post:
      summary: Persona:创建歌手风格
      deprecated: false
      description: >+
        clip_id 需要系统内存在的,非 uploader

        不能跨账号 所以可能账号下线用不了


        返回体 关键的得到 id 为 fd213afd-ac1c-4822-9802-c1c0ea45e77b 设定为 persona_id
        供下一步使用

      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                root_clip_id:
                  type: string
                name:
                  type: string
                description:
                  type: string
                clips:
                  type: array
                  items:
                    type: string
                is_public:
                  type: boolean
              required:
                - root_clip_id
                - name
                - description
                - clips
                - is_public
              x-apifox-orders:
                - root_clip_id
                - name
                - description
                - clips
                - is_public
            example:
              root_clip_id: 54834687-5e79-4f08-8e14-cf188f15b598
              name: Persona 标题
              description: Persona 描述
              clips:
                - 54834687-5e79-4f08-8e14-cf188f15b598
              is_public: true
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-294753975-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# tags: 拓展 style tags

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/act/tags:
    post:
      summary: 'tags: 拓展 style tags'
      deprecated: false
      description: |-
        tags 就是 style
        不知道如何写 style 可以使用这个接口

        original_tags 传入相关提示词
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                original_tags:
                  type: string
              required:
                - original_tags
              x-apifox-orders:
                - original_tags
            example:
              original_tags: student
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
              example:
                upsampled_tags: >-
                  Laid-back indie pop driven by a clean guitar riff, tight bass,
                  and crisp drums. Verses feature subtle synth textures and
                  gentle background vocals. A catchy chorus lifts with layered
                  harmonies and handclaps. Bridge introduces a bright Rhodes
                  piano before a dynamic final chorus.
                request_id: 507acd16-8b84-4e55-be2b-4329d82efb26
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-367617233-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 查询歌词

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/fetch/{task_id}:
    get:
      summary: 查询歌词
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: task_id
          in: path
          description: 任务ID
          required: true
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                  message:
                    type: string
                  data:
                    type: object
                    properties:
                      task_id:
                        type: string
                      notify_hook:
                        type: string
                      action:
                        type: string
                      status:
                        type: string
                      fail_reason:
                        type: string
                      submit_time:
                        type: integer
                      start_time:
                        type: integer
                      finish_time:
                        type: integer
                      progress:
                        type: string
                      data:
                        type: array
                        items:
                          type: object
                          properties:
                            id:
                              type: string
                            title:
                              type: string
                            status:
                              type: string
                            metadata:
                              type: object
                              properties:
                                tags:
                                  type: string
                                prompt:
                                  type: string
                                duration:
                                  type: integer
                                error_type:
                                  type: 'null'
                                error_message:
                                  type: 'null'
                                audio_prompt_id:
                                  type: 'null'
                                gpt_description_prompt:
                                  type: string
                              required:
                                - tags
                                - prompt
                                - duration
                                - error_type
                                - error_message
                                - audio_prompt_id
                                - gpt_description_prompt
                              x-apifox-orders:
                                - tags
                                - prompt
                                - duration
                                - error_type
                                - error_message
                                - audio_prompt_id
                                - gpt_description_prompt
                            audio_url:
                              type: string
                            image_url:
                              type: string
                            video_url:
                              type: string
                            model_name:
                              type: string
                            image_large_url:
                              type: string
                            major_model_version:
                              type: string
                          required:
                            - id
                            - title
                            - status
                            - metadata
                            - audio_url
                            - image_url
                            - video_url
                            - model_name
                            - image_large_url
                            - major_model_version
                          x-apifox-orders:
                            - id
                            - title
                            - status
                            - metadata
                            - audio_url
                            - image_url
                            - video_url
                            - model_name
                            - image_large_url
                            - major_model_version
                    required:
                      - task_id
                      - notify_hook
                      - action
                      - status
                      - fail_reason
                      - submit_time
                      - start_time
                      - finish_time
                      - progress
                      - data
                    x-apifox-orders:
                      - task_id
                      - notify_hook
                      - action
                      - status
                      - fail_reason
                      - submit_time
                      - start_time
                      - finish_time
                      - progress
                      - data
                required:
                  - code
                  - message
                  - data
                x-apifox-orders:
                  - code
                  - message
                  - data
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: developing
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-175909212-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 批量获取任务

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/fetch:
    post:
      summary: 批量获取任务
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: Accept
          in: header
          description: ''
          required: false
          example: application/json
          schema:
            type: string
        - name: Content-Type
          in: header
          description: ''
          required: false
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                ids:
                  type: array
                  items:
                    type: string
                  description: task_id 列表
                action:
                  type: string
                  description: 操作：MUSIC、LYRICS
              x-apifox-orders:
                - ids
                - action
              required:
                - ids
            examples: {}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                  message:
                    type: string
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        task_id:
                          type: string
                        notify_hook:
                          type: string
                        action:
                          type: string
                        status:
                          type: string
                        fail_reason:
                          type: string
                        submit_time:
                          type: integer
                        start_time:
                          type: integer
                        finish_time:
                          type: integer
                        progress:
                          type: string
                        data:
                          type: array
                          items:
                            type: object
                            properties:
                              id:
                                type: string
                              title:
                                type: string
                              status:
                                type: string
                              metadata:
                                type: object
                                properties:
                                  tags:
                                    type: string
                                  prompt:
                                    type: string
                                  duration:
                                    type: 'null'
                                  error_type:
                                    type: 'null'
                                  error_message:
                                    type: 'null'
                                  audio_prompt_id:
                                    type: 'null'
                                  gpt_description_prompt:
                                    type: string
                                required:
                                  - tags
                                  - prompt
                                  - duration
                                  - error_type
                                  - error_message
                                  - audio_prompt_id
                                  - gpt_description_prompt
                                x-apifox-orders:
                                  - tags
                                  - prompt
                                  - duration
                                  - error_type
                                  - error_message
                                  - audio_prompt_id
                                  - gpt_description_prompt
                              audio_url:
                                type: string
                              image_url:
                                type: string
                              video_url:
                                type: string
                              model_name:
                                type: string
                              image_large_url:
                                type: string
                              major_model_version:
                                type: string
                            required:
                              - id
                              - title
                              - status
                              - metadata
                              - audio_url
                              - image_url
                              - video_url
                              - model_name
                              - image_large_url
                              - major_model_version
                            x-apifox-orders:
                              - id
                              - title
                              - status
                              - metadata
                              - audio_url
                              - image_url
                              - video_url
                              - model_name
                              - image_large_url
                              - major_model_version
                        01HYA5E4C7JK3Z54KZC15MT6MF:
                          type: string
                        01HYA5E6591BRCC6W1VDFB5XSM:
                          type: string
                        01HYA5E6J1YHDJZ55GGES1YCQA:
                          type: string
                        01HYA5E6WS1W6XE3WSZ1QDQMS8:
                          type: string
                        01HYA5E731PEJDJP7HS4YBQBG0:
                          type: string
                        01HYA5E7FTPXEFSXWHT2PKBY79:
                          type: string
                      x-apifox-orders:
                        - 01HYA5E4C7JK3Z54KZC15MT6MF
                        - 01HYA5E6591BRCC6W1VDFB5XSM
                        - 01HYA5E6J1YHDJZ55GGES1YCQA
                        - 01HYA5E6WS1W6XE3WSZ1QDQMS8
                        - 01HYA5E731PEJDJP7HS4YBQBG0
                        - 01HYA5E7FTPXEFSXWHT2PKBY79
                        - task_id
                        - notify_hook
                        - action
                        - status
                        - fail_reason
                        - submit_time
                        - start_time
                        - finish_time
                        - progress
                        - data
                      required:
                        - 01HYA5E4C7JK3Z54KZC15MT6MF
                        - 01HYA5E6591BRCC6W1VDFB5XSM
                        - 01HYA5E6J1YHDJZ55GGES1YCQA
                        - 01HYA5E6WS1W6XE3WSZ1QDQMS8
                        - 01HYA5E731PEJDJP7HS4YBQBG0
                        - 01HYA5E7FTPXEFSXWHT2PKBY79
                required:
                  - code
                  - message
                  - data
                x-apifox-orders:
                  - code
                  - message
                  - data
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-175774564-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# 批量获取任务

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/fetch:
    post:
      summary: 批量获取任务
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: Accept
          in: header
          description: ''
          required: false
          example: application/json
          schema:
            type: string
        - name: Content-Type
          in: header
          description: ''
          required: false
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                ids:
                  type: array
                  items:
                    type: string
                  description: task_id 列表
                action:
                  type: string
                  description: 操作：MUSIC、LYRICS
              x-apifox-orders:
                - ids
                - action
              required:
                - ids
            examples: {}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                  message:
                    type: string
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        task_id:
                          type: string
                        notify_hook:
                          type: string
                        action:
                          type: string
                        status:
                          type: string
                        fail_reason:
                          type: string
                        submit_time:
                          type: integer
                        start_time:
                          type: integer
                        finish_time:
                          type: integer
                        progress:
                          type: string
                        data:
                          type: array
                          items:
                            type: object
                            properties:
                              id:
                                type: string
                              title:
                                type: string
                              status:
                                type: string
                              metadata:
                                type: object
                                properties:
                                  tags:
                                    type: string
                                  prompt:
                                    type: string
                                  duration:
                                    type: 'null'
                                  error_type:
                                    type: 'null'
                                  error_message:
                                    type: 'null'
                                  audio_prompt_id:
                                    type: 'null'
                                  gpt_description_prompt:
                                    type: string
                                required:
                                  - tags
                                  - prompt
                                  - duration
                                  - error_type
                                  - error_message
                                  - audio_prompt_id
                                  - gpt_description_prompt
                                x-apifox-orders:
                                  - tags
                                  - prompt
                                  - duration
                                  - error_type
                                  - error_message
                                  - audio_prompt_id
                                  - gpt_description_prompt
                              audio_url:
                                type: string
                              image_url:
                                type: string
                              video_url:
                                type: string
                              model_name:
                                type: string
                              image_large_url:
                                type: string
                              major_model_version:
                                type: string
                            required:
                              - id
                              - title
                              - status
                              - metadata
                              - audio_url
                              - image_url
                              - video_url
                              - model_name
                              - image_large_url
                              - major_model_version
                            x-apifox-orders:
                              - id
                              - title
                              - status
                              - metadata
                              - audio_url
                              - image_url
                              - video_url
                              - model_name
                              - image_large_url
                              - major_model_version
                        01HYA5E4C7JK3Z54KZC15MT6MF:
                          type: string
                        01HYA5E6591BRCC6W1VDFB5XSM:
                          type: string
                        01HYA5E6J1YHDJZ55GGES1YCQA:
                          type: string
                        01HYA5E6WS1W6XE3WSZ1QDQMS8:
                          type: string
                        01HYA5E731PEJDJP7HS4YBQBG0:
                          type: string
                        01HYA5E7FTPXEFSXWHT2PKBY79:
                          type: string
                      x-apifox-orders:
                        - 01HYA5E4C7JK3Z54KZC15MT6MF
                        - 01HYA5E6591BRCC6W1VDFB5XSM
                        - 01HYA5E6J1YHDJZ55GGES1YCQA
                        - 01HYA5E6WS1W6XE3WSZ1QDQMS8
                        - 01HYA5E731PEJDJP7HS4YBQBG0
                        - 01HYA5E7FTPXEFSXWHT2PKBY79
                        - task_id
                        - notify_hook
                        - action
                        - status
                        - fail_reason
                        - submit_time
                        - start_time
                        - finish_time
                        - progress
                        - data
                      required:
                        - 01HYA5E4C7JK3Z54KZC15MT6MF
                        - 01HYA5E6591BRCC6W1VDFB5XSM
                        - 01HYA5E6J1YHDJZ55GGES1YCQA
                        - 01HYA5E6WS1W6XE3WSZ1QDQMS8
                        - 01HYA5E731PEJDJP7HS4YBQBG0
                        - 01HYA5E7FTPXEFSXWHT2PKBY79
                required:
                  - code
                  - message
                  - data
                x-apifox-orders:
                  - code
                  - message
                  - data
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-175774564-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
# Timing:歌词、音频时间线

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /suno/act/timing/{clip_id}:
    get:
      summary: Timing:歌词、音频时间线
      deprecated: false
      description: ''
      tags:
        - 音频接口/Suno文生歌
      parameters:
        - name: clip_id
          in: path
          description: ''
          required: true
          schema:
            type: string
        - name: accept
          in: header
          description: ''
          required: false
          example: '*/*'
          schema:
            type: string
        - name: content-type
          in: header
          description: ''
          required: true
          example: application/json
          schema:
            type: string
        - name: Authorization
          in: header
          description: ''
          required: false
          example: Bearer {{YOUR_API_KEY}}
          schema:
            type: string
            default: Bearer {{YOUR_API_KEY}}
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties: {}
          headers: {}
          x-apifox-name: 成功
      security: []
      x-apifox-folder: 音频接口/Suno文生歌
      x-apifox-status: released
      x-run-in-apifox: https://app.apifox.com/web/project/3868318/apis/api-294760071-run
components:
  schemas: {}
  securitySchemes: {}
servers: []
security: []

```
