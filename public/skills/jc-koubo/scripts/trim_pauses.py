"""Remove only long no-dialogue gaps and retime captions without modifying source media."""
import subprocess

from caption_io import write_srt


LONG_PAUSE_SECONDS = 1.5
KEEP_PAUSE_SECONDS = 0.35


def build_removals(captions, video_duration=None):
    removals = []
    if captions and captions[0]['start'] > LONG_PAUSE_SECONDS:
        removals.append((KEEP_PAUSE_SECONDS / 2, captions[0]['start'] - KEEP_PAUSE_SECONDS / 2))
    for previous, following in zip(captions, captions[1:]):
        gap = following['start'] - previous['end']
        if gap > LONG_PAUSE_SECONDS:
            start = previous['end'] + KEEP_PAUSE_SECONDS / 2
            end = following['start'] - KEEP_PAUSE_SECONDS / 2
            if end > start:
                removals.append((start, end))
    if captions and video_duration and video_duration - captions[-1]['end'] > LONG_PAUSE_SECONDS:
        removals.append((captions[-1]['end'] + KEEP_PAUSE_SECONDS / 2, video_duration - KEEP_PAUSE_SECONDS / 2))
    return removals


def retime_captions(captions, removals):
    retimed = []
    for caption in captions:
        shift = sum(end - start for start, end in removals if end <= caption['start'])
        start = round(caption['start'] - shift, 3)
        end = round(caption['end'] - shift, 3)
        retimed.append({**caption, 'start': start, 'end': end, 'duration': round(end - start, 3)})
    return retimed


def trim_video(ffmpeg, video_path, video_duration, removals, output_path):
    if not removals:
        return False
    kept = []
    cursor = 0.0
    for start, end in removals:
        kept.append((cursor, start))
        cursor = end
    kept.append((cursor, video_duration))

    filters = []
    labels = []
    for index, (start, end) in enumerate(kept):
        filters.append(f'[0:v]trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS[v{index}]')
        filters.append(f'[0:a]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[a{index}]')
        labels.extend((f'[v{index}]', f'[a{index}]'))
    filters.append(f"{''.join(labels)}concat=n={len(kept)}:v=1:a=1[v][a]")
    command = [
        ffmpeg, '-i', str(video_path), '-filter_complex', ';'.join(filters),
        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium',
        '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-y', str(output_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f'停顿裁剪失败: {result.stderr[-800:]}')
    return True


def create_paced_media(ffmpeg, video_path, video_duration, captions, output_video, output_srt):
    removals = build_removals(captions, video_duration)
    retimed = retime_captions(captions, removals)
    if removals:
        trim_video(ffmpeg, video_path, video_duration, removals, output_video)
        write_srt(output_srt, retimed)
    return retimed, removals
