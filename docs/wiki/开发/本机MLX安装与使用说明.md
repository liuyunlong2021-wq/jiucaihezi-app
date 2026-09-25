# 本机模型端点安装与使用说明

> 2026-09-25 起，「本机 MLX」独立入口已并入设置中的**自定义端点（OpenAI 兼容）**：`local-mlx` Provider、`start_mlx_service` 与 `mlx_lm.server` 自动启动均已移除。本文件改为通用的本机端点接入说明；原 MLX 专属流程见 [[开发/通用记忆工作台本机MLX自动启动与连接TDD-2026-08-30]]。

## 适用范围

本机端点只在 Desktop 设置里提供（Web / Mobile 不显示入口）。韭菜盒子不下载模型、不安装 Python 环境、不管理服务进程：模型由你自己下载，服务由你自己启动，App 只负责连接。

## 首次准备

以 mlx-optiq 为例（Apple Silicon，Python 3.11+）：

```bash
python3 -m venv ~/.jiucaihezi/mlx-optiq-env
~/.jiucaihezi/mlx-optiq-env/bin/pip install -U pip mlx-optiq
# Hugging Face 直连不通时走镜像
HF_ENDPOINT=https://hf-mirror.com ~/.jiucaihezi/mlx-optiq-env/bin/optiq serve \
  --model mlx-community/LensVLM-9B-OptiQ-4bit --port 8081
```

其他可用后端：LM Studio（`lms server start`，默认 1234）、`mlx_vlm.server`、llama.cpp、vLLM。只要提供 `/v1/chat/completions` 就能接。

## 在韭菜盒子中连接

1. 打开设置 → 账号 → 展开「本机模型与服务」。
2. 在「自定义端点」点「添加端点」。
3. 填写名称、端点地址（如 `http://127.0.0.1:8081`）、可选 API Key、模型 ID（逗号或换行分隔）。
4. 保存后，在顶部模型菜单的「自定义端点」分组里选择该模型。

端点地址规则：本机回环可以用 `http`，非本机地址必须用 `https`；地址里不能写账号、密码、查询参数或片段。

## 常见问题

- **端口被占用**：先确认端口上没有别的服务（例如本机 ComfyUI 的自定义节点会占用 8080），换一个端口并同步修改设置里的地址。
- **模型列表为空**：`curl http://127.0.0.1:8081/v1/models` 应该有返回；没有返回说明服务没起来或端口不对。
- **选它聊天很奇怪**：`mlx-community/LensVLM-9B-OptiQ-4bit` 是文档阅读模型（扫压缩页图 + `read_page` 回读），不是通用对话模型。
- **上下文预算**：自定义端点按本地保守值对待（`32K` 输入 / `4K` 输出），不会套用云端 `1M/128K`。
- **绝不回落云端凭据**：自定义端点只用它自己的 API Key；没填就不发鉴权头。

## 与 Ollama 的区别

Ollama 自带后台服务管理；MLX 由用户安装和管理运行环境。韭菜盒子只负责在已有环境上自动启动、连接和回收自己启动的服务进程。
