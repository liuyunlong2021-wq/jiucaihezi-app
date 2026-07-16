# JC-口播 安装说明

## 推荐：共享 Skill 目录

在 `JC-口播` 目录执行：

```bash
./install.sh
```

默认安装到：

```text
~/.agents/skills/JC-口播/
```

这是共享源目录，适合多个 Agent 共用。

## 指定 Agent

```bash
./install.sh --codex
./install.sh --claude
./install.sh --all
```

默认使用软链接，目标指向当前 Skill 源目录。这样只维护一份代码。

如果不希望使用软链接：

```bash
./install.sh --copy --all
```

安装器不会静默覆盖已有目录。如果目标已经存在，请先确认它不是另一份正在使用的 Skill，再手动移走后重试。

## 运行依赖

- Python 3.10+
- `openai-whisper`：`pip install -U openai-whisper`
- FFmpeg-full，必须包含 `libass`、`subtitles`、`ass`、`chromakey` 和 `overlay`
- Node.js 22+
- HyperFrames：`npm install -g hyperframes`

字体 `fonts/俊雅锐宋.otf` 已内置。正式商业发布前请确认字体授权。
