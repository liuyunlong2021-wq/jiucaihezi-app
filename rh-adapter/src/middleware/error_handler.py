"""Global error handling middleware for FastAPI."""

from __future__ import annotations

import logging

from fastapi import Request
from fastapi.responses import JSONResponse

from ..services.rh_client import (
    RHError,
    RHAuthError,
    RHInsufficientFunds,
    RHTaskFailed,
    RHPollTimeout,
)

logger = logging.getLogger(__name__)


async def rh_error_handler(request: Request, exc: RHError) -> JSONResponse:
    """Convert RHError exceptions to proper HTTP responses."""
    logger.error(
        "RH error: code=%d rh_code=%s message=%s path=%s",
        exc.code,
        exc.rh_code,
        str(exc),
        request.url.path,
    )

    if isinstance(exc, RHAuthError):
        status_code = 401
    elif isinstance(exc, RHInsufficientFunds):
        status_code = 402
    elif isinstance(exc, RHPollTimeout):
        status_code = 504
    elif isinstance(exc, RHTaskFailed):
        status_code = 500
    else:
        status_code = exc.code if 400 <= exc.code <= 599 else 500

    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "message": str(exc),
                "code": exc.rh_code or "rh_error",
                "type": "runninghub_error",
            }
        },
    )


async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for unexpected errors."""
    logger.exception("Unhandled error at %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "message": f"Internal adapter error: {str(exc)}",
                "code": "internal_error",
                "type": "adapter_error",
            }
        },
    )
