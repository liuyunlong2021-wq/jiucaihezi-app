"""任务表落盘与重启接管（2026-10-29）。

背景：comfy-adapter 的任务表原来只在内存里，进程一重启就清空。NewAPI 只存适配器的
任务号，于是它拿着老号来问、拿到 404、把任务判成「上游任务失败」——2026-10-29
第 1 集四段视频就是这么全灭的（adapter.log 里四条 `GET /v1/videos/task_20261029_* 404`）。

这里的用例锁三件事：任务能跨重启存活、大字段不落盘、重启后能按「有没有提交到
ComfyUI」分派（有 prompt_id 的接着等、没有的判失效）。
"""

import json
import tempfile
import time
import unittest
from pathlib import Path

from adp.tasks import FAILED, RUNNING, SUCCEEDED, TaskStore


class TaskPersistenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / "state" / "tasks.json"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _store(self, **kwargs) -> TaskStore:
        return TaskStore(path=self.path, **kwargs)

    # ------------------------------------------------------------------ 存活
    def test_task_survives_restart(self) -> None:
        now = time.time()
        store = self._store()
        task = store.create("video", "minimax-h3-ref2v", {"prompt": "镜头", "duration": 8})
        task.comfy_prompt_id = "pid-aaa"
        task.status = RUNNING
        task.started_at = now - 14
        task.result = {"data": [{"url": "https://example.test/files/a.mp4"}]}
        task.status = SUCCEEDED
        task.finished_at = now - 2
        store.flush()

        revived = self._store()
        back = revived.get(task.id)
        self.assertIsNotNone(back, "重启后必须还能按任务号查到")
        self.assertEqual(back.status, SUCCEEDED)
        self.assertEqual(back.comfy_prompt_id, "pid-aaa")
        self.assertEqual(back.result, {"data": [{"url": "https://example.test/files/a.mp4"}]})
        self.assertEqual(back.finished_at, now - 2)

    def test_running_task_keeps_prompt_id_for_reattach(self) -> None:
        store = self._store()
        task = store.create("video", "minimax-h3-ref2v", {"prompt": "镜头"})
        task.comfy_prompt_id = "pid-bbb"
        task.status = RUNNING
        store.flush()

        revived = self._store()
        back = revived.get(task.id)
        self.assertIsNotNone(back)
        self.assertFalse(back.is_terminal, "在途任务不能被当成结束")
        self.assertEqual(back.comfy_prompt_id, "pid-bbb")

    # -------------------------------------------------------------- 体积裁剪
    def test_big_params_are_not_written(self) -> None:
        store = self._store()
        store.create(
            "video",
            "minimax-h3-ref2v",
            {"prompt": "长" * 5000, "images": ["data:image/png;base64," + "A" * 10000], "duration": 8},
        )
        store.flush()

        raw = self.path.read_text("utf-8")
        self.assertNotIn("data:image/png;base64", raw, "参考图 base64 不能落盘")
        self.assertNotIn("长" * 200, raw, "超长 prompt 不能原样落盘")
        back = self._store().all()[0]
        self.assertEqual(back.params.get("duration"), 8, "小字段要留着，排障要看入参")

    # ------------------------------------------------------------ 重启后分派
    def test_recover_dispatches_by_prompt_id(self) -> None:
        store = self._store()
        submitted = store.create("video", "m", {"prompt": "p"})
        submitted.comfy_prompt_id = "pid-ccc"
        submitted.status = RUNNING
        queued = store.create("video", "m", {"prompt": "p"})
        done = store.create("video", "m", {"prompt": "p"})
        done.status = SUCCEEDED
        done.finished_at = time.time()
        store.flush()

        revived = self._store()
        resumed, lost = [], []
        count = revived.recover(
            resume=lambda task: resumed.append(task.comfy_prompt_id),
            lost=lambda task: lost.append(task.id),
        )
        self.assertEqual(count, 2, "只有未结束的两条需要分派")
        self.assertEqual(resumed, ["pid-ccc"])
        self.assertEqual(lost, [queued.id], "没有 prompt_id 说明重启前没提交到 ComfyUI")
        self.assertEqual(revived.get(done.id).status, SUCCEEDED, "已结束的不动")

    # ---------------------------------------------------------------- 健壮性
    def test_expired_tasks_are_not_restored(self) -> None:
        store = self._store(ttl=60)
        old = store.create("video", "m", {"prompt": "p"})
        old.status = SUCCEEDED
        old.finished_at = time.time() - 600
        store.flush()

        self.assertIsNone(self._store(ttl=60).get(old.id))

    def test_broken_state_file_starts_empty(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("{ 这不是 JSON", encoding="utf-8")
        store = self._store()
        self.assertEqual(store.all(), [], "坏文件不能挡住启动")
        store.create("image", "m", {"prompt": "p"})
        store.flush()
        self.assertIn("tasks", json.loads(self.path.read_text("utf-8")), "落盘要覆盖掉坏文件")

    def test_store_without_path_does_not_touch_disk(self) -> None:
        store = TaskStore()
        store.create("image", "m", {"prompt": "p"})
        store.flush()
        self.assertFalse(self.path.exists())


if __name__ == "__main__":
    unittest.main()
