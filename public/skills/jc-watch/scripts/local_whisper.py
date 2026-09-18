#!/usr/bin/env python3
"""Transcribe with the machine's own whisper-cli (whisper.cpp) — no API key.

Drop-in replacement for the upstream `whisper.py` (Groq/OpenAI uploader). Keeps
the same call shape so the rest of the pipeline (filter_range,
format_transcript) does not care where the transcript came from.

Needs: `whisper-cli` on PATH plus one ggml model file. Model lookup order is
`$JC_WATCH_WHISPER_MODEL`, `$WHISPER_MODEL`, then the usual cache dirs.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


# Multi-language models first: `.en` builds cannot transcribe Chinese.
MODEL_PREFERENCE = (
    "ggml-large-v3-turbo.bin",
    "ggml-large-v3.bin",
    "ggml-medium.bin",
    "ggml-small.bin",
    "ggml-base.bin",
    "ggml-tiny.bin",
)

MODEL_SEARCH_DIRS = (
    Path.home() / ".cache" / "whisper.cpp",
    Path.home() / ".jiucaihezi" / "tools" / "whisper-models",
    Path.home() / ".jiucaihezi" / "models" / "whisper",
    Path.home() / ".local" / "share" / "whisper.cpp",
    Path("/opt/homebrew/share/whisper.cpp"),
    Path("/usr/local/share/whisper.cpp"),
)

SAMPLE_RATE = 16000

_SRT_TS = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})"
)


def find_binary() -> str | None:
    """whisper.cpp ships its CLI as `whisper-cli` (older builds: `main`)."""
    return shutil.which("whisper-cli") or shutil.which("whisper")


def _model_candidates() -> list[Path]:
    found: list[Path] = []
    for directory in MODEL_SEARCH_DIRS:
        if not directory.is_dir():
            continue
        for name in MODEL_PREFERENCE:
            candidate = directory / name
            if candidate.is_file():
                found.append(candidate)
        # Anything else the user dropped in, multi-language before `.en`.
        extra = sorted(directory.glob("ggml-*.bin"))
        found.extend(p for p in extra if not p.name.endswith(".en.bin"))
        found.extend(p for p in extra if p.name.endswith(".en.bin"))
    return found


def find_model(explicit: str | None = None) -> Path | None:
    if explicit:
        candidate = Path(explicit).expanduser()
        return candidate if candidate.is_file() else None

    for env_name in ("JC_WATCH_WHISPER_MODEL", "WHISPER_MODEL"):
        raw = os.environ.get(env_name)
        if raw:
            candidate = Path(raw).expanduser()
            if candidate.is_file():
                return candidate

    candidates = _model_candidates()
    return candidates[0] if candidates else None


def load_api_key(preferred: str | None = None) -> tuple[str, str] | tuple[None, None]:
    """Kept as the upstream name so `watch.py` needs no change.

    Returns `("local", "<model path>")` when the local runtime is ready, else
    `(None, None)`. `preferred` is ignored: there is only one backend here, so
    `--whisper groq|openai` no longer selects anything.
    """
    if find_binary() is None:
        return None, None
    model = find_model(preferred)
    if model is None:
        return None, None
    return "local", str(model)


def missing_reason() -> str:
    """Human-readable cause for the transcription being unavailable."""
    if find_binary() is None:
        return "whisper-cli not found on PATH (macOS: brew install whisper-cpp)"
    return (
        "no whisper model found. Download one, e.g. "
        "curl -L -o ~/.cache/whisper.cpp/ggml-base.bin "
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
    )


def extract_audio(video_path: str, out_path: Path) -> Path:
    """Pull mono 16 kHz audio — the rate whisper.cpp expects."""
    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg is not installed. Install with: brew install ffmpeg")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", str(Path(video_path).resolve()),
        "-vn",
        "-ac", "1",
        "-ar", str(SAMPLE_RATE),
        "-c:a", "pcm_s16le",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not out_path.exists():
        raise SystemExit(f"ffmpeg audio extraction failed: {result.stderr.strip()}")
    return out_path


def parse_srt(path: Path) -> list[dict]:
    """Parse whisper-cli's SRT into the shared segment shape."""
    text = path.read_text(encoding="utf-8", errors="ignore")
    segments: list[dict] = []
    for block in re.split(r"\n\s*\n", text):
        lines = [line.strip() for line in block.strip().splitlines() if line.strip()]
        if not lines:
            continue
        ts_index = next((i for i, line in enumerate(lines) if _SRT_TS.search(line)), None)
        if ts_index is None:
            continue
        match = _SRT_TS.search(lines[ts_index])
        assert match is not None
        h1, m1, s1, ms1, h2, m2, s2, ms2 = (int(v) for v in match.groups())
        body = " ".join(lines[ts_index + 1:]).strip()
        if not body:
            continue
        segments.append({
            "start": round(h1 * 3600 + m1 * 60 + s1 + ms1 / 1000.0, 2),
            "end": round(h2 * 3600 + m2 * 60 + s2 + ms2 / 1000.0, 2),
            "text": body,
        })
    return segments


def transcribe_video(
    video_path: str,
    audio_path: Path,
    backend: str = "local",
    api_key: str | None = None,
    language: str | None = None,
) -> tuple[list[dict], str]:
    """Run whisper-cli over the extracted audio. Returns (segments, backend)."""
    binary = find_binary()
    if binary is None:
        raise SystemExit(missing_reason())
    model = find_model(api_key or None)
    if model is None:
        raise SystemExit(missing_reason())

    audio = extract_audio(video_path, audio_path)
    out_base = Path(audio_path).with_suffix("")

    # 音频走位置参数：whisper.cpp ≥1.7 的 whisper-cli 就是 `whisper-cli [options] file0`，
    # `-f` 是旧版写法，新版会直接报 unknown argument。
    cmd = [
        binary,
        "-m", str(model),
        "-l", str(language or "auto"),
        "-osrt",
        "-of", str(out_base),
        str(audio),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    srt_path = out_base.with_suffix(".srt")
    if result.returncode != 0 or not srt_path.exists():
        detail = (result.stderr or result.stdout or "").strip().splitlines()
        raise SystemExit(f"whisper-cli failed: {detail[-1] if detail else 'unknown error'}")

    segments = parse_srt(srt_path)
    if not segments:
        # 静默失败最常见的两个原因：音频真没语音，或者模型是 CI 用的空壳
        # （whisper.cpp 仓库的 for-tests-ggml-*.bin 不做真实转录）。
        print(
            "[jc-watch] whisper-cli returned an empty transcript — either the audio has no "
            f"speech, or the model is a CI stub (got: {model.name})",
            file=sys.stderr,
        )
    return segments, "local whisper.cpp"


if __name__ == "__main__":
    print(f"binary: {find_binary()}")
    print(f"model:  {find_model()}")
    print(f"ready:  {load_api_key()}")
    if len(sys.argv) >= 2:
        segments, backend = transcribe_video(
            sys.argv[1],
            Path(tempfile.mkdtemp(prefix="jc-watch-whisper-")) / "audio.wav",
            language=sys.argv[2] if len(sys.argv) > 2 else None,
        )
        print(f"{backend}: {len(segments)} segments")
        for seg in segments[:5]:
            print(f"  [{seg['start']:.1f}s] {seg['text']}")
