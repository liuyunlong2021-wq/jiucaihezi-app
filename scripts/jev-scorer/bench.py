#!/usr/bin/env python3
"""
交叉编码器给 @Jev 打分：用现成的多语 reranker 给「任务 → 每个 Skill」打分，看能不能打过
本地 9b 聊天模型 71% 的基线。零训练，先量一次。

准备（一次性，全在仓库外）：
  python3.12 -m venv ~/.cache/jiucaihezi/jev-scorer/venv
  ~/.cache/jiucaihezi/jev-scorer/venv/bin/pip install sentence-transformers

跑：
  pnpm jev:eval --emit-pairs /tmp/jev-pairs.tsv
  HF_ENDPOINT=https://hf-mirror.com ~/.cache/jiucaihezi/jev-scorer/venv/bin/python \
    scripts/jev-scorer/bench.py --pairs /tmp/jev-pairs.tsv

  HF 直连在本机不通（000），必须走 hf-mirror；模型缓存在 HF_HOME 下，默认
  ~/.cache/jiucaihezi/hf，不进仓库。

阈值按 train 选、在 test 上报 —— 这是唯一诚实的做法：拿全部用例挑阈值再报同样的数字，
只是把答案背下来了。只有 13 条 test，数字会很抖，所以两边都打出来。
"""
import argparse
import collections
import os
import time

os.environ.setdefault("HF_HOME", os.path.expanduser("~/.cache/jiucaihezi/hf"))


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pairs", required=True, help="jev:eval --emit-pairs 导出的 tsv")
    parser.add_argument("--model", default="BAAI/bge-reranker-v2-m3")
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument(
        "--passage",
        choices=["description", "description+triggers"],
        default="description+triggers",
        help="拿什么当候选文本。triggers 是 Skill 作者手写的「什么时候该用我」，比散文描述更像关键词表",
    )
    return parser.parse_args()


def load_pairs(path, with_triggers):
    """→ {case_id: {split, task, skills: [(skill_id, truth, passage)]}}"""
    cases = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 6:
                continue
            case_id, split, task, skill_id, label, description = parts[:6]
            triggers = parts[6] if len(parts) > 6 else ""
            passage = description
            if with_triggers and triggers:
                passage = f"{description}\n触发词：{triggers}"
            case = cases.setdefault(case_id, {"split": split, "task": task, "skills": []})
            case["skills"].append((skill_id, int(label), passage))
    return cases


def main():
    args = parse_args()
    from sentence_transformers import CrossEncoder

    print(f"模型 {args.model}（首次会下载，缓存在 $HF_HOME）")
    model = CrossEncoder(args.model, max_length=512)
    device = getattr(model, "device", "?")
    print(f"设备 {device}")

    cases = load_pairs(args.pairs, args.passage == "description+triggers")
    pairs = []
    index = []
    for case_id, case in cases.items():
        for skill_id, _truth, passage in case["skills"]:
            pairs.append([case["task"], passage])
            index.append((case_id, skill_id))
    print(f"用例 {len(cases)} 条 ｜ 待打分 {len(pairs)} 对 ｜ 候选文本={args.passage}")

    started = time.time()
    scores = model.predict(pairs, batch_size=args.batch, show_progress_bar=False)
    elapsed = time.time() - started
    print(f"打分耗时 {elapsed:.1f}s（{len(pairs) / max(elapsed, 0.001):.0f} 对/秒）")

    by_case = collections.defaultdict(list)
    truth = {}
    for (case_id, skill_id), score in zip(index, scores):
        by_case[case_id].append((skill_id, float(score)))
        truth[(case_id, skill_id)] = next(
            t for sid, t, _ in cases[case_id]["skills"] if sid == skill_id
        )

    def predict(case_id, threshold):
        """产品语义：取最高分那个 Skill，低于阈值就不挂；正确 = 和期望完全一致。"""
        best = max(by_case[case_id], key=lambda item: item[1])
        picked = [best[0]] if best[1] >= threshold else []
        expected = sorted(sid for sid, t, _ in cases[case_id]["skills"] if t == 1)
        return picked == expected

    splits = {case_id: case["split"] for case_id, case in cases.items()}
    train_ids = [cid for cid, split in splits.items() if split == "train"]
    test_ids = [cid for cid, split in splits.items() if split == "test"]

    def accuracy(ids, threshold):
        return sum(predict(cid, threshold) for cid in ids) / len(ids) if ids else 0.0

    print("\n阈值扫描（阈值按 train 选，test 只用来看）")
    best = (0.0, -1.0)
    for step in range(1, 100):
        threshold = step / 100
        score = accuracy(train_ids, threshold)
        if score > best[0]:
            best = (score, threshold)
    train_best, threshold = best
    print(f"  train 最优阈值 {threshold:.2f} → train {train_best * 100:.0f}% ｜ test {accuracy(test_ids, threshold) * 100:.0f}%")
    print(f"  全部用例（含 train，仅参考）: {accuracy(list(cases), threshold) * 100:.0f}%")
    print(f"  对照：本地 9b 聊天模型 = 71%（全部 75 条）／规则层 = 33%")

    print(f"\n阈值 {threshold:.2f} 下的失败明细：")
    for case_id, case in cases.items():
        if predict(case_id, threshold):
            continue
        best_skill = max(by_case[case_id], key=lambda item: item[1])
        expected = ", ".join(sid for sid, t, _ in case["skills"] if t == 1) or "（空）"
        print(f"  [{case['split']}] {case_id}  「{case['task']}」")
        print(f"      期望 {expected} ｜ 最高分 {best_skill[0]} {best_skill[1]:.3f}")


if __name__ == "__main__":
    main()
