#!/usr/bin/env python3
"""
JC-口播 v2.2 管线 —— HyperFrames karaoke 逐词字幕版

v2.2 新增（vs v2.1）：
  - 逐词 karaoke 字幕：导轨字幕拆成逐词 reveal，当前词 accent 高亮+缩放
  - 3 种字幕样式：clean（默认整条）| karaoke（逐词高亮）| pill（胶囊容器）
  - shimmer 光扫激活：高光卡片叠加流光动画

用法:
    python3 pipeline.py <video_path> [--theme indigo] [--density 0.10] [--caption-style clean] [--use-plan]
"""
import os, re, subprocess, sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent

# ffmpeg path resolution (ponytail: prefer brew ffmpeg-full, fallback to PATH)
FFMPEG = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg'
FFPROBE = '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe'
if not Path(FFMPEG).is_file():
    import shutil
    FFMPEG = shutil.which('ffmpeg') or 'ffmpeg'
    FFPROBE = shutil.which('ffprobe') or 'ffprobe'

def _run(cmd, die=True, desc=''):
    r = subprocess.run(cmd, capture_output=True, text=True)
    ok = r.returncode == 0
    if not ok and die:
        label = f' ({desc})' if desc else ''
        print(f"❌ 命令失败{label}: {' '.join(cmd[:3])}...")
        print(r.stderr[-500:])
    return ok, r.stdout, r.stderr

def probe_duration(video_path):
    cmd = [FFPROBE, '-v', 'error', '-show_entries', 'format=duration',
           '-of', 'default=noprint_wrappers=1:nokey=1', str(video_path)]
    ok, out, _ = _run(cmd, die=False)
    return float(out.strip()) if ok else 60.0

# ── 内联自 pipeline_v1 ─────────────────────────────
def _packaging_events_for(highlight):
    text = highlight.get('text', '')
    events = []
    if re.search(r'\d+(?:\.\d+)?%?|[一二三四五六七八九十]+[步个条点]', text):
        events.append({'kind':'data_badge','label':re.search(r'\d+(?:\.\d+)?%?',text).group() if re.search(r'\d+(?:\.\d+)?%?',text) else '重点'})
    if any(w in text for w in ('为什么','怎么','哪个','吗','？')):
        events.append({'kind':'question_sticker'})
    if any(w in text for w in ('不是','但是','其实','不如','却')):
        events.append({'kind':'contrast_arrow'})
    if any(w in text for w in ('第一','第二','第三','步骤','先','再')):
        events.append({'kind':'step_badge'})
    if any(w in text for w in ('比如','案例','我女儿','我朋友','客户')):
        events.append({'kind':'case_tag','label':'案例'})
    if not events:
        events.append({'kind':'keyword_spark'})
    return events[:2]

def create_render_plan(highlights, theme_name, video_duration):
    from highlight_rules import clamp_window, display_text
    plan = []
    for idx, h in enumerate(highlights):
        start, end = clamp_window(h['start'], h['end'], video_duration)
        if end - start < 1.0:
            continue
        plan.append({
            'id': f'highlight_{idx:03d}', 'start':start, 'end':end,
            'text': display_text(h['text']), 'source_text': h['text'],
            'type': h.get('type','middle'), 'theme': theme_name,
            'position': 'top', 'font_size': None,
            'packaging_events': _packaging_events_for(h), 'enabled': True,
        })
    return plan

# ══════════════════════════════════════════════════════
def run_pipeline(video_path, theme='indigo', density=0.10, use_plan=False):
    video = Path(video_path).resolve()
    workdir = video.parent
    basename = video.stem

    # ── 前置检查 ──
    cor_srt = workdir / 'subtitle_corrected.srt'
    if not cor_srt.exists():
        print(f"❌ 找不到: {cor_srt}")
        print("   请先: python3 scripts/transcribe_whisper.py 视频.mp4 --model small")
        print("   然后: AI 校准字幕 → subtitle_corrected.srt")
        return False

    captions_json = workdir / 'captions.json'
    highlights_json = workdir / 'highlights.json'
    render_plan_json = workdir / 'render_plan.json'
    person_alpha = workdir / f'{basename}_person.webm'
    audio_aac = workdir / f'{basename}_audio.aac'
    output_dir = workdir / 'output'
    captioned_video = workdir / f'{basename}_captioned.mp4'

    video_duration = probe_duration(video)
    print(f"🎬 JC-口播 v2.2")
    print(f"   视频: {video.name} ({video_duration:.1f}s)")
    print(f"   主题: {theme} | 高光密度: {density:.0%}")
    print(f"   效果: vignette + grain + shimmer\n")

    from caption_io import parse_srt, read_json, write_json

    # ── [1/5] 标准化字幕 ──
    print("[1/5] 📝 标准化字幕...")
    raw_captions = parse_srt(str(cor_srt))
    from caption_quality import normalize_captions
    segments, quality_report = normalize_captions(raw_captions)
    write_json(captions_json, segments)
    write_json(workdir / 'subtitle_quality_report.json', quality_report)
    print(f"   ✅ {len(segments)} 条字幕 → captions.json")
    if quality_report.get('needs_review'):
        print(f"   ⚠️  {len(quality_report['needs_review'])} 项待复核 → subtitle_quality_report.json")

    # ── [1.5/5] ASS 字幕烧录到视频 ──
    print("\n[1.5/5] 常驻字幕烧录（俊雅锐宋92px白字黑描边）...")
    font_dir = str(SCRIPT_DIR.parent / 'fonts')
    ass_path = str(workdir / f'{basename}_subtitle.ass')
    from caption_io import read_json as _rj
    segs = _rj(captions_json)
    
    def _sec2ass(s):
        h = int(s // 3600); m = int((s % 3600) // 60); sec = s % 60
        return f"{h}:{m:02d}:{sec:05.2f}"
    
    def _fmt(text, mc=11):
        import re as _re
        clean = _re.sub(r'[，。！？、；：""''…\-,.!?;:\\"\'()\[\]【】《》\s]', '', text)
        if not clean: return ''
        if len(clean) <= mc: return clean
        best = mc - 1
        for cut in range(mc-2, min(mc+2, len(clean)-2)):
            if clean[cut] in '的了是在就也都还把被给让跟和与或而但所以因':
                best = cut + 1; break
        return clean[:best] + '\\N' + clean[best:][:mc]
    
    alines = []
    for sg in segs:
        st = _sec2ass(sg['start']); et = _sec2ass(sg['end'])
        text = _fmt(sg.get('text', ''))
        if not text: continue
        esc = text.replace('{', '\\{').replace('}', '\\}')
        alines.append(f"Dialogue: 0,{st},{et},Subtitle,,0,0,0,,{esc}")
    
    with open(ass_path, 'w', encoding='utf-8') as _f:
        _f.write(f"""[Script Info]\nTitle: JC-口播 常驻字幕\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Subtitle,造字工房俊雅锐宋体验版,92,&H00FFFFFF,&H00FFFFFF,&H00151210,&H00000000,1,0,0,0,100,100,0,0,1,4,2,2,70,70,480,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n""" + '\n'.join(alines))
    
    subtitle_filter = f"subtitles=filename='{ass_path}':fontsdir='{font_dir}'"
    cmd = [FFMPEG, '-i', str(video), '-vf', subtitle_filter,
           '-c:v', 'libx264', '-b:v', '8000k', '-c:a', 'aac', '-b:a', '192k',
           '-preset', 'medium', '-r', '25', '-y', str(captioned_video)]
    ok, _, err = _run(cmd, die=False, desc='ASS烧录')
    if ok:
        print(f"   ✅ 常驻字幕已烧录 → {captioned_video.name}")
    else:
        print(f"   ⚠️ 烧录失败，使用原视频: {err[-200:]}")
        captioned_video = video
    
    # ── [2/5] 提取高光 ──
    print("\n[2/5] 🎯 提取高光时刻...")
    if use_plan:
        if not render_plan_json.exists():
            print(f"❌ 找不到: {render_plan_json}")
            return False
        render_plan = read_json(render_plan_json)
        print(f"   ✅ 使用已有 render_plan.json ({len(render_plan)} 个)")
    else:
        _run([sys.executable, str(SCRIPT_DIR / 'analyze_highlights.py'),
              str(captions_json), str(highlights_json), str(density), str(video_duration)])
        highlights = read_json(highlights_json)
        render_plan = create_render_plan(highlights, theme, video_duration)
        write_json(render_plan_json, render_plan)
        print(f"   ✅ {len(render_plan)} 个高光点 → render_plan.json")
        print(f"   💡 可编辑 render_plan.json 后 --use-plan 重跑")

    # ── [3/5] 音频提取 + 去背景 ──
    print("\n[3/5] 🔉 音频提取 + 🫥 人物去背景...")

    if not audio_aac.exists():
        ok, _, _ = _run([FFMPEG, '-i', str(video), '-vn', '-acodec', 'aac', '-b:a', '192k',
                         '-y', str(audio_aac)], desc='音频提取')
        if ok:
            print(f"   ✅ 音频: {audio_aac.name}")
        else:
            print("   ⚠️ 音频提取失败，将渲染无声视频")
    else:
        print(f"   ✅ 音频已存在: {audio_aac.name}")

    # captioned_video 已包含常驻字幕

    # ── [4/5] HyperFrames 项目初始化 ──
    print("\n[4/5] 🧩 生成 HyperFrames GSAP 合成...")
    if not (output_dir / 'hyperframes.json').exists():
        _run(['npx', 'hyperframes', 'init', str(output_dir),
              '--non-interactive', '--example=blank'], die=False, desc='HF init')
    output_dir.mkdir(parents=True, exist_ok=True)

    # 把 assets 软链接到 output/ 下（HF render 需要本地路径）
    for src_name in [person_alpha.name, audio_aac.name]:
        src = workdir / src_name
        dst = output_dir / src_name
        if src.exists() and not dst.exists():
            dst.symlink_to(os.path.relpath(src, output_dir))

    _run([sys.executable, str(SCRIPT_DIR / 'composer.py'),
          str(captions_json), str(highlights_json), str(render_plan_json),
          str(captioned_video), str(audio_aac), str(output_dir), theme])

    # ── [5/5] 渲染 ──
    print(f"\n[5/5] 🎥 渲染成片...")
    print(f"   运行: cd {output_dir} && npx hyperframes render -o ../../{basename}_final.mp4")
    print(f"   💡 渲染前可: cd {output_dir} && npx hyperframes preview  # 浏览器预览")
    print(f"   💡 验证用:   cd {output_dir} && npx hyperframes lint     # 检查错误")

    print(f"\n{'='*60}")
    print(f"✅ 全部就绪！复制上面的渲染命令执行即可。")
    print(f"{'='*60}")
    return True

def main():
    import argparse
    p = argparse.ArgumentParser(description='JC-口播 v2.2')
    p.add_argument('video', help='视频文件路径')
    p.add_argument('--theme', default='indigo', choices=['indigo','classic','klein','lemon','orange'])
    p.add_argument('--density', type=float, default=0.10)
    p.add_argument('--use-plan', action='store_true')
    args = p.parse_args()
    ok = run_pipeline(args.video, args.theme, args.density, args.use_plan)
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
