GPT 生图运行指南
概览

本页只讲 GPT Image 的实际调用方式：文生图、图生图、返回结果保存，以及多张图片如何并发生成。接口兼容 OpenAI 图片接口，Base URL 使用 https://img-api.zxcode.vip。

运行前准备
先准备接口地址和密钥：


export BASE_URL="https://img-api.zxcode.vip"
export API_TOKEN="sk-xxxxxx"
每个请求都需要带上鉴权头：


-H "Authorization: Bearer $API_TOKEN"
超时设置

GPT 生图是同步返回，客户端超时建议设置为 300 秒。单张图片常见耗时约几十秒到两分钟，网络或排队时可能更久。

文生图
文生图使用 OpenAI 兼容端点：


POST https://img-api.zxcode.vip/v1/images/generations
最小可运行示例：


curl -X POST "$BASE_URL/v1/images/generations" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一张电影感产品海报，玻璃杯中的冰咖啡，柔和自然光，干净背景",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium"
  }'
常用参数：

参数	推荐写法	说明
model	gpt-image-2	标准生图模型
prompt	你的图片描述	描述主体、风格、构图、光线和限制
n	1	固定填 1；想要多张请发多个独立请求
size	1024x1024 / 2048x2048	常用正方形尺寸；也可使用已验证的横版或竖版尺寸
quality	medium	日常推荐，速度和效果较均衡；追求细节可用 high
多张图片不要依赖 n

n 参数无论填多少，实际都只返回 1 张。需要多张图时，请发多个请求；高并发批量生成时使用 gpt-image-2L。

高清生成
需要更高清的单张图时，可以把 size 改为 2048x2048，并把 quality 改为 high：


curl -X POST "$BASE_URL/v1/images/generations" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一张高端耳机的商业摄影图，黑色磨砂材质，暗色背景，边缘轮廓光，超清细节",
    "n": 1,
    "size": "2048x2048",
    "quality": "high"
  }'
尺寸建议

当前常用稳定尺寸包括 1024x1024、2048x2048、1792x1024、2048x1152、1024x1792、1536x1024、1024x1536 等。不要使用 4096x4096 这类 4K 正方形尺寸。

图生图 / 图片编辑
图生图使用 multipart/form-data：


POST https://img-api.zxcode.vip/v1/images/edits
示例：


curl -X POST "$BASE_URL/v1/images/edits" \
  -H "Authorization: Bearer $API_TOKEN" \
  -F "model=gpt-image-2" \
  -F "prompt=把图片中的猫换成一只白色小狗，保持背景、光线和构图不变" \
  -F "size=1024x1024" \
  -F "quality=medium" \
  -F "image[]=@reference.png"
上传图片

图生图请使用文件上传字段 image[]。参考图片建议使用清晰的 PNG / JPG 文件，单张文件不要过大；多参考图最多按接口实际限制提交。

返回结果怎么保存
默认返回通常是 b64_json：


{
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUg..."
    }
  ]
}
如果返回 b64_json，可以用 Python 保存为图片：


import base64
import requests

BASE_URL = "https://img-api.zxcode.vip"
API_TOKEN = "sk-xxxxxx"

resp = requests.post(
    f"{BASE_URL}/v1/images/generations",
    headers={"Authorization": f"Bearer {API_TOKEN}"},
    json={
        "model": "gpt-image-2",
        "prompt": "一只橘猫坐在窗边，自然光，胶片质感",
        "n": 1,
        "size": "1024x1024",
        "quality": "medium",
    },
    timeout=300,
)
resp.raise_for_status()

image_data = resp.json()["data"][0]
if "b64_json" in image_data:
    with open("output.png", "wb") as f:
        f.write(base64.b64decode(image_data["b64_json"]))
else:
    print(image_data["url"])
批量生成
如果只是偶尔生成几张图，可以用 gpt-image-2 串行或低并发请求。需要同时生成很多张图时，使用 gpt-image-2L：


curl -X POST "$BASE_URL/v1/images/generations" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2L",
    "prompt": "一张简洁的科技产品海报，蓝白配色，干净背景",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium"
  }'
并发建议

标准模型 gpt-image-2 不建议一次发太多并发请求，容易排队等待甚至超时。批量生成请改用 gpt-image-2L，并把每张图作为一个独立请求发送。