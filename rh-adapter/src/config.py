"""rh-adapter configuration."""

import os
from dotenv import load_dotenv

load_dotenv()

RUNNINGHUB_API_KEY: str = os.getenv("RUNNINGHUB_API_KEY", "")

HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8789"))
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info")

MAX_POLL_SECONDS: int = int(os.getenv("MAX_POLL_SECONDS", "600"))
POLL_INTERVAL_IMAGE: int = int(os.getenv("POLL_INTERVAL_IMAGE", "5"))
POLL_INTERVAL_VIDEO: int = int(os.getenv("POLL_INTERVAL_VIDEO", "10"))

# RunningHub API base URLs
RH_BASE_URL = "https://www.runninghub.cn"
RH_API_V2 = f"{RH_BASE_URL}/openapi/v2"
RH_ACCOUNT_STATUS = f"{RH_BASE_URL}/uc/openapi/accountStatus"
RH_STANDARD_UPLOAD = f"{RH_API_V2}/media/upload/binary"
RH_AI_APP_UPLOAD = f"{RH_BASE_URL}/task/openapi/upload"
RH_UPLOAD = RH_AI_APP_UPLOAD
RH_AI_APP_NODE_INFO = f"{RH_BASE_URL}/api/webapp/apiCallDemo"
RH_AI_APP_RUN = "https://www.runninghub.ai/task/openapi/ai-app/run"
RH_AI_APP_STATUS = "https://www.runninghub.ai/task/openapi/status"
RH_AI_APP_OUTPUTS = "https://www.runninghub.ai/task/openapi/outputs"
