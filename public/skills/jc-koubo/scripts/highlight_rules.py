"""Production rules that prevent highlighter cards from overwhelming the speaker."""
import re


MIN_CARD_DURATION = 1.0
MAX_CARD_DURATION = 2.8
MIN_CARD_GAP = 2.4
MIDDLE_MIN_VIDEO_DURATION = 25.0
MAX_DISPLAY_CHARS = 24  # ponytail: bumped from 16, Chinese segments are denser
CHARS_PER_LINE = 8
FILLER_PHRASES = {
    '怎么给你解释呢', '怎么说呢', '就是说', '也就是说', '你知道吧',
    '对不对', '然后呢', '我觉得', '那个', '这个', '哎呀',
}


def compact_text(text):
    return ''.join(text.split())


def is_highlight_worthy(segment):
    text = compact_text(segment['text']).strip('，。！？、；：')
    duration = segment['end'] - segment['start']
    return (
        duration >= MIN_CARD_DURATION
        and 5 <= len(text) <= MAX_DISPLAY_CHARS
        and text not in FILLER_PHRASES
    )


def display_text(text):
    """Only return complete lines that passed candidate validation."""
    text = compact_text(text)
    return text[:MAX_DISPLAY_CHARS]


def clamp_window(start, end, video_duration):
    end = min(end, video_duration, start + MAX_CARD_DURATION)
    return round(start, 3), round(end, 3)


def has_clearance(candidate, selected):
    return all(
        candidate['start'] >= item['end'] + MIN_CARD_GAP
        or candidate['end'] + MIN_CARD_GAP <= item['start']
        for item in selected
    )
