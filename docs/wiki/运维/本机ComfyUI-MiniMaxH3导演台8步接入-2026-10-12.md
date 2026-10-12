# 本机 ComfyUI MiniMax H3 导演台 8 步接入

> 日期：2026-10-12 · 状态：**本地源码已登记，NewAPI 上传、渠道配置、GPU 实际生成与扣费尚未验收**

## 接入参数

| 项目 | 配置 |
|---|---|
| 面板模型名 / NewAPI 公开模型名 | `jc-minimax-h3-director8` |
| Task Plugin | `comfy`，版本 `0.3.2` |
| comfy-adapter 内部模型 ID | `minimax-h3-director8` |
| 工作流 | `comfy-adapter/workflows/minimax-h3-director8.json` |
| 模型定义 | `comfy-adapter/workflows/minimax-h3-director8.meta.json` |
| 面板字段 | 提示词、时长（0.2–120 秒，默认 5 秒，步进 0.1 秒）、参考图（1–9 张）、输出分辨率 |
| 内部固定项 | 单个 R2V 组、8 步；采样参数不在面板开放 |
| 后处理 | 保留附件中的 TopazLocalUpscale，1.5× |
| 面板单价 | `0.2/秒` |
| Task Usage | `tier("base", u("seconds") * 0.2)` |

计费表达式读取 `comfy` 插件声明的 `seconds` 用量。`decodeRequest` 将面板时长按 0.1 秒精度归一化并限制在 0.2–120 秒，再把该值用于用量预约和适配器工作流；任务完成时优先读取适配器归一化后的时长结算，响应缺少时回退到提交时长。默认 5 秒。NewAPI 的模型/分组倍率仍可能影响实扣，需用真实任务账单核对。

## 工作流处理

- 以用户提供的 `MiniMax H3 导演台8步0.9.json` 为底稿，保留 H3 模型、8 步采样、音视频输出与 Topaz 后处理节点。
- 清空附件里的示例时间轴与剧情提示，避免样例对白、示例人物和本机素材路径成为新模型的默认内容。
- 新增 `MiniMaxH3DirectorGroupReferenceToVideo`，把应用提示词、时长和动态参考图接到单个外部 R2V 组，并连到导演台 `r2v_groups`；导演台分辨率由面板 `size` 转换成 `width` / `height`。
- 附件的 Topaz 节点包含 Windows 本机路径。GPU 工作机必须有对应自定义节点、Topaz 可执行文件和模型；应用选择的尺寸指导演台生成画布，最终视频会再经 1.5× 放大。

上游节点说明：外接组可直接接到导演台 `r2v_groups`；外接组提供提示词、时长与参考图，输出画布尺寸由导演台控制。节点时长输入范围为 0.2–120 秒、步进 0.1 秒；参考图槽支持最多 9 张。8 步工作流的帧数按导演台规则对齐。见 [MiniMax H3 Director 上游 README](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/blob/main/README_EN.md)、[外接组节点源码](https://raw.githubusercontent.com/AIMixer/ComfyUI_MiniMaxH3_Director/main/nodes/director_groups.py) 和 [时间轴帧数实现](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/blob/main/director/fl2v_timeline.py)。

## NewAPI / 本机部署待办

1. 上传并激活 `newapi-plugins/comfy.plugin.js` 的 `comfy` v0.3.2。
2. type 61 渠道模型列表加入公开名 `jc-minimax-h3-director8`，模型映射指向 `minimax-h3-director8`。
3. 给该模型设置 Task Usage 表达式：

   ```text
   tier("base", u("seconds") * 0.2)
   ```

4. 将 `workflows/minimax-h3-director8.meta.json` 加入 GPU 工作机 `comfy-adapter/config.yaml` 的 `models` 并重启适配器。
5. 确认本机 ComfyUI 已安装上游 Director 节点与 Topaz 节点/模型后，完成一次图生视频、结果下载和实际账单核对。

以上生产步骤尚未执行。本地 ComfyUI 当前不可连接，故未完成真实生成验收；未运行项目测试。
