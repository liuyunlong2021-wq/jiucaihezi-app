#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剧本格式校验器 — 独立脚本
用于 manhua-script-agent Skill 的 scripts/ 目录。
LLM 生成剧本后可调用此脚本校验格式和内容质量。

用法:
  python validate_scene.py <场景文本文件>
  python validate_scene.py --stdin          # 从标准输入读取
  python validate_scene.py --type scene_one <文件>  # 第1场（更宽的字数要求）
  python validate_scene.py --type loop <文件>       # 续写场次

输出:
  JSON: {"ok": bool, "issues": [...], "warnings": [...]}
  退出码: 0=通过, 1=有问题
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


# ─────────────────────────────────────────────
# 不可拍表达（心理活动 → 必须转化为台词/动作/表情）
# ─────────────────────────────────────────────
NON_VISUAL_PATTERNS = [
    r"发现自己",
    r"意识到",
    r"心想",
    r"觉得",
    r"明白了",
    r"知道这",
    r"想起",
    r"穿成了",
    r"穿书了",
    r"决定(?!战)",  # "决定"但不是"决定战"
    r"内心",
    r"脑海中",
]

REQUIRED_SCENE_FIELDS = ["时间：", "场景：", "人物："]

# 禁止出现的说明性标注（必须通过画面/动作/对话体现）
FORBIDDEN_ANNOTATIONS = [
    r"【催化剂：.+?】",
    r"【开场冲突：.+?】",
    r"【悬念：.+?】",
    r"【设定：.+?】",
    r"【伏笔：.+?】",
    r"【冲突层：.+?】",
]


def validate_scene(scene_text: str, min_chars: int, max_chars: int, label: str) -> dict:
    """
    通用场景校验逻辑。
    返回 {"ok": bool, "issues": [str], "warnings": [str]}
    """
    issues: list[str] = []
    warnings: list[str] = []

    if not scene_text.strip():
        return {"ok": False, "issues": ["场景内容为空"], "warnings": []}

    # 1. 场次标题
    if not re.search(r"^## 场\d+-\d+", scene_text, re.MULTILINE):
        issues.append("缺少场次标题（格式：## 场X-Y）")

    # 2. 必要字段
    for field in REQUIRED_SCENE_FIELDS:
        if field not in scene_text:
            issues.append(f"缺少字段：{field}")

    # 3. 禁止说明性标注
    for pattern in FORBIDDEN_ANNOTATIONS:
        match = re.search(pattern, scene_text)
        if match:
            issues.append(
                f"含说明性标注：「{match.group(0)}」→ 必须通过画面/动作/对话体现，不用方括号标注"
            )

    # 4. 字数（估算中文字符数）
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", scene_text))
    if chinese_chars < min_chars:
        issues.append(
            f"字数过少：估算 {chinese_chars} 汉字（{label}要求 {min_chars}-{max_chars}）"
        )
    elif chinese_chars > max_chars + 100:
        warnings.append(
            f"字数偏多：估算 {chinese_chars} 汉字（{label}建议不超过 {max_chars}）"
        )

    # 5. △ 动作描述
    if "△" not in scene_text:
        issues.append("缺少 △ 动作描述符")

    # 6. 不可拍表达（降级为警告，不阻断生成流程，仅提示优化）
    for pattern in NON_VISUAL_PATTERNS:
        match = re.search(pattern, scene_text)
        if match:
            warnings.append(
                f"建议优化：「{match.group(0)}」可通过镜头/动作代替心理描写"
            )

    # 7. 字数行
    if "字数：" not in scene_text:
        warnings.append("建议添加字数统计行（字数：约XXX字）")

    # 8. 对话格式检查：角色名不应加粗
    if "**" in scene_text:
        warnings.append("角色名不应加粗（**），使用：角色名（情绪）：\"台词\"")

    # 9. 对话格式存在性检查：检测是否有 角色名（情绪）： 格式
    dialogue_pattern = re.compile(r"^[^\s△▲#].+?（.+?）：", re.MULTILINE)
    if not dialogue_pattern.search(scene_text):
        warnings.append("未检测到对话格式「角色名（情绪）：\"台词\"」")

    # 10. OS/VO 不得出现在动作描述行（△ 行）
    os_vo_in_action = re.findall(r"^△.*?(?:OS|VO)[）\)]", scene_text, re.MULTILINE)
    if os_vo_in_action:
        for line in os_vo_in_action:
            warnings.append(
                f"OS/VO 出现在动作描述中：\"{line.strip()[:50]}...\" → 必须用对话格式：角色名（OS）：\"内容\""
            )

    # 11. 预期反转检查（启发式：寻找转折词）
    turn_signals = ["却", "但", "然而", "突然", "不料", "谁知", "竟", "居然"]
    has_turn = any(s in scene_text for s in turn_signals)
    if not has_turn:
        warnings.append("未检测到明显转折信号，建议加入预期反转")

    return {
        "ok": len(issues) == 0,
        "issues": issues,
        "warnings": warnings,
    }


def validate_scene_one(scene_text: str) -> dict:
    """验证第1场正文（字数 200-500，开局需要更大空间）"""
    return validate_scene(scene_text, min_chars=200, max_chars=500, label="第1场")


def validate_scene_loop(scene_text: str) -> dict:
    """验证续写场景正文（字数 120-350）"""
    return validate_scene(scene_text, min_chars=120, max_chars=350, label="续写场次")


# ─────────────────────────────────────────────
# CLI 入口
# ─────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="剧本格式校验器 — 检查场景文本的格式和内容质量"
    )
    parser.add_argument(
        "file", nargs="?", help="场景文本文件路径"
    )
    parser.add_argument(
        "--stdin", action="store_true", help="从标准输入读取场景文本"
    )
    parser.add_argument(
        "--type", choices=["scene_one", "loop"], default="loop",
        help="场景类型: scene_one=第1场, loop=续写场次 (默认: loop)"
    )
    parser.add_argument(
        "--quiet", action="store_true", help="仅输出 JSON，不打印人类可读摘要"
    )

    args = parser.parse_args()

    # 读取输入
    if args.stdin:
        scene_text = sys.stdin.read()
    elif args.file:
        scene_text = Path(args.file).read_text(encoding="utf-8")
    else:
        parser.print_help()
        sys.exit(2)

    # 执行校验
    if args.type == "scene_one":
        result = validate_scene_one(scene_text)
    else:
        result = validate_scene_loop(scene_text)

    # 输出
    if not args.quiet:
        if result["ok"]:
            print("✅ 校验通过")
        else:
            print(f"❌ 发现 {len(result['issues'])} 个问题：")
            for issue in result["issues"]:
                print(f"  • {issue}")

        if result["warnings"]:
            print(f"\n⚠️  {len(result['warnings'])} 个建议：")
            for warning in result["warnings"]:
                print(f"  • {warning}")

        print()

    print(json.dumps(result, ensure_ascii=False, indent=2))

    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
