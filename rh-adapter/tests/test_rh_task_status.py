import pytest

from src.main import build_task_status_response
from src.services.rh_client import query_task


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


class FakeClient:
    async def post(self, *_args, **_kwargs):
        return FakeResponse({
            "code": 0,
            "data": {
                "taskId": "2080000000000000001",
                "status": "FAILED",
                "errorCode": "1501",
                "errorMessage": "Content security audit did not pass",
                "results": None,
            },
        })


@pytest.mark.asyncio
async def test_failed_task_response_reaches_status_mapper():
    task = await query_task(FakeClient(), "rh_key", "2080000000000000001")
    response = build_task_status_response("2080000000000000001", task)

    assert response["status"] == "failed"
    assert response["error"]["message"] == "Content security audit did not pass"
