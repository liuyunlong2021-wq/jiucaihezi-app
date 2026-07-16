#!/usr/bin/env python3
"""短故事字数统计与节奏检查器。

用法：python validate_short_story.py <故事md文件>
检查项：总字数、开篇钩子字数、人称一致性、伏笔标记统计。
"""

import re
import sys
from pathlib import Path


def count_chinese_chars(text: str) -> int:
    """统计中文字符数（不含标点空格）。"""
    return len(re.findall(r'[\u4e00-\u9fff]', text))


def check_first_person(text: str) -> list[str]:
    """检查第一人称一致性。"""
    warnings = []
    # 统计"我"的出现频率和潜在上帝视角标记
    wo_count = len(re.findall(r'我', text))
    ta_count = len(re.findall(r'[他她]觉得|[他她]想|[他她]心里|[他她]暗自', text))
    
    if ta_count > 0:
        warnings.append(f"⚠️ 发现 {ta_count} 处可能的上帝视角（'他觉得/她想/心里/暗自'等）")
    
    if wo_count < 50:
        warnings.append(f"⚠️ '我'字出现次数过少（{wo_count}），可能第一人称体感不足")
    
    return warnings


def check_hooks(text: str) -> list[str]:
    """检查钩子密度。"""
    warnings = []
    total_chars = count_chinese_chars(text)
    # 粗略估算：每2000字应该有一个转折点
    expected_hooks = max(1, total_chars // 2000)
    
    # 寻找常见的钩子标记词
    hook_markers = re.findall(
        r'(突然|忽然|就在这时|没想到|后来我才|直到|但是|然而|不对|等等|等一下|不对劲)',
        text
    )
    
    if len(hook_markers) < expected_hooks:
        warnings.append(
            f"📎 钩子密度：发现 {len(hook_markers)} 个转折标记词，"
            f"按字数预计应有约 {expected_hooks} 个（每2000字一个）"
        )
    
    return warnings


def check_opening(text: str) -> list[str]:
    """检查开篇。"""
    warnings = []
    # 取前500字（中文字符）
    chars = list(re.findall(r'[\u4e00-\u9fff]', text))
    opening_chars = chars[:500]
    
    if len(opening_chars) < 500:
        warnings.append("⚠️ 开篇不足500中文字符，钩子可能不够充分")
    
    return warnings


def main():
    if len(sys.argv) < 2:
        print("用法：python validate_short_story.py <故事md文件>")
        sys.exit(1)
    
    filepath = Path(sys.argv[1])
    if not filepath.exists():
        print(f"❌ 文件不存在：{filepath}")
        sys.exit(1)
    
    text = filepath.read_text(encoding='utf-8')
    
    # 去掉frontmatter
    if text.startswith('---'):
        parts = text.split('---', 2)
        if len(parts) >= 3:
            text = parts[2]
    
    total_chars = count_chinese_chars(text)
    
    print(f"📖 短故事校验报告：{filepath.name}")
    print(f"{'='*50}")
    print(f"📊 总中文字数：{total_chars}")
    
    if total_chars < 6000:
        print(f"⚠️ 字数不足（<6000），短故事建议至少6000字")
    elif total_chars > 80000:
        print(f"⚠️ 字数过多（>80000），已超出短故事范围，考虑长篇")
    elif 10000 <= total_chars <= 30000:
        print(f"✅ 字数在最佳范围（10000-30000）")
    else:
        print(f"📎 字数在短故事范围内但非最佳（最佳10000-30000）")
    
    print(f"\n📝 人称检查：")
    for w in check_first_person(text):
        print(f"  {w}")
    
    print(f"\n🪝 钩子密度：")
    for w in check_hooks(text):
        print(f"  {w}")
    
    print(f"\n🚪 开篇检查：")
    for w in check_opening(text):
        print(f"  {w}")
    
    print(f"\n{'='*50}")
    print("✅ 检查完成")


if __name__ == '__main__':
    main()
