# 山海画布适配器

把 NewAPI 的 OpenAI 兼容 `/v1/videos` 请求翻译成山海画布（Open Canvas，`https://shanhai.vnshu.cn/api/v1`）
的任务接口，并用渠道 Key 代理成片下载。

当前只服务两条按次计费的 Seedance 2.5 线路：`shanhai-dola-seedance-v2-5-30-9-0-7`（面板 `1/次`）
和 `oc-model-r5cfh8`（面板 `2元/次`）。

```text
创作面板 → NewAPI（鉴权/计费）→ shanhai-adapter → POST /generations
                                                → GET  /tasks/{id}
                                                → GET  /media/runs/{id}（成片，需同一枚 Key）
```

## 为什么需要它

山海不是 OpenAI 兼容上游：它只有 `POST /generations`（`media_type` + `inputs[]` + `options`）、
`GET /tasks/{id}` 轮询，而且成片地址 `output.url` **必须带同一枚 Bearer API Key** 才能下载。
仓库其余渠道（kik / boluo / dola / xiaoyi）都是这个形状，因此山海也单独一个最小翻译层。

## 端点

| 本服务 | 山海 | 说明 |
| --- | --- | --- |
| `POST /v1/videos` | `POST /generations` | 统一发 `media_type: video` |
| `GET /v1/videos/{task_id}` | `GET /tasks/{task_id}` | 状态归一化成 `processing` / `completed` / `failed` |
| `GET /v1/videos/{task_id}/content` | `GET /media/runs/{task_id}` | 带渠道 Key 流式代理，透传 `Range` 支持播放与断点续传 |
| `GET /v1/models` | `GET /models` | 透传上游目录，用来核对渠道 Key 和真实能力 |
| `GET /health` | - | 存活与模型清单 |

任务完成时返回相对路径 `/v1/videos/{task_id}/content`，客户端拼上 NewAPI 域名后由 NewAPI 转发回本服务，
渠道 Key 不会下发到客户端。

## 字段契约

- `model` 收两种写法：NewAPI 渠道的公开名（`山seedance2.5` / `海seedance2.5`）或山海的上游 id
  （`shanhai-dola-seedance-v2-5-30-9-0-7` / `oc-model-r5cfh8`）。渠道开了模型映射时收到的是上游 id；
  映射未生效时适配器自己把公开名换成上游 id，所以两种都能跑。其它一律 400。
- `prompt` 必填，最长 20000 字符。
- 参考图接受 `images` / `image` / `imageUrl` / `imageUrls`，每项可以是字符串或 `{url}`；
  必须是 `http(s)` 公开直链（山海自己去抓），最多 10 张 —— 面板侧按文档表更严（两条线路分别 9 / 10 张）。
- `aspect_ratio` / `ratio` / `aspectRatio` 任一即可，`auto` / `adaptive` / `empty` 不下发。
- `resolution` 原样透传（当前两条都是 `720p`）。
- `duration`（或同义的 `seconds`）归一成字符串上报。
- 参考音频还没接：山海要先 `POST /uploads/audio` 换公开地址，请求里带音频一律 422，不静默丢弃。

**已知上限**：参考素材经网关 `/api/creations/uploads` 换成 Worker KV 里的临时地址，`expirationTtl = 15 分钟`，
之后由山海自己去取。排队超过 15 分钟的任务可能取不到素材（boluo 适配器同一约束）。

## 轮询语义（2026-09-15 实测踩过的坑）

山海的 `GET /tasks/{id}` **会长时间不响应**（首次真机任务：容器内 30 秒无响应，nginx 之后一直挂住）。
适配器因此做了三件事：

- 状态查询用 20 秒超时 + 1 次重试，不让调用方干等；
- 超时 / 网络错误 / 上游 5xx 一律回 `200 {status: "processing"}`，**不回 5xx** —— NewAPI 的轮询器把
  「无法识别的响应」直接判成任务失败，一次上游抖动就能终结一个还在生成的任务（当天真实发生过：提交
  成功、只轮询一次就被判失败）；
- 只有上游 4xx（id 不对、Key 失效）才抛出去，那是确定的负面结论。

代价：上游状态接口如果一直挂着，任务会一直显示「处理中」，直到客户端 30 分钟窗口到期；真实原因每次
都会写进适配器日志（`Shanhai poll failed task=... exception=ReadTimeout`）。

提交（`POST /v1/videos`）仍保持 120 秒超时并如实报错：提交超时等于「不知道任务有没有创建」，
不能假装成功。

## 测试

```bash
../rh-adapter/.venv/bin/python -m unittest discover -s tests -v
```

## 部署

服务器目录 `/opt/shanhai-adapter`。compose 不映射宿主端口，`8795` 只在 docker 网络内可达：

```bash
set -euo pipefail

cd /opt/jiucai-repo
git status --short                  # 必须无输出；有本地改动先弄清楚再继续
git fetch origin main --depth=1
git reset --hard origin/main        # 不能用 --ff-only：浅仓库会误报 diverged
git sparse-checkout add shanhai-adapter
git log -1 --oneline

mkdir -p /opt/shanhai-adapter
rsync -a --delete \
  /opt/jiucai-repo/shanhai-adapter/ \
  /opt/shanhai-adapter/             # --delete 会覆盖服务器上的 compose，先 diff 再决定

cd /opt/shanhai-adapter
docker compose config >/dev/null && echo "compose 合法"
docker compose up -d --force-recreate --build
docker compose ps
docker compose logs --tail=50
```

服务器是 `--depth=1` 浅仓库 + 稀疏检出，`git pull --ff-only` 会报 `diverged` 并被拒绝 —— 那是浅仓库的
假象，不是真分叉。容器必须加入与 NewAPI 相同的 Docker 网络 `new-api-new_new-api-network`。

重建会清空进程内的建单 Key 表（TTL 6 小时），重启前创建、还没下载完的任务需要重新提交。

## NewAPI 渠道

| 字段 | 值 |
| --- | --- |
| 类型 | OpenAI 兼容 |
| Base URL | `http://shanhai-adapter:8795` |
| 密钥 | 山海画布 API Key（`oc_live_...`，在账户中心「API 接入」创建） |
| 模型 | 下面 2 个渠道公开名，逗号分隔 |

```text
山seedance2.5,海seedance2.5
```

模型映射（把公开名换成上游 id，面板只发公开名）：

| 原始模型 | 替换模型 |
| --- | --- |
| `山seedance2.5` | `shanhai-dola-seedance-v2-5-30-9-0-7` |
| `海seedance2.5` | `oc-model-r5cfh8` |

渠道公开名必须与创作面板注册的 `model` 逐字一致（面板发的就是它）；可用性服务（`scripts/creation-models/server.mjs`）
也是拿渠道里的公开名去匹配，对不上面板就会显示“未配置该模型渠道”。面板定价是人民币实付价
（`1/次` 与 `2元/次`），NewAPI 渠道倍率要调到与之一致，否则面板显示与实扣不符。

**SSRF 白名单必须先配，否则任务成功也拿不到成片**：面板拉成片时是 NewAPI 主动访问本服务的
`/content`，它会校验 `fetch_setting.allowed_ports`。生产现值如果不含 `8795`，下载会被拦成
`request blocked: port 8795 is not allowed`：

```bash
docker exec postgres psql -U newapi -d new-api -c \
"UPDATE options SET value='[\"80\",\"443\",\"8080\",\"8443\",\"8794\",\"8795\"]' WHERE key='fetch_setting.allowed_ports';"

docker exec postgres psql -U newapi -d new-api -Atc \
"SELECT key,value FROM options WHERE key='fetch_setting.allowed_ports';"

cd /root/new-api-new && docker compose restart new-api
```

必须保持**字符串数组**格式，数字数组当前后端读不出来（会静默回退默认端口）。不要从后台 SSRF 页面
重新保存允许端口（可能写回数字数组）。完整排障见
`docs/wiki/运维/NewAPI视频下载SSRF端口配置失效排障-2026-09-09.md`。

## 验证

```bash
# 容器内自检（镜像没有 curl，8795 也没映射到宿主，只能用 python 在容器里查）
docker compose exec -T shanhai-adapter \
  python -c "import json,urllib.request;print(json.load(urllib.request.urlopen('http://127.0.0.1:8795/health')))"

# 用真实渠道 Key 核对上游目录（不花额度；Key 走 stdin，不进环境变量、不落 shell 历史）
read -rsp '山海 API Key (oc_live_...): ' SHANHAI_KEY && echo
printf '%s' "$SHANHAI_KEY" | docker compose exec -T shanhai-adapter python3 -c "
import json, sys, urllib.request
key = sys.stdin.readline().strip()
req = urllib.request.Request('http://127.0.0.1:8795/v1/models',
                             headers={'Authorization': 'Bearer ' + key})
data = json.load(urllib.request.urlopen(req, timeout=30))
for item in data['data']:
    if item['id'] in ('shanhai-dola-seedance-v2-5-30-9-0-7', 'oc-model-r5cfh8'):
        print(item['id'], item.get('type'), json.dumps(item.get('capabilities'), ensure_ascii=False))
"
unset SHANHAI_KEY
```

（`docker compose exec -e 变量名` 不会透传宿主环境，只认 `变量名=值`，所以这里不用 `-e`。）

能打出两条模型，说明渠道 Key 有效、适配器到山海的链路通；`capabilities` 里是该模型真实的分辨率、
比例、时长和参考图上限，与面板登记值对不上时以它为准。

面板侧可用性（`creation-models` 每次请求实时查库，加完渠道不用重启它）：

```bash
curl -s https://api.jiucaihezi.studio/api/creation/models | python3 -c "
import sys, json
models = json.load(sys.stdin)['data']['models']
print([m for m in models if 'shanhai' in m['id'] or 'oc-model' in m['id']])
"
# 仍为空时对一下渠道里实际存的名字：
docker exec -i $(docker ps -q -f name=postgres) \
  psql -U newapi -d new-api -t -c "SELECT id, status, models FROM channels ORDER BY id DESC LIMIT 5;"
```
