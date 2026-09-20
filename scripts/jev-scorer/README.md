# 本地 Skill 打分器（@Jev 决策链第一层）

给「任务 + 47 个 Skill 的描述」打相关性分，挑出该挂的那一个。
交叉编码器微调版：**75 条中文用例 93%**（留出集 85%），0.9 秒/条，本地跑、不联网、不花钱。
零训练基线（现成 reranker）是 76%，规则层 35%，本地 9b 聊天模型 71%。

接进产品链路后是 **95%**（留出集 13/13）——芯片（@文件/@图文/@影音）由规则层补上。

## 起服务

```sh
pnpm jev:scorer
```

已经在跑就直接复用，不占第二个端口。服务不在跑不会坏事：@Jev 自动降级到
规则层 + 模型层，只是准确率掉回 71% 左右（控制台会留一条 `[jev] 本地打分器不可用`）。

## 环境（仓库外，因为 torch + 权重有 2.3GB）

```
~/.cache/jiucaihezi/jev-scorer/
├── venv/       python3.12 + sentence-transformers（torch 2.14，MPS 加速）
├── model-v1/   微调后的交叉编码器 + tokenizer + training.json（阈值在里面）
└── hf/         HF 模型缓存（HF_HOME）
```

一键重装：

```sh
python3.12 -m venv ~/.cache/jiucaihezi/jev-scorer/venv
~/.cache/jiucaihezi/jev-scorer/venv/bin/pip install sentence-transformers
```

**HF 必须走镜像**：`export HF_ENDPOINT=https://hf-mirror.com`（本机直连返回 000）。

## 三个脚本

| 脚本 | 干什么 |
| --- | --- |
| `serve.py` | 常驻 HTTP 服务。`/score` 打分、`/health` 探活。阈值默认读 `training.json`。 |
| `bench.py` | 扫阈值、报 train/test。改完训练先跑这个，别拿训练集分自己骗自己。 |
| `train.py` | 微调。`--negatives 4` 挖难负例（话题沾边但任务不对的那种）。 |

```sh
V=~/.cache/jiucaihezi/jev-scorer/venv/bin/python
$V scripts/jev-scorer/bench.py --model ~/.cache/jiucaihezi/jev-scorer/model-v1 --passage description
$V scripts/jev-scorer/train.py --epochs 4 --negatives 4
```

训练数据由基准导出，不用手写：

```sh
pnpm jev:eval --provider rule --emit-pairs /tmp/pairs.json
```

## 量产品链路（不是量模型）

```sh
pnpm jev:eval --provider scorer    # 打分器 + 规则层 = 产品链路前两层
pnpm jev:eval --provider rule      # 规则层单独（35%）
pnpm jev:eval --provider llm       # 模型层单独，需要能调模型
```

用例在 `scripts/jev-eval/cases.json`。改 Skill 的 triggers/description 之后要重跑，
候选描述就是模型的输入。

## 已知不足

- 剩下 4 条错（75 条里）全是语义判断错：反向操作（「翻译成中文」选只做中译英的
  `jc-juben-yingyi`）、近似同类（Apple 风产品广告 → 3D 动画短片）、两条漏选。
  **下一轮的解法是加数据，不是加 epoch。**
- 模型选 epoch 是**按训练集**选的（epoch 3 训练最好但留出集掉到 85%，epoch 2 是 92%）。
  协议本身有偏，数据量上来才谈得上有意义的早停。
- 这门手艺现在只在这台机器上跑得起来（venv + 2.3GB 权重在 `~/.cache`）。
  要随应用分发得先量化成 ONNX（约 100MB）——那是另一件事。
