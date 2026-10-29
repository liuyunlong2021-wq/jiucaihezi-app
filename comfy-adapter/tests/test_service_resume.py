"""重启接管在途任务时，service.resume 的两条路径。

1. ComfyUI 里已经查不到这条 prompt（history 没有、队列也没有）→ 立刻报错。
   不立刻报错的话上游要干等到 job_timeout（1800 秒）才收场。
2. 还能查到 → 接着等结果并组装 GenResult，不再提交一次。
"""

import asyncio
import unittest

from adp.comfy_client import ComfyError
from adp.config import AppConfig
from adp.service import GenerationService


class _FakeClient:
    def __init__(self, *, entry=None, queue=None, outputs=None):
        self._entry = entry
        self._queue = queue
        self._outputs = outputs or []

    async def history_entry(self, prompt_id):
        return self._entry

    async def queue_state(self, prompt_id):
        return self._queue

    async def wait_for_result(self, prompt_id, *, timeout=None):
        return self._entry or {}

    def extract_error(self, entry):
        return None

    def extract_images(self, entry):
        return list(self._outputs)

    async def fetch_image(self, item):
        return b"blob"

    def guess_kind(self, item):
        return "video"


def _service(client) -> GenerationService:
    class _Template:
        id = "minimax-h3-ref2v"

    return GenerationService(AppConfig(), client, {_Template.id: _Template()})


class ResumeTest(unittest.TestCase):
    def test_gone_prompt_fails_fast(self) -> None:
        service = _service(_FakeClient(entry=None, queue=None))
        with self.assertRaises(ComfyError) as ctx:
            asyncio.run(service.resume("minimax-h3-ref2v", "pid-gone"))
        self.assertIn("ComfyUI 里已经没有任务", str(ctx.exception))

    def test_queued_prompt_is_reattached_without_resubmitting(self) -> None:
        client = _FakeClient(entry={}, queue="pending", outputs=[{"filename": "a.mp4"}])
        service = _service(client)
        result = asyncio.run(service.resume("minimax-h3-ref2v", "pid-live"))
        self.assertEqual(result.prompt_id, "pid-live")
        self.assertEqual(result.images, [b"blob"])
        self.assertEqual(result.outputs[0]["kind"], "video")
        self.assertIsNone(result.params.get("prompt"), "接管时不回填原始参数，避免把 base64 带回来")


if __name__ == "__main__":
    unittest.main()
