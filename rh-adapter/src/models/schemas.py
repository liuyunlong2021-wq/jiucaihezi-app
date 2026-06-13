"""Pydantic models for OpenAI-compatible request/response schemas."""

from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, ConfigDict, Field


# ── Request schemas ──

class ImageRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    model: str = Field(..., description="NewAPI model name, e.g. rh-pro-image")
    prompt: str = Field(..., description="Text prompt")
    aspect_ratio: Optional[str] = Field(None, alias="ratio", description="e.g. 16:9")
    resolution: Optional[str] = Field(None, description="1k / 2k / 4k")
    size: Optional[str] = Field(None, description="e.g. 1024x1024")
    images: Optional[list[str]] = Field(None, description="Reference image data URLs")
    image: Optional[str] = Field(None, description="Single reference image (alias)")
    nodeInfoList: Optional[list[dict[str, Any]]] = Field(None)
    webappId: Optional[str] = Field(None)


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
