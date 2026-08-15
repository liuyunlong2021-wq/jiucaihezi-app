# ComfyUI-Jiucaihezi

一个图片节点覆盖韭菜盒子目前已验证的 7 个异步图片模型。控件只有 API Key、模型、提示词、分辨率、比例和最多 8 张参考图；分辨率和比例与创作面板一致，并会随模型切换为实际可用项。输出可直接连接 ComfyUI 的 `IMAGE` 输入。

| 模型 | 尺寸 |
|---|---|
| GPT Image 2 1K | `1k` |
| GPT Image 2 低质量 / 中质量 / VIP / 官方 | `1k`、`2k`、`4k` |
| Gemini 3.1 Flash Image / Gemini 3 Pro Image | `1k`、`2k` |

GPT 的比例项包含 App 已支持的 `1:1`、`2:3`、`3:2`、`4:5`、`5:4`、`4:3`、`3:4`、`16:9`、`9:16`、`21:9`。Gemini 上游没有比例参数，因此会隐藏比例控件。

安装到 ComfyUI：

```bash
cp -R comfyui-jiucaihezi /Users/by3/Documents/ComfyUI/custom_nodes/
```

重启 ComfyUI 后，在“添加节点 -> Jiucaihezi”中选择“韭菜盒子 图片生成”，并在节点内填 API Key。节点不会读取或写入韭菜盒子 Desktop 的设置和项目文件。

Key 是 ComfyUI 密码输入；不要把含 Key 的工作流分享给他人。节点只将结果交给 ComfyUI 画布；接上 ComfyUI 自带的 `Save Image` 后，图片写到本机 `Documents/ComfyUI/output`。请求使用韭菜盒子当前的异步图片合同：提交到 `/v1/videos`，完成前轮询 `/v1/videos/{taskId}`。
