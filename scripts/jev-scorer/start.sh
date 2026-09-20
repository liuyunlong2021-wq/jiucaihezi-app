#!/bin/sh
# 起本地 Skill 打分服务 —— @Jev 决策链的第一层（语义挑 Skill，0.9 秒/条）。
#
# 模型和 venv 都在仓库外（torch + 2.3GB 权重，不进 git）：
#   $JEV_SCORER_HOME（默认 ~/.cache/jiucaihezi/jev-scorer）
#     ├── venv/          python3.12 + sentence-transformers
#     ├── model-v1/      微调后的交叉编码器（training.json 里带阈值）
#     └── hf/            HF 缓存（HF_HOME）
# 起法：pnpm jev:scorer，或 sh scripts/jev-scorer/start.sh
#
# 这个服务不在跑也不会坏事：@Jev 会自动降级到规则层 + 模型层，只是准确率从 95% 掉回 71%。
set -e

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT="${JEV_SCORER_HOME:-$HOME/.cache/jiucaihezi/jev-scorer}"
PY="${JEV_SCORER_PYTHON:-$ROOT/venv/bin/python}"
MODEL="${JEV_SCORER_MODEL:-$ROOT/model-v1}"
PORT="${JEV_SCORER_PORT:-4789}"

[ -x "$PY" ] || {
  echo "找不到打分器 python 环境：$PY"
  echo "重建：见 scripts/jev-scorer/README.md"
  exit 1
}
[ -d "$MODEL" ] || {
  echo "找不到微调模型：$MODEL"
  echo "重建：python scripts/jev-scorer/train.py（见 README.md）"
  exit 1
}

# 已经在跑就直接复用，别占第二个端口。
if curl -s --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "打分器已在 $PORT 上跑着，直接用"
  exit 0
fi

export HF_HOME="${HF_HOME:-$ROOT/hf}"
exec "$PY" "$HERE/serve.py" --model "$MODEL" --port "$PORT"
