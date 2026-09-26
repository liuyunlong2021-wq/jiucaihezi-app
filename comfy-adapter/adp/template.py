"""工作流模板：API 格式 prompt + 参数映射。

设计：
  workflows/xxx.json       —— 纯 ComfyUI API 格式 prompt（可直接 POST /prompt）
  workflows/xxx.meta.json  —— 对外模型 id、默认值、参数绑定、约束

参数绑定形如::

    "bind": {
      "prompt":  [{"node": "5", "input": "text"}],
      "width":   [{"node": "7", "input": "width"}],
      "seed":    [{"node": "8", "input": "seed"}]
    }

渲染 = 深拷贝模板 + 把请求参数写进对应节点的 inputs。
"""

from __future__ import annotations

import copy
import json
import logging
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("adp.template")


class TemplateError(ValueError):
    """模板/参数非法。"""


# ---------------------------------------------------------------- 工具函数


def parse_size(size: str | None) -> tuple[int, int] | None:
    """解析 '1024x1024' / '1024*1024' / '1024×1024'。"""
    if not size:
        return None
    s = str(size).lower().replace(" ", "")
    for sep in ("x", "*", "×"):
        if sep in s:
            a, _, b = s.partition(sep)
            try:
                return int(a), int(b)
            except ValueError:
                return None
    return None


def _snap(value: int, multiple: int, lo: int, hi: int) -> int:
    value = max(lo, min(hi, int(value)))
    return max(multiple, int(round(value / multiple)) * multiple)


def _deep_replace(node: Any, table: dict[str, Any]) -> Any:
    """把模板里字符串形式的占位符（如 '__PROMPT__'）替换成实际值。"""
    if isinstance(node, dict):
        return {k: _deep_replace(v, table) for k, v in node.items()}
    if isinstance(node, list):
        return [_deep_replace(v, table) for v in node]
    if isinstance(node, str) and node in table:
        return table[node]
    return node


def _subst(node: Any, idx: int, value: Any) -> Any:
    """动态块占位符替换：{i}=0 基序号, {i1}=1 基序号, {value}=当前项。"""
    if isinstance(node, dict):
        return {k: _subst(v, idx, value) for k, v in node.items()}
    if isinstance(node, list):
        return [_subst(v, idx, value) for v in node]
    if isinstance(node, str) and ("{i" in node or "{value}" in node):
        return (
            node.replace("{i1}", str(idx + 1))
            .replace("{i}", str(idx))
            .replace("{value}", str(value))
        )
    return node


# ---------------------------------------------------------------- 模板对象


@dataclass
class WorkflowTemplate:
    id: str
    prompt: dict
    meta: dict
    source: Path | None = None

    # -------------------------------------------------- 元信息快捷访问
    @property
    def display_name(self) -> str:
        return str(self.meta.get("display_name") or self.id)

    @property
    def description(self) -> str:
        return str(self.meta.get("description") or "")

    @property
    def defaults(self) -> dict:
        return dict(self.meta.get("defaults") or {})

    @property
    def bind(self) -> dict[str, list[dict]]:
        return dict(self.meta.get("bind") or {})

    @property
    def placeholders(self) -> dict[str, str]:
        """token -> 参数名，例如 {'__PROMPT__': 'prompt'}"""
        return dict(self.meta.get("placeholders") or {})

    @property
    def constraints(self) -> dict:
        return dict(self.meta.get("constraints") or {})

    @property
    def dynamic_blocks(self) -> list[dict]:
        """动态块：按请求里的 list 参数动态生成节点（如参考图 → LoadImage）。"""
        return list(self.meta.get("dynamic_blocks") or [])

    @property
    def dynamic_params(self) -> set[str]:
        return {str(b.get("param")) for b in self.dynamic_blocks if b.get("param")}

    @property
    def auto_resolution_from_size(self) -> bool:
        """是否按目标宽高自动推导 resolution（编辑模板用，保证参考图面积与画布对齐）。"""
        return bool(self.meta.get("auto_resolution_from_size"))

    @property
    def output_kind(self) -> str:
        """产出类型：image（默认）或 video。决定默认是否异步、以及是否强制返回 URL。"""
        return str(self.meta.get("output_kind") or "image").lower()

    @property
    def default_async(self) -> bool:
        """调用方没显式传 async 时的默认值。视频默认异步（要跑几分钟）。"""
        if self.meta.get("default_async") is not None:
            return bool(self.meta["default_async"])
        return self.output_kind == "video"

    @property
    def static_set(self) -> dict:
        """`meta.set`：渲染时**无条件覆盖**的节点输入。

        用途：让同一个模板派生出多个模型 —— 比如视频模板完全一样，
        只是底模 / LoRA / task_type 不同，就写三个 meta 共用一份 template.json。
        优先级最高（在参数绑定之后应用），所以调用方改不了这些值。
        """
        return dict(self.meta.get("set") or {})

    @property
    def extra(self) -> dict:
        return dict(self.meta.get("extra") or {})

    @property
    def output_node(self) -> str | None:
        v = self.meta.get("output_node")
        return str(v) if v is not None else None

    # ------------------------------------------------------------ 校验
    def validate(self) -> list[str]:
        """静态自检，返回问题列表（空 = 通过）。"""
        problems: list[str] = []
        if not isinstance(self.prompt, dict) or not self.prompt:
            problems.append("模板 prompt 为空或不是对象")
            return problems

        for node_id, node in self.prompt.items():
            if not isinstance(node, dict) or "class_type" not in node:
                problems.append(f"节点 {node_id} 缺少 class_type")
                continue
            if not isinstance(node.get("inputs", {}), dict):
                problems.append(f"节点 {node_id} 的 inputs 不是对象")

        for param, targets in self.bind.items():
            if not targets:
                problems.append(f"参数 {param} 的绑定为空")
            for t in targets or []:
                nid = str(t.get("node", ""))
                inp = t.get("input", "")
                if nid not in self.prompt:
                    problems.append(f"参数 {param} 指向不存在的节点 {nid}")
                    continue
                node_inputs = self.prompt[nid].get("inputs", {})
                key_exists = inp in node_inputs
                # 也允许绑定到连线槽位（后续由操作者保证存在）
                if not key_exists:
                    problems.append(f"参数 {param} 指向 {nid}.{inp}，但模板里没有这个输入键（会自动创建）")

        if not self.bind.get("prompt"):
            problems.append("模板没有绑定 prompt 参数")

        for blk in self.dynamic_blocks:
            param = blk.get("param")
            if not param:
                problems.append("动态块缺少 param")
                continue
            if not blk.get("node_id_format"):
                problems.append(f"动态块 {param} 缺少 node_id_format")
            if not blk.get("node_template", {}).get("class_type"):
                problems.append(f"动态块 {param} 的 node_template 缺少 class_type")
            for b in blk.get("binding") or []:
                if str(b.get("node")) not in self.prompt:
                    problems.append(f"动态块 {param} 绑定到不存在的节点 {b.get('node')}")

        for nid in self.static_set:
            if str(nid) not in self.prompt:
                problems.append(f"meta.set 指向不存在的节点 {nid}")

        return problems

    # ------------------------------------------------------ 参数归一化
    def normalize(self, raw: dict, *, max_batch: int) -> dict[str, Any]:
        """把 OpenAI 风格入参整理成可直接渲染的字典。"""
        c = self.constraints
        multiple = int(c.get("multiple_of", 16))
        lo = int(c.get("min_size", 256))
        hi = int(c.get("max_size", 2048))
        out: dict[str, Any] = {}

        # --- prompt ---
        prompt = raw.get("prompt")
        if prompt is not None:
            out["prompt"] = str(prompt)

        # --- 尺寸：显式 width/height 优先，否则解析 size，再否则用默认 ---
        width, height = raw.get("width"), raw.get("height")
        if width is None or height is None:
            parsed = parse_size(raw.get("size"))
            if parsed:
                width, height = (width or parsed[0]), (height or parsed[1])
        width = width if width is not None else self.defaults.get("width")
        height = height if height is not None else self.defaults.get("height")
        if width is not None and height is not None:
            w, h = int(width), int(height)
            # 总像素上限：防止手机原图（4032x3024）把画布顶到 3MP+ 导致又慢又掉质量
            max_pixels = int(c.get("max_pixels", 0) or 0)
            if max_pixels and w * h > max_pixels:
                scale = math.sqrt(max_pixels / (w * h))
                w, h = int(w * scale), int(h * scale)
            out["width"] = _snap(w, multiple, lo, hi)
            out["height"] = _snap(h, multiple, lo, hi)

        # --- 张数 ---
        n = raw.get("n")
        if n is not None:
            cap = min(int(max_batch), int(c.get("max_batch", max_batch)))
            out["batch_size"] = max(1, min(int(n), cap))

        # --- 采样相关 ---
        steps = raw.get("steps")
        if steps is not None:
            out["steps"] = max(
                int(c.get("min_steps", 1)),
                min(int(steps), int(c.get("max_steps", 150))),
            )

        # --- 视频帧数（H3 会自动对齐到 17n+5） ---
        length = raw.get("length")
        if length is None:
            # 模板用帧数、调用方习惯发秒数：meta 声明 duration_fps 时换算一次。
            # ref2v 那类工作流本身就是秒参数（在 bind 里），不走这里。
            fps = int(self.meta.get("duration_fps") or 0)
            duration = raw.get("duration")
            if fps and duration is not None and "length" in self.bind:
                try:
                    length = round(float(duration) * fps)
                except (TypeError, ValueError):
                    length = None
        if length is not None:
            out["length"] = max(
                int(c.get("min_length", 5)),
                min(int(length), int(c.get("max_length", 10000))),
            )

        seed = raw.get("seed")
        if seed is None:
            seed = random.randint(0, 2**63 - 1)
        out["seed"] = int(seed) % (2**63)

        neg = raw.get("negative_prompt")
        if neg is not None:
            out["negative_prompt"] = str(neg)

        # --- 编辑模板：按目标宽高推导 resolution，让参考图被缩放到与画布同面积 ---
        if (
            self.auto_resolution_from_size
            and "resolution" in self.bind
            and raw.get("resolution") is None
            and out.get("width")
            and out.get("height")
        ):
            step = int(c.get("resolution_step", 32))
            area = out["width"] * out["height"]
            out["resolution"] = _snap(
                int(round(math.sqrt(area))), step, step, int(c.get("max_resolution", 4096))
            )

        # --- 模板自定义参数透传（duration / mode 这类模板自有参数） ---
        # 这些参数不走 width/length/seed 那套专用分支，但同样要能覆盖默认值。
        known_params = (
            set(self.bind)
            | set(self.placeholders.values())
            | self.dynamic_params
            | set(self.defaults)
        )
        for k, v in raw.items():
            if k in known_params and k not in out and v is not None:
                out[k] = v

        # --- 默认值补齐（模板声明了默认、且请求没给） ---
        for k, v in self.defaults.items():
            out.setdefault(k, v)

        # --- 数值夹取 + 类型修正 ---
        # constraints.clamp = {"duration": [1, 15]} 、 constraints.int_params = ["mode"]
        # 用来支持「秒数」「模式开关」这类模板自有的参数。
        int_params = set(c.get("int_params") or [])
        for key, rng in (c.get("clamp") or {}).items():
            if key not in out or not isinstance(rng, (list, tuple)) or len(rng) != 2:
                continue
            try:
                v = float(out[key])
            except (TypeError, ValueError):
                continue
            v = max(float(rng[0]), min(float(rng[1]), v))
            out[key] = int(v) if key in int_params else v

        # --- 只保留模板真正认识（有绑定 / 占位符 / 动态块）的键 ---
        known = set(self.bind) | set(self.placeholders.values()) | self.dynamic_params
        return {k: v for k, v in out.items() if k in known or k == "seed"}

    # -------------------------------------------------------- 动态块注入
    def _inject_dynamic(self, prompt: dict, values: dict[str, Any]) -> None:
        """按 values 里的 list 参数生成节点并接线。

        例：Qwen-Image 2.1 的核心节点 `TextEncodeQwenImage21` 有个自动增长输入
        `images`，槽位名是 `image_1`..`image_16`，后端按数字后缀排序。
        所以参考图 i（0 基）要绑到 `images.image_{i1}`。
        """
        for blk in self.dynamic_blocks:
            param = str(blk["param"])
            # 参数压根没提供 -> 整块跳过。
            # 注意区别「没提供」和「提供了但是空」：min_items 只约束后者。
            # 视频模板的 first_frame 是 min_items=1，但纯文生视频本来就不该给首帧。
            if param not in values:
                # 除非显式标了 required —— 例如参考生视频，没参考图根本没法跑。
                if blk.get("required"):
                    raise TemplateError(
                        f"模板 {self.id}：必须提供 {param}"
                        f"（{blk.get('min_items', 1)}~{blk.get('max_items', 16)} 张）"
                    )
                continue
            items = values.get(param)
            if items in (None, ""):
                items = []
            if not isinstance(items, (list, tuple)):
                items = [items]
            items = [v for v in items if v not in (None, "")]

            min_items = int(blk.get("min_items", 0))
            if len(items) < min_items:
                raise TemplateError(
                    f"模板 {self.id}：参数 {param} 至少需要 {min_items} 项，收到 {len(items)} 项"
                )
            if not items:
                continue

            max_items = int(blk.get("max_items", 16))
            if len(items) > max_items:
                raise TemplateError(
                    f"模板 {self.id}：参数 {param} 最多 {max_items} 项，收到 {len(items)} 项"
                )

            node_tpl = blk.get("node_template") or {}
            id_fmt = str(blk["node_id_format"])
            for idx, item in enumerate(items):
                nid = str(_subst(id_fmt, idx, item))
                if nid in prompt:
                    raise TemplateError(f"模板 {self.id}：动态节点 id 冲突 {nid}")
                prompt[nid] = _subst(copy.deepcopy(node_tpl), idx, item)
                for b in blk.get("binding") or []:
                    target = str(b["node"])
                    if target not in prompt:
                        raise TemplateError(
                            f"模板 {self.id}：动态绑定指向不存在的节点 {target}"
                        )
                    key = str(_subst(b["input"], idx, item))
                    prompt[target].setdefault("inputs", {})[key] = [nid, 0]

    # -------------------------------------------------------------- 渲染
    def render(self, values: dict[str, Any]) -> dict:
        """把参数注入模板，返回可直接提交的 API 格式 prompt。"""
        p = copy.deepcopy(self.prompt)

        # 1) 占位符深替换（先做，保证被绑定覆盖时以绑定为准）
        table = {tok: values[param] for tok, param in self.placeholders.items() if param in values}
        if table:
            p = _deep_replace(p, table)

        # 2) 节点级绑定
        for param, targets in self.bind.items():
            if param not in values or values[param] is None:
                continue
            value = values[param]
            for t in targets or []:
                nid = str(t["node"])
                inp = str(t["input"])
                if nid not in p:
                    raise TemplateError(f"模板 {self.id}：绑定 {param} 指向不存在的节点 {nid}")
                p[nid].setdefault("inputs", {})[inp] = value

        # 3) 动态块（参考图 → 动态生成 LoadImage 并接线）
        self._inject_dynamic(p, values)

        # 4) meta.set：静态覆盖，优先级最高（模型身份，不允许调用方改）
        for nid, kv in self.static_set.items():
            nid = str(nid)
            if nid not in p:
                raise TemplateError(f"模板 {self.id}：meta.set 指向不存在的节点 {nid}")
            for key, val in (kv or {}).items():
                p[nid].setdefault("inputs", {})[key] = val

        return p

    # ---------------------------------------------------------- 对外描述
    def describe(self) -> dict:
        """给 /v1/models 用的模型卡片。"""
        return {
            "id": self.id,
            "object": "model",
            "created": 0,
            "owned_by": "comfy-adapter",
            "display_name": self.display_name,
            "description": self.description,
            "capabilities": self.meta.get("capabilities") or {"image_generation": True},
            "defaults": self.defaults,
            "constraints": self.constraints,
            "supports": sorted(
                (
                    set(self.bind)
                    | set(self.placeholders.values())
                    | self.dynamic_params
                    | self.defaults.keys()
                ) - {"seed"}
            ),
            "dynamic_params": {b["param"]: int(b.get("max_items", 16)) for b in self.dynamic_blocks},
        }


# ---------------------------------------------------------------- 加载


def load_template(meta_path: str | Path) -> WorkflowTemplate:
    meta_path = Path(meta_path)
    if not meta_path.is_absolute():
        from .config import ROOT

        meta_path = ROOT / meta_path

    if not meta_path.exists():
        raise TemplateError(f"找不到模型定义文件: {meta_path}")

    with open(meta_path, "r", encoding="utf-8-sig") as f:
        meta = json.load(f)

    tpl_rel = meta.get("template") or meta_path.name.replace(".meta.json", ".json")
    tpl_path = (meta_path.parent / tpl_rel) if not Path(tpl_rel).is_absolute() else Path(tpl_rel)
    if not tpl_path.exists():
        raise TemplateError(f"找不到模板文件: {tpl_path}")

    with open(tpl_path, "r", encoding="utf-8-sig") as f:
        prompt = json.load(f)

    model_id = meta.get("id") or tpl_path.stem
    return WorkflowTemplate(id=str(model_id), prompt=prompt, meta=meta, source=tpl_path)


def load_templates(meta_paths: list[str]) -> dict[str, WorkflowTemplate]:
    templates: dict[str, WorkflowTemplate] = {}
    for mp in meta_paths:
        tpl = load_template(mp)
        if tpl.id in templates:
            raise TemplateError(f"模型 id 重复: {tpl.id}")
        templates[tpl.id] = tpl
        log.info("已加载模型 %s (%s) <- %s", tpl.id, tpl.display_name, tpl.source)
    return templates
