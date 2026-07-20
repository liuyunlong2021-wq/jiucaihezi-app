#!/usr/bin/env python3
"""
HyperFrames 合成生成器 —— 常驻字幕(俊雅锐宋) + 高光卡片(GSAP) + HF效果

架构（不可改）：
  常驻字幕 = 俊雅锐宋 92px 白字 4px黑描边 2px阴影 底部25% — 地基
  高光卡片 = GSAP 类型化入场 + shimmer 光扫 — 装修
  包装元素 = 问号贴纸/数据牌/箭头/步骤标/案例标签 — 点缀
  HF 效果 = vignette暗角 + grain胶片颗粒 — 氛围

用法:
    python3 composer.py <captions.json> <highlights.json> <plan.json> \
        <person_alpha.webm> <audio.aac> <output_dir> [theme]
"""
import json, os, re, sys
from pathlib import Path

THEMES = {
    'indigo':  {'bg': '#0a1f3d', 'text': '#f1f3f5', 'accent': '#4a90d9'},
    'classic': {'bg': '#18181a', 'text': '#f1efea', 'accent': '#d4a574'},
    'klein':   {'bg': '#0a0a0a', 'text': '#fafaf8', 'accent': '#002FA7'},
    'lemon':   {'bg': '#0a0a0a', 'text': '#fafaf8', 'accent': '#FFD500'},
    'orange':  {'bg': '#0a0a0a', 'text': '#fafaf8', 'accent': '#FF6B35'},
}
DEFAULT_THEME = 'indigo'
W, H = 1080, 1920


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def compact_text(text):
    return ''.join(text.split())


def format_subtitle(text, max_chars=12):
    """字幕显示规则：去标点 -> <=12字单行 -> 超长语义断两行。抖音：一句一屏。"""
    import re
    clean = re.sub(r'[，。！？、；：""''…—\-,.!?;:\"\'()\[\]【】《》\s]', '', text)
    if not clean:
        return ''
    if len(clean) <= max_chars:
        return clean
    best = max_chars - 1
    for cut in range(max_chars - 2, min(max_chars + 2, len(clean) - 2)):
        if clean[cut] in '的了是在就也都还把被给让跟和与或而但所以因':
            best = cut + 1
            break
    return clean[:best] + '
' + clean[best:][:max_chars]

def escape_html(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def build_css(theme):
    t = theme
    return f"""
* {{ margin:0; padding:0; box-sizing:border-box; }}
html,body {{ width:{W}px; height:{H}px; overflow:hidden; background:{t['bg']}; }}

#root {{ position:relative; width:{W}px; height:{H}px; }}

#bg {{ position:absolute; inset:0; background:linear-gradient(180deg,{t['bg']} 0%,{t['bg']} 85%,rgba(0,0,0,0.45) 100%); }}

#person {{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:10; }}

#embed-layer {{ position:absolute; inset:0; z-index:1; pointer-events:none; }}

/* ── 常驻字幕（原始设计，不可改） ── */
#rail-layer {{ position:absolute; bottom:{int(H*0.25)}px; left:70px; right:70px; z-index:30; pointer-events:none; text-align:center; }}

.rail-text {{
    display:inline-block; font-family:"造字工房俊雅锐宋体验版","PingFang SC","Heiti SC",sans-serif;
    font-size:92px; font-weight:700; color:#FFFFFF; line-height:1.35; text-align:center;
    text-shadow: 0 0 2px #000, 0 0 2px #000, 0 0 2px #000, 0 0 2px #000;
    -webkit-text-stroke: 4px #151210; paint-order: stroke fill;
    letter-spacing:2px; opacity:0; white-space:pre-line;
}}

/* ── 高光卡片 ── */
#highlight-layer {{ position:absolute; inset:0; z-index:2; pointer-events:none; }}

.hl-card {{
    position:absolute; left:8%; right:8%; padding:24px 30px;
}}
.hl-card.pos-top {{ top:120px; }}
.hl-card.pos-bottom {{ bottom:700px; }}

.hl-inner {{
    display:inline-block; padding:20px 32px; font-weight:800; line-height:1.3;
    border-radius:8px; max-width:84%; position:relative; overflow:hidden;
}}
.hl-card.open .hl-inner,.hl-card.ending .hl-inner {{ font-size:76px; }}
.hl-card.hook .hl-inner {{ font-size:64px; }}
.hl-card.middle .hl-inner {{ font-size:54px; }}

.hl-accent {{ width:52px;height:5px;background:{t['accent']};margin-bottom:16px;border-radius:2px; }}

@keyframes shimmer {{
    0% {{ transform:translateX(-100%); }}
    100% {{ transform:translateX(300%); }}
}}
.hl-shimmer {{
    position:absolute; top:0; left:0; width:50%; height:100%; pointer-events:none;
    background:linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.07) 45%, rgba(255,255,255,0.14) 50%, rgba(255,255,255,0.07) 55%, transparent 100%);
    animation:shimmer 4s ease-in-out infinite;
}}

/* ── 包装元素 ── */
.pack {{ position:absolute; z-index:3; pointer-events:none; }}
.pack.question_sticker {{
    width:76px;height:76px;border-radius:50%;background:{t['accent']};color:{t['bg']};
    font-size:52px;font-weight:900;display:flex;align-items:center;justify-content:center;
}}
.pack.data_badge {{
    padding:10px 18px;background:{t['accent']};color:{t['bg']};
    font-size:28px;font-weight:800;letter-spacing:2px;border-radius:5px;
}}
.pack.contrast_arrow {{ color:{t['accent']};font-size:80px;font-weight:900;line-height:1; }}
.pack.step_badge {{
    padding:8px 16px;border:3px solid {t['accent']};color:{t['text']};
    font-size:26px;font-weight:700;letter-spacing:1px;
}}
.pack.case_tag {{
    padding:8px 20px;border-radius:999px;background:{t['accent']};color:{t['bg']};
    font-size:28px;font-weight:800;
}}
.pack.keyword_spark {{ color:{t['accent']};font-size:66px;line-height:1; }}

/* vignette + grain */
#vignette {{
    position:absolute; inset:0; z-index:25; pointer-events:none;
    background:radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%);
}}
#grain {{
    position:absolute; inset:0; z-index:24; pointer-events:none; opacity:0.06;
    background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-repeat:repeat; background-size:128px 128px;
}}
"""


def build_gsap_timeline(captions, render_plan, total_duration):
    lines = []


    # ── 常驻字幕：显式 set(0) + to(1) → 确保 seek 安全 ──
    for i, cap in enumerate(captions):
        text = cap.get('text', '').strip()
        if not text:
            continue
        st, et = cap['start'], cap['end']
        # 先强制设 0，再用 to 动画到 1
        lines.append(f"tl.set('#rail-{i}', {{opacity:0}}, {st:.3f});")
        lines.append(f"tl.to('#rail-{i}', {{opacity:1, duration:0.18, ease:'power2.out'}}, {st:.3f});")
        # 末尾前淡出
        if et - st > 0.3:
            lines.append(f"tl.to('#rail-{i}', {{opacity:0, duration:0.15, ease:'power2.in'}}, {et - 0.15:.3f});")

    # ── 高光卡片：从 render_plan 的 animation/style 字段动态读取 ──
    enabled = [h for h in render_plan if h.get('enabled', True)]
    for i, h in enumerate(enabled):
        hid = f'hl-{i}'
        st, et = h['start'], h['end']
        anim = h.get('animation', {})
        sty = h.get('style', {})

        # 从 animation dict 提取 GSAP props
        ease = anim.get('ease', 'power2.out')
        dur = anim.get('duration', 0.5)
        # transform props: 排除 ease/duration，其余都是 transform 目标
        transform_props = {k:v for k,v in anim.items() if k not in ('ease','duration')}

        # set: opacity:0 + 初始 transform
        set_props = {'opacity': 0}
        set_props.update(transform_props)
        lines.append(f"tl.set('#{hid}', {json.dumps(set_props)}, {st:.3f});")

        # to: opacity:1 + 目标 transform（归位）
        to_props = {'opacity': 1, 'duration': dur, 'ease': ease}
        # 反向 transform：y→0, x→0, scale→1, rotation→0, skewX→0
        for key in transform_props:
            if key in ('y','x'):
                to_props[key] = 0
            elif key == 'scale':
                to_props[key] = 1
            elif key in ('rotation','skewX'):
                to_props[key] = 0
        lines.append(f"tl.to('#{hid}', {json.dumps(to_props)}, {st:.3f});")

        lines.append(f"tl.to('#{hid}', {{opacity:0, duration:0.22, ease:'power2.in'}}, {et - 0.22:.3f});")

        for j, pe in enumerate(h.get('packaging_events', [])[:2]):
            pk_id = f'pk-{i}-{j}'
            kind = pe.get('kind', 'keyword_spark')
            delay = st + 0.1
            panim = pe.get('animation', {})
            pease = panim.get('ease', 'back.out(1.5)')
            pdur = panim.get('duration', 0.35)
            # transform props from sticker's animation dict
            pset = {'opacity': 0}
            pto = {'opacity': 1, 'duration': pdur, 'ease': pease}
            for pk, pv in panim.items():
                if pk in ('ease', 'duration'):
                    continue
                pset[pk] = pv
                if pk in ('y','x'):
                    pto[pk] = 0
                elif pk == 'scale':
                    pto[pk] = 1
                elif pk in ('rotation','skewX'):
                    pto[pk] = 0
            lines.append(f"tl.set('#{pk_id}', {json.dumps(pset)}, {delay:.3f});")
            lines.append(f"tl.to('#{pk_id}', {json.dumps(pto)}, {delay:.3f});")
            lines.append(f"tl.to('#{pk_id}', {{opacity:0, duration:0.18, ease:'power2.in'}}, {et - 0.18:.3f});")

    return '\n    '.join(lines)


def build_html(captions, render_plan, theme, audio_rel, person_rel, total_duration):
    css = build_css(theme)

    # ── 常驻字幕 DOM（格式化：去标点+换行+居中） ──
    rail_divs = []
    for i, cap in enumerate(captions):
        text = cap.get('text', '').strip()
        if not text:
            continue
        formatted = format_subtitle(text)
        rail_divs.append(f'    <div id="rail-{i}" class="rail-text">{escape_html(formatted)}</div>')

    # ── 高光卡片 DOM（动态 style 来自 render_plan） ──
    enabled = [h for h in render_plan if h.get('enabled', True)]
    hl_divs = []
    pk_divs = []
    for i, h in enumerate(enabled):
        htype = h.get('type', 'middle')
        pos = h.get('position', 'top')
        text = compact_text(h.get('highlight_text', h.get('text', '')))[:16]
        sty = h.get('style', {})
        # 从 style dict 构建 inline CSS
        sty_css = '; '.join(f'{k}:{v}' for k,v in sty.items())
        hl_divs.append(
            f'    <div id="hl-{i}" class="hl-card pos-{pos} {htype}">'
            f'<div class="hl-accent"></div>'
            f'<div class="hl-inner" style="{sty_css};">'
            f'{escape_html(text)}<div class="hl-shimmer"></div></div>'
            f'</div>'
        )
        for j, pe in enumerate(h.get('packaging_events', [])[:2]):
            kind = pe.get('kind', 'keyword_spark')
            label = pe.get('label', '')
            right_offset = 9 + (j * 14)
            top_offset = -26 + (j * 6)
            inner = {'question_sticker':'?','data_badge':label or '重点','contrast_arrow':'↗',
                     'step_badge':'STEP','case_tag':label or '案例'}.get(kind, '✦')
            pk_divs.append(
                f'    <div id="pk-{i}-{j}" class="pack {kind}" '
                f'style="right:{right_offset}%;top:{top_offset}px;">{inner}</div>'
            )

    gsap_code = build_gsap_timeline(captions, render_plan, total_duration)

    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<style>{css}</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{total_duration:.2f}" data-width="{W}" data-height="{H}">

  <div id="bg" data-track-index="0" data-start="0" data-duration="{total_duration:.2f}"></div>

  <div id="embed-layer" data-track-index="1" data-start="0" data-duration="{total_duration:.2f}">
    <div id="highlight-layer">
{chr(10).join(hl_divs)}
{chr(10).join(pk_divs)}
    </div>
  </div>

  <video id="person" class="clip" data-track-index="2" data-start="0" data-duration="{total_duration:.2f}"
        src="{person_rel}" muted playsinline></video>

  <div id="rail-layer" data-track-index="3" data-start="0" data-duration="{total_duration:.2f}">
{chr(10).join(rail_divs)}
  </div>

  <audio data-track-index="4" data-start="0" data-duration="{total_duration:.2f}" data-volume="1.0" src="{audio_rel}"></audio>

  <div id="vignette"></div>
  <div id="grain"></div>

</div>

<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script>
(function() {{
  window.__timelines = window.__timelines || {{}};
  var tl = gsap.timeline({{ paused: true }});

  {gsap_code}

  window.__timelines.main = tl;
}})();
</script>
</body>
</html>
"""


def main():
    if len(sys.argv) < 7:
        print("用法: python3 composer.py <captions.json> <highlights.json> <plan.json> "
              "<person_alpha.webm> <audio.aac> <output_dir> [theme]")
        sys.exit(1)

    captions_path = sys.argv[1]
    highlights_path = sys.argv[2]
    plan_path = sys.argv[3]
    person_path = sys.argv[4]
    audio_path = sys.argv[5]
    output_dir = Path(sys.argv[6])
    theme_name = sys.argv[7] if len(sys.argv) > 7 else DEFAULT_THEME

    captions = load_json(captions_path)
    highlights = load_json(highlights_path) if os.path.exists(highlights_path) else []
    render_plan = load_json(plan_path) if os.path.exists(plan_path) else []
    theme = THEMES.get(theme_name, THEMES[DEFAULT_THEME])

    total_duration = max((c['end'] for c in captions), default=60.0)

    person_rel = os.path.relpath(person_path, output_dir)
    audio_rel = os.path.relpath(audio_path, output_dir)

    output_dir.mkdir(parents=True, exist_ok=True)

    html = build_html(captions, render_plan, theme, audio_rel, person_rel, total_duration)

    index_path = output_dir / 'index.html'
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f"✅ HyperFrames 合成: {index_path}")
    print(f"   时长:{total_duration:.1f}s | 主题:{theme_name}")
    print(f"   常驻字幕:{len(captions)}条(俊雅锐宋92px白字黑描边) | 高光:{len(render_plan)}个")
    print(f"   效果: vignette + grain + shimmer")
    print(f"   下一步: cd {output_dir} && npx hyperframes render -o ../../成片_final.mp4")


if __name__ == '__main__':
    main()
