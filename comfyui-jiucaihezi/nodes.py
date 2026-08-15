"""Current Jiucaihezi image contracts for ComfyUI."""

import io
import json
import time

import numpy as np
import requests
import torch
from PIL import Image


API_BASE = "https://api.jiucaihezi.studio/v1"
GPT_MODELS = ["gpt-image-2-1k", "gpt-image-2-低质量", "gpt-image-2-中质量", "gpt-image-2-vip", "gpt-image-2-官方"]
GPT_RATIOS = ["1:1", "2:3", "3:2", "4:5", "5:4", "4:3", "3:4", "16:9", "9:16", "21:9"]
GPT_RESOLUTIONS = {"gpt-image-2-1k": ["1k"], **{model: ["1k", "2k", "4k"] for model in GPT_MODELS[1:]}}
GEMINI_MODELS = ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"]
ALL_MODELS = [*GPT_MODELS, *GEMINI_MODELS]


def gpt_sizes(resolutions):
    return [f"{resolution} | {ratio}" for resolution in resolutions for ratio in GPT_RATIOS]


MODEL_SIZES = {**{model: gpt_sizes(resolutions) for model, resolutions in GPT_RESOLUTIONS.items()}, **{model: ["1k", "2k"] for model in GEMINI_MODELS}}


def key(value):
    return str(value).strip()


def image_bytes(image):
    data = image[0].detach().cpu().clamp(0, 1).mul(255).round().byte().numpy()
    output = io.BytesIO(); Image.fromarray(data).save(output, "PNG")
    return output.getvalue()


def size_for(ratio, resolution):
    base = 1024 if resolution == "1k" else 3840 if resolution == "4k" else 2048
    if ratio == "1:1": return "1024x1024" if resolution == "1k" else "2048x2048"
    if ratio == "16:9": return "1536x1024" if resolution == "1k" else "3840x2160" if resolution == "4k" else "2048x1152"
    if ratio == "9:16": return "1024x1536" if resolution == "1k" else "2160x3840" if resolution == "4k" else "1152x2048"
    horizontal, vertical = map(int, ratio.split(":"))
    width, height = (round(base * horizontal / vertical), base) if horizontal > vertical else (base, round(base * vertical / horizontal))
    return f"{width}x{height}"


def result_url(payload):
    def find(value):
        if isinstance(value, dict):
            for name in ("url", "image_url", "result_url", "output"):
                if isinstance(value.get(name), str) and value[name]: return value[name]
            for value in value.values():
                found = find(value)
                if found: return found
        if isinstance(value, list):
            for value in value:
                found = find(value)
                if found: return found
        return ""
    return find(payload)


class JiucaiheziImageTask:
    CATEGORY = "Jiucaihezi"
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "response")

    def submit(self, api_key, model, prompt, resolution, size, images):
        token = key(api_key)
        if not token: raise RuntimeError("请填入韭菜盒子 API Key。")
        files = [("image", (f"image{i}.png", image_bytes(image), "image/png")) for i, image in enumerate(images, 1)]
        response = requests.post(f"{API_BASE}/videos", headers={"Authorization": f"Bearer {token}", "x-api-key": token}, data={"model": model, "prompt": prompt, "size": size, "resolution": resolution, "seconds": "1", "response_format": "url"}, files=files, timeout=300)
        response.raise_for_status(); submitted = response.json()
        task_id = str(submitted.get("id") or submitted.get("task_id") or submitted.get("data", {}).get("id") or "")
        if not task_id: raise RuntimeError("图片任务未返回任务 ID")
        headers = {"Authorization": f"Bearer {token}", "x-api-key": token}
        for _ in range(120):
            time.sleep(5)
            task = requests.get(f"{API_BASE}/videos/{task_id}", headers=headers, timeout=30); task.raise_for_status()
            payload = task.json(); status = str(payload.get("status") or payload.get("data", {}).get("status") or "").lower()
            url = result_url(payload)
            if url:
                image = Image.open(io.BytesIO(requests.get(url, timeout=60).content)).convert("RGB")
                pixels = torch.from_numpy(np.asarray(image).copy()).float().div(255).unsqueeze(0)
                return pixels, json.dumps(payload, ensure_ascii=False)
            if status in {"failed", "error", "cancelled"}: raise RuntimeError(str(payload))
        raise RuntimeError("图片任务超时")


def references(kwargs):
    return [kwargs[f"image{i}"] for i in range(1, 9) if kwargs.get(f"image{i}") is not None]


class JiucaiheziImage(JiucaiheziImageTask):
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"api_key": ("STRING", {"default": "", "password": True}), "model": (ALL_MODELS,), "prompt": ("STRING", {"multiline": True}), "resolution": (["1k", "2k", "4k"],), "ratio": (GPT_RATIOS,)}, "optional": {f"image{i}": ("IMAGE",) for i in range(1, 9)}}

    FUNCTION = "generate"

    def generate(self, api_key, model, prompt, resolution, ratio, **kwargs):
        if model in GPT_MODELS:
            if resolution not in GPT_RESOLUTIONS[model]:
                raise RuntimeError(f"{model} 只支持 {'/'.join(GPT_RESOLUTIONS[model])}")
            return self.submit(api_key, model, prompt, resolution, size_for(ratio, resolution), references(kwargs))
        if resolution not in {"1k", "2k"}:
            raise RuntimeError(f"{model} 只支持 1k/2k")
        return self.submit(api_key, model, prompt, resolution, "auto", references(kwargs))


NODE_CLASS_MAPPINGS = {"JiucaiheziImage": JiucaiheziImage}
NODE_DISPLAY_NAME_MAPPINGS = {"JiucaiheziImage": "韭菜盒子 图片生成"}
