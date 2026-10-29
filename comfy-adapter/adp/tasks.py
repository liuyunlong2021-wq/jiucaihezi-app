"""异步任务注册表。

任务表会落盘（`tasks.state_file`，默认 `state/tasks.json`）。原因：任务号是 NewAPI
唯一的对账凭据，进程一重启就清空的话，上游拿着老号来问只会拿到 404，然后把他
判成「上游任务失败」——2026-10-29 第 1 集四段视频就是这么全灭的。
落盘只留有界字段：大字段（prompt / 参考图 base64）走 `_safe_params` 裁掉。

状态机：queued -> running -> succeeded / failed / cancelled
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

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
    #: 提交到 ComfyUI 后拿到的 prompt_id。重启后靠它去 ComfyUI 接管在途任务。
    comfy_prompt_id: str | None = None

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

    # ---------------------------------------------------------------- 落盘
    def to_record(self) -> dict[str, Any]:
        """落盘用的记录：大字段一律裁掉，只留有界值。"""
        return {
            "id": self.id,
            "type": self.type,
            "model": self.model,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "result": self.result,
            "error": self.error,
            "cancel_requested": self.cancel_requested,
            "comfy_prompt_id": self.comfy_prompt_id,
            "params": _safe_params(self.params),
        }

    @classmethod
    def from_record(cls, rec: dict) -> "Task":
        return cls(
            id=str(rec["id"]),
            type=str(rec.get("type") or "unknown"),
            model=rec.get("model"),
            params=dict(rec.get("params") or {}),
            status=str(rec.get("status") or QUEUED),
            created_at=float(rec.get("created_at") or time.time()),
            started_at=rec.get("started_at"),
            finished_at=rec.get("finished_at"),
            result=rec.get("result"),
            error=rec.get("error"),
            cancel_requested=bool(rec.get("cancel_requested")),
            comfy_prompt_id=rec.get("comfy_prompt_id"),
        )


class TaskStore:
    def __init__(
        self,
        ttl: float = 86400.0,
        max_entries: int = 500,
        path: str | Path | None = None,
    ) -> None:
        self.ttl = float(ttl)
        self.max_entries = int(max_entries)
        self.path = Path(path) if path else None
        self._tasks: dict[str, Task] = {}
        if self.path is not None:
            self._load()

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
        self.flush()
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
            self.flush()
        return removed

    # -------------------------------------------------------------- 持久化
    def flush(self) -> None:
        """把任务表写回磁盘。写失败只告警：落盘坏了不该让服务停下来。"""
        if self.path is None:
            return
        payload = {
            "version": 1,
            "saved_at": time.time(),
            "tasks": [t.to_record() for t in self._tasks.values()],
        }
        tmp = self.path.with_name(self.path.name + ".tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self.path)  # 原子替换，半截文件不会留在原位
        except Exception as e:  # noqa: BLE001
            log.warning("任务表落盘失败（%s）: %s", self.path, e)

    def _load(self) -> None:
        assert self.path is not None
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except Exception as e:  # noqa: BLE001
            log.warning("任务表读取失败，按空表启动（%s）: %s", self.path, e)
            return
        for rec in raw.get("tasks") or []:
            try:
                task = Task.from_record(rec)
            except Exception as e:  # noqa: BLE001
                log.warning("跳过损坏的任务记录: %s", e)
                continue
            self._tasks[task.id] = task
        if self._tasks:
            log.info("已从 %s 恢复 %d 条任务", self.path, len(self._tasks))
        self.sweep()

    def recover(
        self,
        *,
        resume: Callable[[Task], None],
        lost: Callable[[Task], None],
    ) -> int:
        """重启后给未结束的任务分派：有 prompt_id 的接管，没有的判失效。

        没有 prompt_id 说明进程在提交到 ComfyUI 之前就没了，ComfyUI 那边不会产出，
        继续挂着只会让上游一直等到超时。
        """
        count = 0
        for task in list(self._tasks.values()):
            if task.is_terminal:
                continue
            (resume if task.comfy_prompt_id else lost)(task)
            count += 1
        return count
