#!/usr/bin/env python3
"""
微调打分器：在 bge-reranker-v2-m3 上继续训练，让它学会 reranker 结构上学不到的两件事：
限定方向（「只做中译英」不能反向用）和领域词汇（面相、打神、分镜这些）。

配方里最关键的一步是**难负例挖掘**：每个用例只用基础模型打分最高的那几个错误候选当负例。
全量的 47 个候选里绝大多数是「一眼假」（「写短剧剧本」vs「视觉冲击力」），训它们没有信息量，
而 0.7~0.96 分的那种（英文剧本→中译、H3→minimax-fenjing）才是真正要纠的。负例全采会把
训练集变成 3500:57，模型学会的只会是「全都输出 0」。

诚实协议：阈值和轮数**只看 train**，test 只用来报数；每个 epoch 都打出来，选 train 最好的那轮。

跑：
  python train.py --pairs /tmp/jev-pairs.tsv --out ~/.cache/jiucaihezi/jev-scorer/model-v1
"""
import argparse
import collections
import json
import os
import random
import time

os.environ.setdefault("HF_HOME", os.path.expanduser("~/.cache/jiucaihezi/hf"))

import torch  # noqa: E402
from bench import load_pairs  # noqa: E402


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pairs", required=True)
    parser.add_argument("--base", default="BAAI/bge-reranker-v2-m3")
    parser.add_argument("--out", required=True, help="微调后模型的保存目录（放仓库外）")
    parser.add_argument("--negatives", type=int, default=4, help="每个用例采几个难负例")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--lr", type=float, default=1e-5)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--max-length", type=int, default=384)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def pick_device():
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


@torch.no_grad()
def score_all(model, tokenizer, pairs, device, max_length, batch):
    """→ 每对的概率（sigmoid）。和跑分台用同一套口径，避免训练/上线不一致。"""
    model.eval()
    out = []
    for start in range(0, len(pairs), batch):
        chunk = pairs[start : start + batch]
        encoded = tokenizer(
            [item[0] for item in chunk],
            [item[1] for item in chunk],
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        ).to(device)
        logits = model(**encoded).logits.squeeze(-1)
        out.extend(torch.sigmoid(logits).float().cpu().tolist())
    return out


def accuracy(cases, scores_by_case, threshold):
    """产品语义：取最高分那个 Skill，低于阈值就不挂；正确 = 与期望完全一致。"""
    hit = 0
    for case_id, case in cases.items():
        best_skill, best_score = max(
            ((skill_id, scores_by_case[case_id][skill_id]) for skill_id, _, _ in case["skills"]),
            key=lambda item: item[1],
        )
        picked = [best_skill] if best_score >= threshold else []
        expected = sorted(sid for sid, truth, _ in case["skills"] if truth == 1)
        hit += picked == expected
    return hit / len(cases) if cases else 0.0


def best_threshold(cases, scores_by_case):
    best = (0.0, 0.1)
    for step in range(5, 100):
        threshold = step / 100
        value = accuracy(cases, scores_by_case, threshold)
        if value > best[0]:
            best = (value, threshold)
    return best


def report(label, cases, scores_by_case, train_ids, test_ids):
    train_acc, threshold = best_threshold({cid: cases[cid] for cid in train_ids}, scores_by_case)
    test_acc = accuracy({cid: cases[cid] for cid in test_ids}, scores_by_case, threshold)
    all_acc = accuracy(cases, scores_by_case, threshold)
    print(
        f"{label}：阈值 {threshold:.2f} → train {train_acc * 100:.0f}% ｜ test {test_acc * 100:.0f}% ｜ 全部 {all_acc * 100:.0f}%"
    )
    return train_acc, threshold, all_acc


def main():
    args = parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = pick_device()
    cases = load_pairs(args.pairs, with_triggers=False)
    train_ids = [cid for cid, case in cases.items() if case["split"] == "train"]
    test_ids = [cid for cid, case in cases.items() if case["split"] == "test"]
    print(
        f"用例 {len(cases)} 条（train {len(train_ids)} / test {len(test_ids)}）"
        f" ｜ 设备 {device} ｜ 基座 {args.base}"
    )

    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForSequenceClassification.from_pretrained(args.base, num_labels=1).to(device)

    # ─── 1. 难负例挖掘：每个用例留打分最高的 N 个错误候选 ───
    flat = [(cid, skill_id, truth, passage) for cid, case in cases.items() for skill_id, truth, passage in case["skills"]]
    scores = score_all(model, tokenizer, [(cases[cid]["task"], passage) for cid, _, _, passage in flat], device, args.max_length, 32)
    scored = {}
    for (cid, skill_id, truth, _), score in zip(flat, scores):
        scored.setdefault(cid, []).append((skill_id, truth, score))

    baseline_scores = {cid: {skill_id: score for skill_id, _, score in items} for cid, items in scored.items()}
    print()
    report("零训练基线", cases, baseline_scores, train_ids, test_ids)

    train_pairs = []
    train_labels = []
    for cid in train_ids:
        items = scored[cid]
        for skill_id, truth, _ in items:
            if truth == 1:
                train_pairs.append((cases[cid]["task"], next(p for sid, _, p in cases[cid]["skills"] if sid == skill_id)))
                train_labels.append(1.0)
        negatives = sorted((item for item in items if item[1] == 0), key=lambda item: -item[2])[: args.negatives]
        for skill_id, _, _ in negatives:
            train_pairs.append((cases[cid]["task"], next(p for sid, _, p in cases[cid]["skills"] if sid == skill_id)))
            train_labels.append(0.0)
    positives = sum(train_labels)
    print(
        f"\n难负例挖掘后训练集 {len(train_pairs)} 对"
        f"（正例 {int(positives)}，负例 {len(train_pairs) - int(positives)}）"
        f" ｜ 每用例取打分最高的 {args.negatives} 个负例"
    )

    # ─── 2. 训练 ───
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)
    loss_fn = torch.nn.BCEWithLogitsLoss()
    model.train()
    order = list(range(len(train_pairs)))
    history = []
    best_state = None
    best_train = -1.0
    for epoch in range(1, args.epochs + 1):
        random.shuffle(order)
        total_loss = 0.0
        started = time.time()
        for start in range(0, len(order), args.batch):
            batch_index = order[start : start + args.batch]
            encoded = tokenizer(
                [train_pairs[i][0] for i in batch_index],
                [train_pairs[i][1] for i in batch_index],
                padding=True,
                truncation=True,
                max_length=args.max_length,
                return_tensors="pt",
            ).to(device)
            labels = torch.tensor([train_labels[i] for i in batch_index], device=device)
            loss = loss_fn(model(**encoded).logits.squeeze(-1), labels)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            # 必须 detach：float(loss) 会把计算图留活到下一次迭代，拖慢训练还吃内存。
            total_loss += loss.detach().item()
        # 一次批完所有用例再分组：逐用例调用会有 75 次批次开销，白等一分钟。
        flat_now = [(cid, skill_id) for cid, case in cases.items() for skill_id, _, _ in case["skills"]]
        flat_pairs = [
            (cases[cid]["task"], next(p for sid, _, p in cases[cid]["skills"] if sid == skill_id))
            for cid, skill_id in flat_now
        ]
        flat_scores = score_all(model, tokenizer, flat_pairs, device, args.max_length, 64)
        scores_by_case = collections.defaultdict(dict)
        for (cid, skill_id), value in zip(flat_now, flat_scores):
            scores_by_case[cid][skill_id] = value
        print(f"\nepoch {epoch}：平均 loss {total_loss / max(len(order) // args.batch, 1):.4f} ｜ {time.time() - started:.0f}s")
        train_acc, threshold, all_acc = report(f"  epoch {epoch}", cases, scores_by_case, train_ids, test_ids)
        history.append({"epoch": epoch, "train": train_acc, "threshold": threshold, "all": all_acc})
        # 选轮数只看 train（不看 test），并把那一轮的权重留一份 —— 否则写着「选定 epoch N」
        # 存的却是最后一轮的权重，两回事。
        if train_acc > best_train:
            best_train = train_acc
            best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
        model.train()

    # ─── 3. 按 train 选轮数（不看 test），保存那一轮的权重 ───
    best_entry = max(history, key=lambda item: item["train"])
    print(f"\n按 train 选定 epoch {best_entry['epoch']}（train {best_entry['train'] * 100:.0f}%，阈值 {best_entry['threshold']:.2f}），保存到 {args.out}")
    if best_state is not None:
        model.load_state_dict(best_state)
    os.makedirs(args.out, exist_ok=True)
    model.save_pretrained(args.out)
    tokenizer.save_pretrained(args.out)
    with open(os.path.join(args.out, "training.json"), "w", encoding="utf-8") as handle:
        json.dump(
            {
                "base": args.base,
                "pairs": args.pairs,
                "negatives": args.negatives,
                "epochs": args.epochs,
                "lr": args.lr,
                "seed": args.seed,
                "bestEpoch": best_entry["epoch"],
                "history": history,
            },
            handle,
            ensure_ascii=False,
            indent=2,
        )


if __name__ == "__main__":
    main()
