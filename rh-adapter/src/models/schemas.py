"""Pydantic models for OpenAI-compatible request/response schemas."""

from __future__ import annotations

from typing import Any, Optional
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


# ── Request schemas ──

class ImageRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    model: str = Field(..., description="NewAPI model name, e.g. rh-pro-image")
    prompt: str = Field(..., description="Text prompt")
    aspect_ratio: Optional[str] = Field(
        None,
        alias="ratio",
        validation_alias=AliasChoices("ratio", "aspect_ratio", "aspectRatio"),
        description="e.g. 16:9",
    )
    resolution: Optional[str] = Field(None, description="1k / 2k / 4k")
    size: Optional[str] = Field(None, description="e.g. 1024x1024")
    lora: Optional[str] = Field(None, description="Optional RunningHub LoRA adapter name")
    lora_strength: Optional[float] = Field(None, description="LoRA strength")
    output_format: Optional[str] = Field(
        None,
        alias="outputFormat",
        validation_alias=AliasChoices("outputFormat", "output_format"),
        description="png / jpeg / webp(lossless) / webp(lossy)",
    )
    images: Optional[list[str]] = Field(None, description="Reference image data URLs")
    image: Optional[str] = Field(None, description="Single reference image (alias)")
    n: Optional[int] = Field(None, description="Number of images (NewAPI passthrough, ignored)")
    extra_fields: Optional[dict[str, Any]] = Field(None, description="NewAPI image extra_fields passthrough")
    nodeInfoList: Optional[list[dict[str, Any]]] = Field(None)
    webappId: Optional[str] = Field(None)

    @model_validator(mode="before")
    @classmethod
    def restore_rh_fields_from_extra_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        extra = data.get("extra_fields") or data.get("extraFields")
        if not isinstance(extra, dict):
            return data

        merged = dict(data)

        def fill(target: str, *aliases: str) -> None:
            if any(alias in merged and merged.get(alias) not in (None, "") for alias in (target, *aliases)):
                return
            for alias in (target, *aliases):
                value = extra.get(alias)
                if value not in (None, ""):
                    merged[target] = value
                    return

        fill("aspectRatio", "aspect_ratio", "ratio")
        fill("resolution")
        fill("size")
        fill("lora")
        fill("lora_strength")
        fill("outputFormat", "output_format")
        fill("images")
        fill("image")
        # ★ Phase 1c: 恢复新模型独有字段（MJ/Grok/FLUX/LTX 等）
        fill("hd")
        fill("quality")
        fill("stylize")
        fill("chaos")
        fill("raw")
        fill("iw")
        fill("sref")
        fill("sw")
        fill("sv")
        fill("variant")
        fill("customWidth")
        fill("customHight")  # RH upstream typo: "customHight" not "customHeight"
        fill("duration")
        return merged


class VideoRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    model: str = Field(..., description="NewAPI model name, e.g. rh-video-v31-fast")
    prompt: str = Field("", description="Text prompt (optional for image-to-video)")
    ratio: Optional[str] = Field(None, alias="aspect_ratio")
    resolution: Optional[str] = Field(None)
    duration: Optional[int] = Field(None, description="Duration in seconds")
    images: Optional[list[str]] = Field(None, description="Reference image data URLs")
    video: Optional[str] = Field(None, description="Input video data URL")
    audio: Optional[str] = Field(None, description="Input audio data URL")
    text: Optional[str] = Field(None)
    width: Optional[int] = Field(None)
    height: Optional[int] = Field(None)
    # AI app / workflow fields
    nodeInfoList: Optional[list[dict[str, Any]]] = Field(None)
    webappId: Optional[str] = Field(None)
    extra_fields: Optional[dict[str, Any]] = Field(None, description="Passthrough extra fields")


class AudioRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    model: str = Field(..., description="NewAPI model name, e.g. rh-speech-hd")
    prompt: str = Field("", description="Text to synthesize")
    title: Optional[str] = Field(None, description="Song title")
    description: Optional[str] = Field(None, description="Suno one-shot song description")
    lyrics: Optional[str] = Field(None, description="Custom lyrics")
    tags: Optional[str] = Field(None, description="Music style tags")
    negative_tags: Optional[str] = Field(None, alias="negativeTags", description="Excluded music style tags")
    make_instrumental: Optional[str | bool] = Field(None, alias="makeInstrumental")
    language: Optional[str] = Field(None, description="Language code")
    voice: Optional[str] = Field(None, description="Voice preset")
    audio_url: Optional[str] = Field(None, alias="audioUrl", description="Reference audio URL for voice clone")
    audio: Optional[str] = Field(None, description="Reference audio (compat alias)")
    start_time: Optional[str] = Field(None, alias="startTime")
    end_time: Optional[str] = Field(None, alias="endTime")
    ref_text: Optional[str] = Field(None, alias="refText", description="Text matching the reference audio")
    text: Optional[str] = Field(None, description="Text to generate speech for")
    nodeInfoList: Optional[list[dict[str, Any]]] = Field(None)
    webappId: Optional[str] = Field(None)
    extra_fields: Optional[dict[str, Any]] = Field(None, description="Passthrough extra fields")

    @property
    def reference_audio(self) -> Optional[str]:
        return self.audio_url or self.audio


# ── Response schemas ──

class TaskStatus(BaseModel):
    id: str = ""
    status: str = ""  # pending / running / completed / failed
    progress: int = 0


class ImageResult(BaseModel):
    url: str = ""
    task_id: str = ""
    cost: float = 0.0
    duration_seconds: float = 0.0


class VideoResult(BaseModel):
    id: str = ""
    status: str = ""
    output: Optional[dict[str, str]] = None
    usage: dict[str, Any] = Field(default_factory=dict)


class ApiError(BaseModel):
    error: str
    message: str = ""
    code: str = ""
