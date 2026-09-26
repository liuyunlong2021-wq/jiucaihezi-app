"""配置加载：config.yaml -> dataclass。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

# 项目根目录（.../comfy-adapter）
ROOT = Path(__file__).resolve().parent.parent


@dataclass
class ServerCfg:
    host: str = "127.0.0.1"
    port: int = 9000
    public_base_url: str = "http://127.0.0.1:9000"


@dataclass
class AuthCfg:
    api_keys: list[str] = field(default_factory=list)

    #: 视为「还没改」的占位符密钥
    PLACEHOLDERS = ("change-me-please", "changeme", "your-key-here", "")

    @property
    def enabled(self) -> bool:
        """只要配了非空 Key 就启用鉴权。

        注意：这里**不**把占位符当成「关闭鉴权」——否则容易误以为开着其实没开。
        占位符只在启动时告警提醒。
        """
        return any(k and k.strip() for k in self.api_keys)

    @property
    def using_placeholder(self) -> bool:
        return any((k or "").strip() in self.PLACEHOLDERS for k in self.api_keys) or not self.api_keys

    @property
    def effective_keys(self) -> list[str]:
        return [k.strip() for k in self.api_keys if k and k.strip()]


@dataclass
class ComfyCfg:
    base_url: str = "http://127.0.0.1:8188"
    client_id: str = "comfy-adapter"
    poll_interval: float = 0.5
    submit_timeout: float = 30.0
    job_timeout: float = 1800.0
    progress_log_interval: float = 15.0
    healthcheck_on_startup: bool = True


@dataclass
class LimitsCfg:
    max_concurrency: int = 1
    max_queue: int = 4
    max_batch: int = 4
    wait_timeout: float = 300.0


@dataclass
class OutputCfg:
    default_response_format: str = "b64_json"
    static_dir: str = "static"
    static_ttl: int = 86400

    @property
    def static_path(self) -> Path:
        p = ROOT / self.static_dir
        p.mkdir(parents=True, exist_ok=True)
        return p


@dataclass
class EditCfg:
    """单图 / 多图编辑（参考图输入）相关限制。"""

    #: 最多接受几张参考图（Qwen-Image 2.1 核心节点上限 16，这里默认 10）
    max_reference_images: int = 10
    #: 单张参考图体积上限
    max_image_bytes: int = 20 * 1024 * 1024
    #: 上传到 ComfyUI 时的子目录（相对其 input 目录）
    upload_subfolder: str = "adapter/uploads"
    #: 拉取远程 http(s) 参考图的超时
    fetch_url_timeout: float = 30.0
    #: 不指定 size 时，是否沿用第一张参考图的宽高
    default_to_reference_size: bool = True


@dataclass
class TasksCfg:
    """异步任务（提交 → 轮询）相关配置。"""

    #: 任务记录保留时长（秒）。产物本身也按 output.static_ttl 删除，两边保持一致
    ttl: int = 86400
    #: 任务表上限，超过则淘汰已结束的旧任务
    max_entries: int = 500
    #: 是否允许取消
    allow_cancel: bool = True


@dataclass
class AppConfig:
    server: ServerCfg = field(default_factory=ServerCfg)
    auth: AuthCfg = field(default_factory=AuthCfg)
    comfy: ComfyCfg = field(default_factory=ComfyCfg)
    limits: LimitsCfg = field(default_factory=LimitsCfg)
    output: OutputCfg = field(default_factory=OutputCfg)
    edit: EditCfg = field(default_factory=EditCfg)
    tasks: TasksCfg = field(default_factory=TasksCfg)
    models: list[str] = field(default_factory=list)
    log_level: str = "INFO"


def _fill(cls, data: dict | None):
    """按 dataclass 字段名挑出 yaml 里认识的键，忽略多余项。"""
    data = data or {}
    known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
    return cls(**{k: v for k, v in data.items() if k in known})


def load_config(path: str | Path | None = None) -> AppConfig:
    cfg_path = Path(path) if path else ROOT / "config.yaml"
    with open(cfg_path, "r", encoding="utf-8-sig") as f:
        raw = yaml.safe_load(f) or {}

    cfg = AppConfig(
        server=_fill(ServerCfg, raw.get("server")),
        auth=_fill(AuthCfg, raw.get("auth")),
        comfy=_fill(ComfyCfg, raw.get("comfy")),
        limits=_fill(LimitsCfg, raw.get("limits")),
        output=_fill(OutputCfg, raw.get("output")),
        edit=_fill(EditCfg, raw.get("edit")),
        tasks=_fill(TasksCfg, raw.get("tasks")),
        models=list(raw.get("models") or []),
        log_level=str(raw.get("log_level") or "INFO").upper(),
    )
    return cfg
