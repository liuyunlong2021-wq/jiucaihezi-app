#!/usr/bin/env python3
"""
高光动画渲染器——把单条高光渲染成绿幕卡片短片，供 chromakey 叠加到主视频。

动画引擎：Animate.css (80k+ stars, MIT license) — CDN 引入，60+ 种 CSS 动画
排版语言：5 套电子杂志主题 + 4 套瑞士风主题。

用法：
    python3 render_highlight.py <text> <duration> <type> <output.mp4> <workdir> [theme_name] [position] [font_size] [packaging_kind]
"""
import re
import sys, subprocess, os

from highlight_rules import CHARS_PER_LINE, MAX_DISPLAY_CHARS

# 主题源自 op7418/guizang-ppt-skill 的 themes.md 与 themes-swiss.md。
MAGAZINE_THEMES = {
    'classic': {
        'bg_dark': '#18181a',
        'text_light': '#f1efea',
        'accent': '#0a0a0b',
    },
    'indigo': {
        'bg_dark': '#0a1f3d',
        'text_light': '#f1f3f5',
        'accent': '#4a90d9',
    },
    'forest': {
        'bg_dark': '#1a2e1f',
        'text_light': '#f5f1e8',
        'accent': '#5c8062',
    },
    'kraft': {
        'bg_dark': '#2a1e13',
        'text_light': '#eedfc7',
        'accent': '#8c6d53',
    },
    'dune': {
        'bg_dark': '#1f1a14',
        'text_light': '#f0e6d2',
        'accent': '#a68c70',
    },
}

SWISS_THEMES = {
    'klein': {
        'bg_dark': '#0a0a0a',
        'text_light': '#fafaf8',
        'accent': '#002FA7',
    },
    'lemon': {
        'bg_dark': '#0a0a0a',
        'text_light': '#fafaf8',
        'accent': '#FFD500',
    },
    'green': {
        'bg_dark': '#0a0a0a',
        'text_light': '#fafaf8',
        'accent': '#C5E803',
    },
    'orange': {
        'bg_dark': '#0a0a0a',
        'text_light': '#fafaf8',
        'accent': '#FF6B35',
    },
}

ALL_THEMES = {**MAGAZINE_THEMES, **SWISS_THEMES}
DEFAULT_THEME = 'indigo'
KEY_COLOR = '#00FF00'  # chromakey 绿幕

TYPE_STYLE = {
    'open':   {'size': 96,  'weight': 800, 'accent_bar': True},
    'hook':   {'size': 80,  'weight': 700, 'accent_bar': True},
    'ending': {'size': 90,  'weight': 800, 'accent_bar': True},
    'middle': {'size': 64,  'weight': 600, 'accent_bar': False},
}

# Animate.css 动画预设 → 按高光类型自动匹配
ANIMATION_MAP = {
    'open':   'animate__bounceInDown',   # 炸裂开场：弹入
    'hook':   'animate__fadeInDown',     # 钩子：上方淡入
    'ending': 'animate__backInUp',       # 结尾：弹性滑入
    'middle': 'animate__fadeInLeft',     # 中段：左侧淡入
}


def format_headline(text, base_size):
    """Fit a compact headline into at most two lines without obstructing the speaker."""
    compact = ''.join(text.split())
    if not compact:
        return '', base_size

    compact = compact[:MAX_DISPLAY_CHARS]
    line_count = (len(compact) + CHARS_PER_LINE - 1) // CHARS_PER_LINE
    font_size = base_size if line_count == 1 else max(60, round(base_size * 0.78))
    if line_count == 2:
        midpoint = len(compact) / 2
        candidates = set()
        for marker in ('不是', '是', '因为', '所以', '但是', '其实', '哪个', '为什么', '怎么'):
            start = compact.find(marker)
            if start > 0:
                candidates.add(start)
        for index, character in enumerate(compact):
            if character in '，。！？、；：':
                candidates.add(index + 1)
        candidates = [cut for cut in candidates if 3 <= cut <= len(compact) - 3]
        cut = min(candidates, key=lambda value: abs(value - midpoint)) if candidates else round(midpoint)
        lines = [compact[:cut], compact[cut:]]
    else:
        lines = [
            compact[i:i + CHARS_PER_LINE]
            for i in range(0, len(compact), CHARS_PER_LINE)
        ]
    if len(lines) > 2:
        lines = lines[:2]
        lines[-1] = lines[-1][:-1] + '…'
    return '<br>'.join(lines), font_size


def packaging_html(kinds, text):
    elements = []
    number = re.search(r'\d+(?:\.\d+)?%?', text)
    for index, kind in enumerate(kinds[:2]):
        secondary = ' secondary' if index else ''
        if kind == 'question_sticker':
            elements.append(f'<div class="sticker question{secondary} animate__animated animate__fadeIn">?</div>')
        elif kind == 'data_badge':
            label = number.group() if number else '重点'
            elements.append(f'<div class="sticker data{secondary} animate__animated animate__fadeIn">{label}</div>')
        elif kind == 'contrast_arrow':
            elements.append(f'<div class="sticker arrow{secondary} animate__animated animate__fadeIn">↗</div>')
        elif kind == 'step_badge':
            elements.append(f'<div class="sticker step{secondary} animate__animated animate__fadeIn">STEP</div>')
        elif kind == 'case_tag':
            elements.append(f'<div class="sticker case{secondary} animate__animated animate__fadeIn">案例</div>')
        elif kind == 'keyword_spark':
            elements.append(f'<div class="sticker spark{secondary} animate__animated animate__fadeIn">✦</div>')
    return ''.join(elements)


def build_html(text, duration, htype, theme, position, font_size=None, packaging_kinds=(), W=1080, H=1920):
    style = TYPE_STYLE.get(htype, TYPE_STYLE['middle'])
    anim = ANIMATION_MAP.get(htype, 'animate__fadeIn')
    accent_bar_html = '<div class="accent-bar animate__animated animate__fadeIn" style="animation-delay:0.1s"></div>' if style['accent_bar'] else ''
    formatted, fitted_size = format_headline(text, font_size or style['size'])
    # Escape caption text before restoring the deliberate HTML line breaks.
    escaped = '<br>'.join(
        line.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        for line in formatted.split('<br>')
    )
    # Keep every card wholly outside the center third: 0-640 or 1280-1920.
    top = 110 if position == 'top' else 1300

    return f"""<!doctype html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width={W}, height={H}">
<style>
/* === Animate.css v4.1.1 core (inlined for HyperFrames sandbox) === */
:root {{ --animate-duration:1s;--animate-delay:1s;--animate-repeat:1; }}
.animate__animated {{
  animation-duration:1s; animation-duration:var(--animate-duration);
  animation-fill-mode:both;
}}
/* bounceInDown */
@keyframes bounceInDown{{
  0%,60%,75%,90%,to{{animation-timing-function:cubic-bezier(.215,.61,.355,1)}}
  0%{{opacity:0;transform:translate3d(0,-3000px,0) scaleY(3)}}
  60%{{opacity:1;transform:translate3d(0,25px,0) scaleY(.9)}}
  75%{{transform:translate3d(0,-10px,0) scaleY(.95)}}
  90%{{transform:translate3d(0,5px,0) scaleY(.985)}}
  to{{transform:translateZ(0)}}
}}
.animate__bounceInDown{{animation-name:bounceInDown}}
/* fadeInDown */
@keyframes fadeInDown{{
  0%{{opacity:0;transform:translate3d(0,-100%,0)}}
  to{{opacity:1;transform:translateZ(0)}}
}}
.animate__fadeInDown{{animation-name:fadeInDown}}
/* backInUp */
@keyframes backInUp{{
  0%{{transform:translateY(1200px) scale(.7);opacity:.7}}
  80%{{transform:translateY(0) scale(.7);opacity:.7}}
  to{{transform:scale(1);opacity:1}}
}}
.animate__backInUp{{animation-name:backInUp}}
/* fadeInLeft */
@keyframes fadeInLeft{{
  0%{{opacity:0;transform:translate3d(-100%,0,0)}}
  to{{opacity:1;transform:translateZ(0)}}
}}
.animate__fadeInLeft{{animation-name:fadeInLeft}}
/* fadeIn (accent bar) */
@keyframes fadeIn{{
  0%{{opacity:0}} to{{opacity:1}}
}}
.animate__fadeIn{{animation-name:fadeIn}}

/* === 卡片设计 === */
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ margin:0; width:{W}px; height:{H}px; overflow:hidden; background:{KEY_COLOR}; }}
#root {{
  width:{W}px; height:{H}px; position:relative;
  background:{KEY_COLOR};
}}
.wrap {{
  position:absolute;
  top:{top}px;
  padding: 0 8%;
  width: 100%;
}}
.accent-bar {{
  width: 64px;
  height: 8px;
   background: {theme['accent']};
  margin-bottom: 32px;
}}
.headline {{
  font-family: "PingFang SC", "Heiti SC", sans-serif;
   font-size: {fitted_size}px;
  font-weight: {style['weight']};
   color: {theme['text_light']};
  line-height: 1.4;
  word-break: break-word;
   background: {theme['bg_dark']};
   max-width: 84%;
   padding: 24px 30px;
  display: inline-block;
   --animate-duration: 0.6s;
}}
.sticker {{
  position:absolute;
  right: 9%;
  top: -24px;
  display:flex;
  align-items:center;
  justify-content:center;
  font-family: "PingFang SC", sans-serif;
  font-weight:800;
  --animate-duration: 0.45s;
}}
.sticker.secondary {{ right: 23%; top: -12px; }}
.question {{ width:92px; height:92px; border-radius:50%; background:{theme['accent']}; color:{theme['bg_dark']}; font-size:62px; }}
.data {{ padding:15px 20px; background:{theme['accent']}; color:{theme['bg_dark']}; font-size:28px; letter-spacing:2px; }}
.arrow {{ color:{theme['accent']}; font-size:96px; line-height:1; }}
.step {{ padding:13px 16px; border:3px solid {theme['accent']}; color:{theme['text_light']}; font-size:26px; letter-spacing:1px; }}
.case {{ padding:12px 20px; border-radius:999px; background:{theme['accent']}; color:{theme['bg_dark']}; font-size:30px; }}
.spark {{ color:{theme['accent']}; font-size:76px; line-height:1; }}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-duration="{duration:.2f}">
  <div class="wrap">
    {accent_bar_html}
    {packaging_html(packaging_kinds, text)}
    <div class="headline animate__animated {anim}" style="animation-delay:0.15s">{escaped}</div>
  </div>
</div>
</body>
</html>"""


def main():
    if len(sys.argv) < 6:
        print("用法: python3 render_highlight.py <text> <duration> <type> <output.mp4> <workdir> [theme_name] [position] [font_size] [packaging_kind]")
        sys.exit(1)

    text, duration, htype, output, workdir = (
        sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5]
    )
    theme_name = sys.argv[6] if len(sys.argv) > 6 else DEFAULT_THEME
    position = sys.argv[7] if len(sys.argv) > 7 else 'top'
    font_size = int(sys.argv[8]) if len(sys.argv) > 8 and sys.argv[8] else None
    packaging_kinds = sys.argv[9].split(',') if len(sys.argv) > 9 and sys.argv[9] else []
    theme = ALL_THEMES.get(theme_name)
    if theme is None:
        print(f"❌ 未知主题: {theme_name}。可用主题: {', '.join(ALL_THEMES)}")
        sys.exit(1)
    if position not in {'top', 'bottom'}:
        print("❌ 位置只能是 top 或 bottom")
        sys.exit(1)

    os.makedirs(workdir, exist_ok=True)
    html_path = os.path.join(workdir, 'index.html')
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(build_html(text, duration, htype, theme, position, font_size, packaging_kinds))

    # chromakey 方案：不依赖 alpha 通道，出普通 mp4，用 FFmpeg colorkey 抠背景
    r = subprocess.run(
        ['npx', 'hyperframes', 'render', workdir, '-o', output],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        print(f"❌ 渲染失败: {r.stderr[-500:]}")
        sys.exit(1)
    print(f"✅ {output} ({theme_name})")


if __name__ == '__main__':
    main()
