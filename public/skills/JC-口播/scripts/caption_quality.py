"""Normalize known AI terminology and report captions requiring human review."""
import json
from pathlib import Path


LEXICON_PATH = Path(__file__).parent.parent / 'references' / 'caption_lexicon.json'


def load_lexicon():
    with open(LEXICON_PATH, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def normalize_captions(captions):
    lexicon = load_lexicon()
    corrections = {
        alias.lower(): canonical
        for canonical, aliases in lexicon['ai_terms'].items()
        for alias in aliases
    }
    report = {'needs_review': [], 'applied_corrections': [], 'preserved_dialect': []}
    normalized = []
    for caption in captions:
        raw = caption.get('raw_text', caption['text'])
        corrected = raw
        for alias, canonical in corrections.items():
            if alias in corrected.lower():
                start = corrected.lower().find(alias)
                corrected = corrected[:start] + canonical + corrected[start + len(alias):]
                report['applied_corrections'].append({
                    'caption_id': caption['id'], 'from': alias, 'to': canonical,
                })
        dialect = [word for word in lexicon['northeast_dialect'] if word in corrected]
        if dialect:
            report['preserved_dialect'].append({'caption_id': caption['id'], 'words': dialect})
        if any(character.isdigit() for character in corrected) or any(char.isascii() and char.isalpha() for char in corrected):
            report['needs_review'].append({
                'caption_id': caption['id'], 'reason': '包含数字或英文术语，请确认听写。', 'text': corrected,
            })
        normalized.append({
            **caption,
            'raw_text': raw,
            'corrected_text': corrected,
            'display_text': corrected,
            'text': corrected,
        })
    return normalized, report
