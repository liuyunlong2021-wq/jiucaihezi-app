#!/usr/bin/env python3
"""
本地打分服务：给「一句任务 + 一批候选 Skill」返回每个候选的分数，app 侧一个 HTTP 调用。

为什么要有服务而不是在 Node 里跑模型：推理得用 torch + 568M 权重，塞进 Tauri 前端不现实；
一个常驻的本地进程能把模型留在显存里，一次判断 ~0.6 秒，而且不联网不花钱。

  python serve.py --model ~/.cache/jiucaihezi/jev-scorer/model-v1 --port 4789
  curl -s localhost:4789/score -H 'content-type: application/json' \
    -d '{"task":"帮我写一段巷战的打戏","candidates":[{"id":"jc-daxi","text":"打戏提示词"},{"id":"jc-novel","text":"长篇小说"}]}'

只用标准库的 http.server：单线程排队正合适（app 一次只发一个请求），少一个 web 框架依赖。
阈值默认读模型目录里的 training.json（训练时按 train 选的），没读到用 0.12。
"""
import argparse
import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ.setdefault("HF_HOME", os.path.expanduser("~/.cache/jiucaihezi/hf"))

import torch  # noqa: E402
from transformers import AutoModelForSequenceClassification, AutoTokenizer  # noqa: E402

STATE = {"model": None, "tokenizer": None, "device": None, "threshold": 0.12, "model_path": ""}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="微调后的模型目录，或 HF 上的基座名")
    parser.add_argument("--port", type=int, default=4789)
    parser.add_argument("--threshold", type=float, default=0.0)
    parser.add_argument("--max-length", type=int, default=384)
    parser.add_argument("--batch", type=int, default=32)
    return parser.parse_args()


def load(args):
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    STATE["device"] = device
    STATE["model_path"] = args.model
    STATE["tokenizer"] = AutoTokenizer.from_pretrained(args.model)
    STATE["model"] = AutoModelForSequenceClassification.from_pretrained(args.model, num_labels=1).to(device).eval()
    threshold = args.threshold
    if not threshold:
        # 训练元数据是「顺带记的」：文件不存在、被截断、字段缺失都不能让服务起不来。
        try:
            meta = os.path.join(args.model, "training.json")
            if os.path.exists(meta):
                with open(meta, encoding="utf-8") as handle:
                    payload = json.load(handle)
                history = payload.get("history") or []
                if history:
                    best = max(history, key=lambda item: item.get("train", 0))
                    threshold = float(best.get("threshold", 0.12))
        except (OSError, ValueError, TypeError):
            threshold = 0.0
    STATE["threshold"] = threshold or 0.12
    print(f"模型 {args.model} ｜ 设备 {device} ｜ 阈值 {STATE['threshold']:.2f}")


@torch.no_grad()
def score(task, candidates, max_length, batch):
    tokenizer, model, device = STATE["tokenizer"], STATE["model"], STATE["device"]
    scores = []
    for start in range(0, len(candidates), batch):
        chunk = candidates[start : start + batch]
        encoded = tokenizer(
            [task] * len(chunk),
            [item.get("text", "") for item in chunk],
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        ).to(device)
        scores.extend(torch.sigmoid(model(**encoded).logits.squeeze(-1)).float().cpu().tolist())
    return scores


class Handler(BaseHTTPRequestHandler):
    max_length = 384
    batch = 32

    def log_message(self, fmt, *fargs):  # 别把每个请求都打到 stderr
        pass

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(
                {
                    "ok": True,
                    "model": STATE["model_path"],
                    "device": str(STATE["device"]),
                    "threshold": STATE["threshold"],
                }
            )
        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/score":
            self.send_json({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("content-length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
            task = str(payload.get("task") or "").strip()
            candidates = payload.get("candidates") or []
            if not task or not isinstance(candidates, list):
                self.send_json({"error": "需要 task 和 candidates"}, 400)
                return
            started = time.time()
            scores = score(task, candidates, self.max_length, self.batch)
            ranked = sorted(
                ({"id": item.get("id"), "score": round(value, 4)} for item, value in zip(candidates, scores)),
                key=lambda item: -item["score"],
            )
            best = ranked[0] if ranked else None
            self.send_json(
                {
                    "threshold": STATE["threshold"],
                    # picked 是产品语义：过了阈值才有 Skill，否则什么都不挂（等于手动模式）
                    "picked": best["id"] if best and best["score"] >= STATE["threshold"] else None,
                    "ranked": ranked,
                    "elapsedMs": round((time.time() - started) * 1000),
                }
            )
        except Exception as cause:  # 服务崩了比返错更难查
            self.send_json({"error": f"{type(cause).__name__}: {cause}"}, 500)


def main():
    args = parse_args()
    Handler.max_length = args.max_length
    Handler.batch = args.batch
    load(args)
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(f"监听 http://127.0.0.1:{args.port}（POST /score，GET /health）")
    server.serve_forever()


if __name__ == "__main__":
    main()
