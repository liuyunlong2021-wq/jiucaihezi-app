"""异步任务注册表。

内存态即可 —— 产物本身 24 小时就删（`output.static_ttl`），
任务记录也没必要落盘。进程重启后任务丢失是预期行为。

状态机：queued -> running -> succeeded / failed / cancelled
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("adp.tasks")

QUEUED = "queued"
RUNNING = "running"
SUCCEEDED = "succeeded"
FAILED = "failed"
CANCELLED = "cancelled"
TERMINAL = {SUCCEEDED, FAILED, CANCELLED}


def new_task_id() -> str:
    return "task_" + time.strftime("%Y%m%d") + "_" + uuid.uuid4().hex[:12]


#: 任务视图里不回显的字段（prompt 可能很长，images 可能是几 MB 的 data URL）
_SKIP_PARAMS = {
    "prompt",
    "images",
    "image",
    "mask",
    "negative_prompt",
    "first_frame",
    "last_frame",
    "reference_images",
}


def _safe_params(params: dict) -> dict[str, Any]:
    """把请求参数裁剪成可安全回显的形式。"""
    out: dict[str, Any] = {}
    for k, v in params.items():
        if k in _SKIP_PARAMS:
            continue
        if isinstance(v, str):
            out[k] = v if len(v) <= 200 else v[:200] + "…"
        elif isinstance(v, (int, float, bool)) or v is None:
            out[k] = v
        else:
            out[k] = f"<{type(v).__name__}>"
    return out


@dataclass
class Task:
    id: str
    type: str
    model: str | None
    params: dict
    status: str = QUEUED
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    result: dict | None = None
    error: dict | None = None
    cancel_requested: bool = False

    @property
    def elapsed(self) -> float | None:
        """实际执行时长（不含排队）。还没开始执行时返回 None。"""
        if self.started_at is None:
            return None
        return round((self.finished_at or time.time()) - self.started_at, 2)

    @property
    def queued_seconds(self) -> float:
        """排队时长。执行中/已结束时是固定值，仍在排队时会增长。"""
        end = self.started_at if self.started_at is not None else time.time()
        return round(max(0.0, end - self.created_at), 2)

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL

    def view(self, *, include_result: bool = True) -> dict[str, Any]:
        """对外暴露的任务视图。"""
        out: dict[str, Any] = {
            "id": self.id,
            "object": "generation.task",
            "type": self.type,
            "model": self.model,
            "status": self.status,
            "created_at": int(self.created_at),
        }
        if include_result and self.result is not None:
            out.update(self.result)
        if self.error is not None:
            out["error"] = self.error
        # 任务自身的时间口径最后写，避免被 result 里的同名字段覆盖
        out["queued_seconds"] = self.queued_seconds
        out["elapsed_seconds"] = self.elapsed
        # params 优先用结果里「归一化后的实际值」（能看到真正用的 seed/尺寸/帧数）；
        # 还没出结果时退回原始请求参数，方便排查入参。
        out.setdefault("params", _safe_params(self.params))
        return out


class TaskStore:
    def __init__(self, ttl: float = 86400.0, max_entries: int = 500) -> None:
        self.ttl = float(ttl)
        self.max_entries = int(max_entries)
        self._tasks: dict[str, Task] = {}

    # ------------------------------------------------------------ 读写
    def create(self, task_type: str, model: str | None, params: dict) -> Task:
        self.sweep()
        if len(self._tasks) >= self.max_entries:
            # 优先淘汰已结束的旧任务；实在放不下就拒绝
            done = sorted(
                (t for t in self._tasks.values() if t.is_terminal),
                key=lambda t: t.created_at,
            )
            for t in done:
                if len(self._tasks) < self.max_entries:
                    break
                self._tasks.pop(t.id, None)
            if len(self._tasks) >= self.max_entries:
                raise RuntimeError(f"任务表已满（{self.max_entries}），请稍后重试")

        task = Task(id=new_task_id(), type=task_type, model=model, params=params)
        self._tasks[task.id] = task
        return task

    def get(self, task_id: str) -> Task | None:
        return self._tasks.get(task_id)

    def all(self, limit: int = 50) -> list[Task]:
        return sorted(self._tasks.values(), key=lambda t: t.created_at, reverse=True)[:limit]

    def count_active(self) -> int:
        return sum(1 for t in self._tasks.values() if not t.is_terminal)

    def stats(self) -> dict:
        by_status: dict[str, int] = {}
        for t in self._tasks.values():
            by_status[t.status] = by_status.get(t.status, 0) + 1
        return {"total": len(self._tasks), "active": self.count_active(), "by_status": by_status}

    # ------------------------------------------------------------ 维护
    def sweep(self) -> int:
        """清掉过期 / 超额的历史任务。"""
        cutoff = time.time() - self.ttl
        removed = 0
        for tid, t in list(self._tasks.items()):
            if t.is_terminal and (t.finished_at or t.created_at) < cutoff:
                self._tasks.pop(tid, None)
                removed += 1
        if removed:
            log.info("已清理 %d 条历史任务", removed)
        return removed
