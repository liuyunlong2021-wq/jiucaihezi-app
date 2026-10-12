# 本机 ComfyUI MiniMax H3 导演台 8 步接入

> 日期：2026-10-12 · 状态：**本地源码已登记，NewAPI 上传、渠道配置、GPU 实际生成与扣费尚未验收**

## 接入参数

| 项目 | 配置 |
|---|---|
| 面板模型名 / NewAPI 公开模型名 | `jc-minimax-h3-director8` |
| Task Plugin | `comfy`，版本 `0.3.3` |
| comfy-adapter 内部模型 ID | `minimax-h3-director8` |
| 工作流 | `comfy-adapter/workflows/minimax-h3-director8.json` |
| 模型定义 | `comfy-adapter/workflows/minimax-h3-director8.meta.json` |
| 面板字段 | 提示词、时长（0.2–120 秒，默认 5 秒，步进 0.1 秒）、参考图（1–9 张）、输出分辨率 |
| 内部固定项 | 单个 R2V 组、8 步；采样参数不在面板开放 |
| 后处理 | 保留附件中的 TopazLocalUpscale，1.5× |
| 面板单价 | `0.2/秒` |
| Task Usage | `tier("base", u("seconds") * 0.2)` |

计费表达式读取 `comfy` 插件声明的 `seconds` 用量。`decodeRequest` 将面板时长按 0.1 秒精度归一化并限制在 0.2–120 秒，再把该值用于用量预约和适配器工作流；任务完成时若响应有时长则优先读取，当前视频查询响应不含时长，因此从任务快照回退到归一化后的提交时长。默认 5 秒。NewAPI 的模型/分组倍率仍可能影响实扣，需用真实任务账单核对。

## 工作流处理

- 以用户提供的 `MiniMax H3 导演台8步0.9.json` 为底稿，保留 H3 模型、8 步采样、音视频输出与 Topaz 后处理节点。
- 清空附件里的示例时间轴与剧情提示，避免样例对白、示例人物和本机素材路径成为新模型的默认内容。
- 新增 `MiniMaxH3DirectorGroupReferenceToVideo`，把应用提示词、时长和动态参考图接到单个外部 R2V 组，并连到导演台 `r2v_groups`；导演台分辨率由面板 `size` 转换成 `width` / `height`。
- 附件的 Topaz 节点包含 Windows 本机路径。GPU 工作机必须有对应自定义节点、Topaz 可执行文件和模型；应用选择的尺寸指导演台生成画布，最终视频会再经 1.5× 放大。

上游节点说明：外接组可直接接到导演台 `r2v_groups`；外接组提供提示词、时长与参考图，输出画布尺寸由导演台控制。节点时长输入范围为 0.2–120 秒、步进 0.1 秒；参考图槽支持最多 9 张。8 步工作流的帧数按导演台规则对齐。见 [MiniMax H3 Director 上游 README](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/blob/main/README_EN.md)、[外接组节点源码](https://raw.githubusercontent.com/AIMixer/ComfyUI_MiniMaxH3_Director/main/nodes/director_groups.py) 和 [时间轴帧数实现](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/blob/main/director/fl2v_timeline.py)。

## NewAPI / 本机部署待办

1. 上传并激活 `newapi-plugins/comfy.plugin.js` 的 `comfy` v0.3.3。
2. 复用现有本机 ComfyUI 的 Task Plugin（type 61）渠道，插件选择 `comfy`；Base URL 使用 NewAPI 容器可达的 `http://frps:8796`（不加 `/v1`），密钥沿用适配器 `config.yaml` 的 `auth.api_keys`，不是用户 NewAPI Token。模型列表加入公开名 `jc-minimax-h3-director8`，保留原模型与原映射，并追加：

   ```json
   { "jc-minimax-h3-director8": "minimax-h3-director8" }
   ```

   渠道分组须与调用 Token 的分组匹配；若 Token 开启模型限制，也加入该公开模型名。
3. 给该模型设置 Task Usage 表达式：

   ```text
   tier("base", u("seconds") * 0.2)
   ```

4. 将 `workflows/minimax-h3-director8.meta.json` 加入 GPU 工作机 `comfy-adapter/config.yaml` 的 `models` 并重启适配器。
5. 确认本机 ComfyUI 已安装上游 Director 节点与 Topaz 节点/模型后，完成一次图生视频、结果下载和实际账单核对。

## Windows 本机复检

- 插件修正为 v0.3.3：公开/内部模型映射后的结算判定均可识别；宿主轮询上下文没有 `requestBody`，因此提交时将归一化时长保存到 `taskData.duration`，查询时从 `ctx.data` 回退。缺参考图、超过 9 张或首尾帧参数在提交前拒绝。
- 本机运行配置 `comfy-adapter/config.yaml` 已追加新 meta；该文件被 Git 忽略。当前 9000 端口进程仍加载旧三个模型，需要重启适配器后用 `/v1/models` 确认 `minimax-h3-director8` 出现。任务记录在内存，重启会清除旧任务查询记录；已有产物文件保留。
- ComfyUI 8188 已在线；新模板的所有节点、四个模型文件枚举及三个 Topaz 路径已核对。1 张/9 张参考图的模板接线、提示词、时长、尺寸与缺图/过量图约束验证通过；未提交 GPU 生成任务。
- 全部模板自检另发现旧 `minimax-h3` 引用的 `minimax_h3_hybrid_fl2va_ref2va_b25-49.safetensors` 不在当前模型列表中；该项属于旧模型问题，新导演台所需文件均存在，本次未修改旧模型。
- 计费事实是归一化后的请求时长，当前 `/v1/videos/{id}` 不提供实际 MP4 秒数。H3 帧数会对齐，实际视频时长可能略有差异，不能将本项称作实际成片秒数结算。
- `node --test newapi-plugins/__tests__/comfy.test.mjs` 24/24 通过，`git diff --check` 通过；未执行 NewAPI 二进制 lint/Sandbox。NewAPI 上传/激活、渠道配置、GPU 成片、下载和实扣仍待验收。
