# 本机 MLX 安装与使用说明

## 适用范围

本功能只适用于 Apple Silicon Mac（M1、M2、M3、M4）。韭菜盒子不会下载模型，也不会替用户安装 Python 环境。

## 首次准备

在终端执行一次：

```bash
python3 -m venv ~/mlx-env
source ~/mlx-env/bin/activate
pip install -U pip mlx-lm
```

下载一个 MLX 模型。可以使用 Hugging Face 上的 MLX 模型，或使用已经存在的本地模型目录。记住模型目录路径，例如：

```text
/Users/你的用户名/MLX/Qwen3.8-27B-Uncensored-MLX/6-bit
```

## 在韭菜盒子中连接

1. 打开设置中的“本机 MLX”。
2. 第一次填写模型路径或仓库 ID。
3. 点击“启动并连接”。
4. 等待显示“已连接 MLX”和模型数量。
5. 在顶部模型菜单选择 MLX 模型。

以后打开 App 只需再次点击“启动并连接”，不需要手动打开终端。

## 常见问题

- 显示“找不到 mlx_lm.server”：确认虚拟环境已安装 `mlx-lm`，并把模型放在该虚拟环境目录附近（App 会自动寻找 `.venv/bin/mlx_lm.server`）。
- 显示“模型路径不能为空”：首次使用必须填写本地模型目录或 Hugging Face 模型 ID。
- 显示“服务未就绪”：模型首次加载需要时间；检查内存是否足够，并确认没有其他程序占用配置的端口。
- MLX 服务运行时会占用较多统一内存。建议先使用 4-bit 或 6-bit 模型，并为 macOS 和 KV Cache 留出空间。

## 与 Ollama 的区别

Ollama 自带后台服务管理；MLX 由用户安装和管理运行环境。韭菜盒子只负责在已有环境上自动启动、连接和回收自己启动的服务进程。
