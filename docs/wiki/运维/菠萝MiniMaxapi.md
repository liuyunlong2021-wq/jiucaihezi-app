# aimanplay.cn 视频生成 API 使用文档

> 本文件供 AI agent 使用:请严格按本文档字段与取值调用,不要发明字段。
> 文档中的模型 id、时长范围、分辨率枚举、字段名、计费金额均与平台代码一致,可直接照抄。

---

## 1. 平台总览

- 平台域名:**aimanplay.cn**(中文品牌:菠萝 max)
- 能力:视频生成 API(MiniMax-H3 图生/音生/文生视频,经由 AutoDL ComfyUI workflow)
- 计费:**¥0.06 / 秒**,按请求中声明的时长(秒)预扣,**任务失败自动退款**
- 额度换算:约 **1 元 ≈ 70000 quota**(金额 → quota 的展示换算按站点配置,此数值为站点约定值)
- 充值方式:登录网站在「钱包」页充值,或使用兑换码
- 全流程:建令牌 → 上传素材到 OSS → 提交视频任务 → 轮询任务 → 下载成片

三个可用模型:

| 模型名 | 说明 |
| --- | --- |
| `minimax_h3_lightx2v` | 首尾帧图生视频(需首、尾两帧图片) |
| `minimax_h3_image_audio_to_video_v2_15s` | 图片 + 音频参考生成视频 |
| `minimax_h3_lightx2v_no_pic` | 纯文生视频(仅需 prompt) |

---

## 2. 认证

所有接口(含 OSS STS)均使用 HTTP 头认证:

```
Authorization: Bearer sk-xxx
```

- 令牌前缀 `sk-`,在控制台「**令牌**」页面新建
- 本 API 平台的是标准 OpenAI 兼容 token;OSS STS 接口同样接受该 `sk-` 令牌
- 不要使用 `X-API-Key` 等其它头部,一律走 Bearer

curl 通用写法:

```bash
curl https://aimanplay.cn/v1/videos -H "Authorization: Bearer sk-你的令牌"
```

Python 通用写法(全文变量 `TOKEN` 均指它):

```python
import os
TOKEN = os.environ["AIMANPLAY_TOKEN"]
AUTH_HEADERS = {"Authorization": f"Bearer {TOKEN}"}
```

---

## 3. OSS 文件上传

生成视频前,素材图片/音频必须先上传到 OSS,拿到公开 URL 后再传给生成接口。视频生成接口不接收文件流,只接收 URL。

### 3.1 申请临时上传凭证(STS)

```
POST https://aimanplay.cn/api/video-upload/oss-sts
Authorization: Bearer sk-xxx
```

该接口返回短时间内有效的 OSS 上传凭证(有效期 1 小时)。**不要硬编码任何桶名 / region / AK / 目录**——全部从响应里取。

curl:

```bash
curl -X POST https://aimanplay.cn/api/video-upload/oss-sts \
  -H "Authorization: Bearer sk-你的令牌"
```

响应字段(JSON,`success: true` 为正常):

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `success` | bool | 请求是否成功 |
| `enabled` | bool | OSS 上传功能是否开启(关闭时接口返回 HTTP 503,配合 `message` 说明) |
| `message` | string | 失败时的错误信息 |
| `host` | string | **上传目标域名**,形如 `https://{bucket}.{region}.aliyuncs.com`,也是公开 URL 的前缀 |
| `region` | string | 区域,已带 `oss-` 前缀(如 `oss-cn-hangzhou`) |
| `bucket` | string | 桶名(已含在 `host` 中,但签名时仍需显式使用) |
| `dir` | string | 上传目录前缀(对象 key 必须以 `dir/` 开头) |
| `accessKeyId` | string | STS 临时 AccessKeyId |
| `accessKeySecret` | string | STS 临时 AccessKeySecret |
| `securityToken` | string | STS 安全令牌(SecurityToken) |
| `expiration` | string | 凭证过期时间(ISO8601) |
| `maxImageBytes` | number | 图片大小上限(字节,默认 10MB) |
| `maxAudioBytes` | number | 音频大小上限(字节,默认 20MB) |

Python:

```python
import requests
resp = requests.post(
    "https://aimanplay.cn/api/video-upload/oss-sts",
    headers=AUTH_HEADERS,
    timeout=30,
)
resp.raise_for_status()
sts = resp.json()
if not sts.get("success"):
    raise RuntimeError(sts.get("message"))
```

### 3.2 上传方式 A:Python 官方 SDK(oss2)

```bash
pip install oss2
```

```python
import oss2
import uuid

# sts 为 3.1 节响应 JSON
key = f'{sts["dir"]}/{uuid.uuid4().hex}.png'           # 对象 key:目录 + 自建 uuid + 扩展名
endpoint = f'https://{sts["region"]}.aliyuncs.com'     # 由 region 拼出 SDK endpoint,桶名另传

auth = oss2.StsAuth(
    sts["accessKeyId"],
    sts["accessKeySecret"],
    sts["securityToken"],
)
bucket = oss2.Bucket(auth, endpoint, sts["bucket"])

bucket.put_object(
    key,
    open("image.png", "rb"),
    headers={"x-oss-object-acl": "public-read"},
    content_type="image/png",
)

video_image_url = f'{sts["host"]}/{key}'               # 公开 URL,直接喂给生成接口
```

### 3.3 上传方式 B:手写 OSS V1 签名 PUT(不装 SDK)

纯 `requests` + 标准库(`hmac` / `hashlib` / `base64` / `email.utils`)完成。签名算法已按生产验证过的实现:

- CanonicalizedOSSHeaders:`x-oss-*` 头按名排序,每行 `name:value`(冒号后**无空格**),行间 `\n` 连接,列表本身不以 `\n` 结尾
- StringToSign(共 6 段,`\n` 连接):
  `VERB`、Content-MD5(**空串**)、Content-Type、Date、CanonicalizedOSSHeaders、`/{bucket}/{key}`
- **重点:StringToSign 的 Date 槽位必须填 `x-oss-date` 头的同一天值,不能留空**。浏览器禁止设置 `Date` 头,因此时间戳由 `x-oss-date` 承载;若 Date 槽位留空,OSS 返回 `SignatureDoesNotMatch`(生产实测,填入同值则 PUT 200)
- 必须带上 `x-oss-object-acl: public-read` 头,且该头参与签名,才能产出可公开访问的对象
- 签名 = `base64(HMAC-SHA1(accessKeySecret, StringToSign))`
- Authorization 头 = `OSS {accessKeyId}:{signature}`

```python
import base64
import email.utils
import hashlib
import hmac
import uuid

import requests

STR_TO_SIGN_JOIN = "\n"


def now_rfc1123():
    # 例如: Wed, 03 Sep 2026 12:00:00 GMT —— 与 x-oss-date 值一致
    return email.utils.formatdate(usegmt=True)


def upload_to_oss(local_path: str, content_type: str, sts: dict) -> str:
    date = now_rfc1123()
    key = f'{sts["dir"]}/{uuid.uuid4().hex}'
    if content_type == "image/png":
        key += ".png"
    elif content_type == "image/jpeg":
        key += ".jpg"
    elif content_type.startswith("audio/"):
        key += ".mp3"
    else:
        key += ".bin"

    canonical_headers = "\n".join(sorted([
        "x-oss-date:" + date,
        "x-oss-object-acl:public-read",
        "x-oss-security-token:" + sts["securityToken"],
    ]))

    string_to_sign = STR_TO_SIGN_JOIN.join([
        "PUT",
        "",  # Content-MD5 为空
        content_type,
        date,
        canonical_headers,
        f'/{sts["bucket"]}/{key}',  # CanonicalizedResource,注意显式含 bucket
    ])

    signature = base64.b64encode(
        hmac.new(
            sts["accessKeySecret"].encode("utf-8"),
            string_to_sign.encode("utf-8"),
            hashlib.sha1,
        ).digest()
    ).decode("utf-8")

    url = f'{sts["host"]}/{key}'
    with open(local_path, "rb") as f:
        resp = requests.put(
            url,
            data=f,
            headers={
                "Authorization": f'OSS {sts["accessKeyId"]}:{signature}',
                "Content-Type": content_type,
                "x-oss-date": date,
                "x-oss-object-acl": "public-read",
                "x-oss-security-token": sts["securityToken"],
            },
            timeout=120,
        )
    if not resp.ok:
        raise RuntimeError(f"OSS PUT failed: {resp.status_code} {resp.text[:200]}")
    return url
```

### 3.4 上传结果

上传成功后,素材的公开 URL 为:

```
{host}/{dir}/{uuid}.{ext}
```

- `{uuid}` 由调用方自建(示例用 `uuid4().hex`,可兼容 `dir` / uuid / 扩展名只需 URL 安全字符)
- 该 URL 直接在视频生成请求中作为图片/音频字段的值传入

---

## 4. 视频生成

```
POST https://aimanplay.cn/v1/videos
Authorization: Bearer sk-xxx
Content-Type: application/json
```

请求体字段(JSON 对象):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 模型 id,见下表,必填 |
| `prompt` | string | 视频内容描述,必填 |
| `duration` | number | 视频时长(秒)。取值范围见下表;**计费以该声明秒数为准预扣**。`seconds` 为同义兼容字段 |
| `resolution` | string | 分辨率,取值必须是下表该模型的枚举值,不能发明 |
| `first_frame` / `last_frame` | string | 首尾帧 URL,仅 `minimax_h3_lightx2v`,两项均必填 |
| `ref_image_0` … `ref_image_8` | string | 参考图 URL(最多 9 张),仅 `minimax_h3_image_audio_to_video_v2_15s`;下标从 0 连续编号 |
| `ref_audio_0` … `ref_audio_2` | string | 参考音频 URL(最多 3 段),仅 `minimax_h3_image_audio_to_video_v2_15s`;下标从 0 连续编号 |
| `seed` | number | 可选,非负整数,固定随机种子 |

### 模型参数表

| 模型 id | 说明 | duration 范围 | resolution 枚举 | 图片/音频字段 |
| --- | --- | --- | --- | --- |
| `minimax_h3_lightx2v` | 首尾帧图生视频 | 1–10 秒(默认 5) | `480p竖`、`480p横`、`768p竖`、`768p横`、`480p(1:1)`、`768p(1:1)` | 必填 `first_frame`、`last_frame`,无 ref 组 |
| `minimax_h3_image_audio_to_video_v2_15s` | 图片 + 音频参考 | 1–15 秒(默认 15) | `480p竖`、`768p竖`、`480p横`、`768p横` | `ref_image_0`~`ref_image_8`(≤9)、`ref_audio_0`~`ref_audio_2`(≤3);无首尾帧字段 |
| `minimax_h3_lightx2v_no_pic` | 纯文生视频 | 1–10 秒(默认 5) | `480p竖`、`480p横`、`768p竖`、`768p横`、`480p(1:1)`、`768p(1:1)` | 无,仅 `prompt` |

> 请求中未传 `duration` 时,后端按模型默认值计费估算(`minimax_h3_image_audio_to_video_v2_15s` 默认 15,其余默认 5)。**建议显式传 `duration`**。

### 各模型最小请求示例

模型 `minimax_h3_lightx2v`(首尾帧):

```json
{
  "model": "minimax_h3_lightx2v",
  "prompt": "一条金色锦鲤在深蓝水波中游动",
  "duration": 5,
  "resolution": "768p竖",
  "first_frame": "https://oss虚拟主机域名/dir/uuid1.png",
  "last_frame": "https://oss虚拟主机域名/dir/uuid2.png"
}
```

模型 `minimax_h3_image_audio_to_video_v2_15s`(图 + 音频参考):

```json
{
  "model": "minimax_h3_image_audio_to_video_v2_15s",
  "prompt": "人物随音乐节奏弹奏钢琴",
  "duration": 5,
  "resolution": "768p竖",
  "ref_image_0": "https://oss虚拟主机域名/dir/uuid1.png",
  "ref_audio_0": "https://oss虚拟主机域名/dir/uuid1.mp3"
}
```

模型 `minimax_h3_lightx2v_no_pic`(文生视频):

```json
{
  "model": "minimax_h3_lightx2v_no_pic",
  "prompt": "日落时分,城市天际线在云层中缓缓浮现",
  "duration": 5,
  "resolution": "768p竖"
}
```

curl:

```bash
curl -X POST https://aimanplay.cn/v1/videos \
  -H "Authorization: Bearer sk-你的令牌" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "minimax_h3_lightx2v_no_pic",
    "prompt": "日落时分,城市天际线在云层中缓缓浮现",
    "duration": 5,
    "resolution": "768p竖"
  }'
```

Python:

```python
body = {
    "model": "minimax_h3_lightx2v_no_pic",
    "prompt": "日落时分,城市天际线在云层中缓缓浮现",
    "duration": 5,
    "resolution": "768p竖",
}
resp = requests.post(
    "https://aimanplay.cn/v1/videos",
    headers={**AUTH_HEADERS, "Content-Type": "application/json"},
    json=body,
    timeout=60,
)
resp.raise_for_status()
task = resp.json()
task_id = task["id"]  # 响应与查询接口同构,取 id 作为任务 id
print(task_id)
```

响应为任务对象(OpenAIVideo 结构),字段同第 5 节查询接口,可直接取 `id` 作为任务 id。

---

## 5. 任务查询与成片下载

### 5.1 查询任务状态

```
GET https://aimanplay.cn/v1/videos/{id}
Authorization: Bearer sk-xxx
```

响应字段(JSON):

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 任务 id |
| `object` | string | 固定 `video` |
| `model` | string | 模型名 |
| `status` | string | 任务状态,枚举:`queued`(排队)、`in_progress`(生成中)、`completed`(完成)、`failed`(失败);另有兼容值 `unknown` |
| `progress` | number | 进度 0–100 |
| `created_at` | number | 创建时间(Unix 秒) |
| `completed_at` | number | 完成时间(Unix 秒,未完成时省略) |
| `error` | object | 失败时的错误:`{ "message": string, "code": string }` |
| `metadata` | object | 可选附加信息 |

> 响应**不含视频直链**(无 `url` 字段);下载成片请使用下方 5.2 节 `GET /v1/videos/{id}/content` 路由获取视频字节流。

curl:

```bash
curl https://aimanplay.cn/v1/videos/video_任务id \
  -H "Authorization: Bearer sk-你的令牌"
```

Python:

```python
resp = requests.get(
    f"https://aimanplay.cn/v1/videos/{task_id}",
    headers=AUTH_HEADERS,
    timeout=30,
)
resp.raise_for_status()
data = resp.json()
print(data["status"], data.get("progress"), data.get("error"))
```

### 5.2 下载成片

```
GET https://aimanplay.cn/v1/videos/{id}/content
Authorization: Bearer sk-xxx
```

返回视频字节流(非 JSON),可直接落盘为 MP4。内部支持 Range。

curl:

```bash
curl https://aimanplay.cn/v1/videos/video_任务id/content \
  -H "Authorization: Bearer sk-你的令牌" \
  -o video.mp4
```

Python:

```python
resp = requests.get(
    f"https://aimanplay.cn/v1/videos/{task_id}/content",
    headers=AUTH_HEADERS,
    timeout=120,
)
resp.raise_for_status()
with open("video.mp4", "wb") as f:
    f.write(resp.content)
```

### 5.3 轮询建议

- 建议**每 3 秒轮询一次** `GET /v1/videos/{id}`,直至 `status` 为 `completed` 或 `failed`
- 单任务最长等待建议 **30 分钟**,超时按失败处理
- 遇到非终态字段误报(如网络闪断),重试即可;终态判定只看 `status`

---

## 6. 完整最小示例(自包含 Python)

只用 `requests` + 标准库,手写 OSS V1 签名。令牌从环境变量 `AIMANPLAY_TOKEN` 读取;素材为本地 `image.png`。

```python
import base64
import email.utils
import hashlib
import hmac
import os
import time
import uuid

import requests

TOKEN = os.environ["AIMANPLAY_TOKEN"]
AUTH_HEADERS = {"Authorization": f"Bearer {TOKEN}"}


def now_rfc1123() -> str:
    return email.utils.formatdate(usegmt=True)


def fetch_sts() -> dict:
    resp = requests.post(
        "https://aimanplay.cn/api/video-upload/oss-sts",
        headers=AUTH_HEADERS,
        timeout=30,
    )
    resp.raise_for_status()
    sts = resp.json()
    if not sts.get("success"):
        raise RuntimeError(f"STS 失败: {sts.get('message')}")
    return sts


def upload_image(local_path: str, content_type: str, sts: dict) -> str:
    date = now_rfc1123()
    ext = content_type.rsplit("/", 1)[-1]
    key = f'{sts["dir"]}/{uuid.uuid4().hex}.{ext}'

    canonical_headers = "\n".join(sorted([
        "x-oss-date:" + date,
        "x-oss-object-acl:public-read",
        "x-oss-security-token:" + sts["securityToken"],
    ]))

    string_to_sign = "\n".join([
        "PUT",
        "",  # Content-MD5 空
        content_type,
        date,  # Date 槽位必须填 x-oss-date 的同一天值,不能留空
        canonical_headers,
        f'/{sts["bucket"]}/{key}',
    ])

    signature = base64.b64encode(
        hmac.new(
            sts["accessKeySecret"].encode(),
            string_to_sign.encode(),
            hashlib.sha1,
        ).digest()
    ).decode()

    url = f'{sts["host"]}/{key}'
    with open(local_path, "rb") as f:
        resp = requests.put(
            url,
            data=f,
            headers={
                "Authorization": f'OSS {sts["accessKeyId"]}:{signature}',
                "Content-Type": content_type,
                "x-oss-date": date,
                "x-oss-object-acl": "public-read",
                "x-oss-security-token": sts["securityToken"],
            },
            timeout=120,
        )
    if not resp.ok:
        raise RuntimeError(f"OSS PUT failed: {resp.status_code} {resp.text[:200]}")
    return url


def create_video(image_url: str) -> str:
    body = {
        "model": "minimax_h3_image_audio_to_video_v2_15s",
        "prompt": "一朵花从含苞到盛开的延时摄影",
        "duration": 1,          # 1 秒视频
        "resolution": "768p竖",
        "ref_image_0": image_url,
    }
    resp = requests.post(
        "https://aimanplay.cn/v1/videos",
        headers={**AUTH_HEADERS, "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def poll_until_done(task_id: str) -> dict:
    for _ in range(600):  # 3 秒一次 × 600 = 最长 30 分钟
        resp = requests.get(
            f"https://aimanplay.cn/v1/videos/{task_id}",
            headers=AUTH_HEADERS,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        status = data.get("status")
        if status == "completed":
            return data
        if status == "failed":
            raise RuntimeError(data.get("error", {}).get("message", "task failed"))
        time.sleep(3)
    raise TimeoutError("任务超时(30 分钟)")


def download_video(task_id: str) -> None:
    resp = requests.get(
        f"https://aimanplay.cn/v1/videos/{task_id}/content",
        headers=AUTH_HEADERS,
        timeout=120,
    )
    resp.raise_for_status()
    with open("video.mp4", "wb") as f:
        f.write(resp.content)


def main():
    sts = fetch_sts()
    image_url = upload_image("image.png", "image/png", sts)
    task_id = create_video(image_url)
    print("任务已提交:", task_id)

    final = poll_until_done(task_id)
    print("完成:", final.get("status"))

    download_video(task_id)
    print("已保存 video.mp4")


if __name__ == "__main__":
    main()
```

> 若用首尾帧模型 `minimax_h3_lightx2v`,则上传两次分别拿两个 URL,请求体改为
> `{"model": "minimax_h3_lightx2v", "first_frame": url1, "last_frame": url2, ...}` 即可。

---

## 7. 错误排错表

| 现象 | 说明 | 处理 |
| --- | --- | --- |
| HTTP **401** | 令牌无效 / 未传 `Authorization: Bearer sk-...` | 检查令牌是否在控制台新建、前缀是否为 `sk-`、是否过期 |
| HTTP **403** | 权限不足 / OSS 上传被拒 | 检查 STS 响应字段是否齐全;确认 `x-oss-object-acl: public-read` 参与签名;检查对象 key 是否在 `dir/` 之下 |
| OSS PUT 报 `SignatureDoesNotMatch` | 签名与请求头不一致 | 确认 StringToSign 的 Date 槽位与 `x-oss-date` 值一致(不能留空);确认 Content-Type 在签名与请求头中一致;确认 `x-oss-*` 头排序与拼写 |
| HTTP **429** | 触发限流 | 降低请求频率,稍后重试 |
| 「余额不足」/ `insufficient_user_quota` | quota 不足以覆盖本次预扣 | 到网站「钱包」充值,或使用兑换码 |
| HTTP **503** | OSS 上传功能未开启(STS 接口) | 联系平台管理员开启 OSS 集成 |
| 任务 `status: failed` | 上游生成失败 | 读取 `error.message` 获取具体原因;预扣费用会自动退款 |

---

## 8. 计费

- **单价:¥0.06 / 秒**,按请求声明的 `duration`(秒)预扣
- 计费预扣在提交时完成;**失败自动退款**,无需人工申请
- 额度单位与展示:1 元 ≈ 70000 quota;余额以站点「钱包」展示为准
- 充值:网站「钱包」页在线充值,或使用兑换码
- 计费明细在控制台「日志 / 消费记录」可查