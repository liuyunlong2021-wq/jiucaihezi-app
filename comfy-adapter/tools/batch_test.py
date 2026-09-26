"""批量并发测试：一次提交 N 个异步任务，观察排队与执行耗时。

用途：
  1. 验证并发闸门真的在生效（max_concurrency=1 时任务应当串行）
  2. 测量排队等待 vs 实际执行的时间分布
  3. 摸底吞吐：连续跑 N 张图的真实速度

用法:
    python tools/batch_test.py --n 3 --steps 20
    python tools/batch_test.py --n 3 --steps 20 --prompt "不同的提示词" --edit <参考图>
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adp import harden_stdout  # noqa: E402

harden_stdout()


def call(url: str, payload=None, key: str | None = None, timeout: int = 120):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json")
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:  # noqa: BLE001
            return e.code, {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:9000")
    ap.add_argument("--key", default=None)
    ap.add_argument("--model", default="qwen-image-2.1")
    ap.add_argument("--n", type=int, default=3, help="提交几个任务")
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--size", default="1024x1024")
    ap.add_argument("--prompt", default="")
    ap.add_argument("--poll-interval", type=float, default=2.0)
    args = ap.parse_args()

    base = args.base.rstrip("/")
    prompt = args.prompt or "a cozy japanese alley at dusk, lanterns, light rain"

    # 1) 连续提交，不做任何等待
    print(f"=== 连续提交 {args.n} 个异步任务（不等待）===")
    submitted: list[tuple[str, float]] = []
    t_submit0 = time.monotonic()
    for i in range(args.n):
        code, obj = call(
            f"{base}/v1/images/generations",
            {
                "model": args.model,
                "prompt": f"{prompt} (variation {i + 1})",
                "size": args.size,
                "steps": args.steps,
                "async": True,
            },
            args.key,
        )
        if code not in (200, 202):
            print(f"  [{i + 1}] 提交失败 HTTP {code}: {obj}")
            return 1
        submitted.append((obj["id"], time.time()))
        print(f"  [{i + 1}] {obj['id']}  status={obj['status']}  (+{time.monotonic() - t_submit0:.2f}s)")

    print(f"\n提交 {args.n} 个任务共耗时 {time.monotonic() - t_submit0:.2f}s")

    # 2) 轮询直到全部终态
    print(f"\n=== 轮询（每 {args.poll_interval}s）===")
    started: dict[str, float] = {}
    done: dict[str, dict] = {}
    t0 = time.monotonic()
    while len(done) < args.n and time.monotonic() - t0 < 3600:
        for tid, created in submitted:
            if tid in done:
                continue
            code, obj = call(f"{base}/v1/tasks/{tid}", None, args.key)
            if code != 200:
                continue
            st = obj.get("status")
            if st == "running" and tid not in started:
                started[tid] = time.time()
            if st in ("succeeded", "failed", "cancelled"):
                done[tid] = obj
                print(f"  [{time.monotonic() - t0:6.1f}s] {tid} -> {st}")
        if len(done) < args.n:
            time.sleep(args.poll_interval)

    # 3) 汇总
    print("\n" + "=" * 78)
    print(f"{'任务':<26} {'排队':>8} {'执行':>8} {'总计':>8}  状态")
    print("-" * 78)
    total_wall = 0.0
    for tid, created in submitted:
        obj = done.get(tid, {})
        exec_s = obj.get("elapsed_seconds") or 0.0
        total = time.time() - created
        queue = obj.get("queued_seconds")
        if queue is None:
            queue = max(0.0, (started.get(tid, created) - created))
        total_wall = max(total_wall, total)
        print(f"{tid:<26} {queue:>7.1f}s {exec_s:>7.1f}s {total:>7.1f}s  {obj.get('status')}")

    print("-" * 78)
    execs = [done[t].get("elapsed_seconds") or 0 for t in done]
    if execs:
        print(f"执行耗时: 最快 {min(execs):.1f}s / 最慢 {max(execs):.1f}s / 平均 {sum(execs)/len(execs):.1f}s")
    print(f"整体墙钟: {total_wall:.1f}s  →  吞吐 {args.n / total_wall * 60:.2f} 张/分钟")
    print("=" * 78)

    failed = [t for t in done if done[t].get("status") != "succeeded"]
    if failed:
        print(f"⚠️ {len(failed)} 个任务未成功")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
