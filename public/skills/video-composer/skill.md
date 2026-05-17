---
name: video-composer
description: 视频合成工具 — 拼接视频片段并添加字幕
version: 1.0.0
---

# video-composer

视频合成工具，支持视频拼接和字幕添加。

## 功能

**v1.0（当前版本）**：
- 视频拼接（多个片段合成一个完整视频）
- 字幕添加（SRT 格式）

**未来版本**：
- v1.1：背景音乐（BGM）
- v1.2：配音（TTS）
- v1.3：音效（SFX）

## 使用方式

### 方式1：命令行

```bash
# 基础拼接
video-composer --input shot_001.mp4 shot_002.mp4 shot_003.mp4 --output final.mp4

# 拼接 + 字幕
video-composer \
  --input shot_001.mp4 shot_002.mp4 shot_003.mp4 \
  --subtitles subtitles.srt \
  --output final.mp4

# 使用通配符
video-composer --input /tmp/shots/*.mp4 --output final.mp4
```

### 方式2：配置文件

```bash
video-composer --config project.json
```

配置文件格式：
```json
{
  "video": {
    "clips": ["shot_001.mp4", "shot_002.mp4", "shot_003.mp4"]
  },
  "subtitles": {
    "file": "subtitles.srt"
  },
  "output": "final.mp4"
}
```

## 参数说明

- `--input`: 输入视频文件列表（按顺序）
- `--subtitles`: 字幕文件（SRT 格式）
- `--output`: 输出文件路径
- `--config`: 配置文件路径（JSON 格式）

## 依赖

- ffmpeg（必须已安装）

## 示例

### 示例1：简单拼接

```bash
video-composer \
  --input shot_001.mp4 shot_002.mp4 shot_003.mp4 \
  --output final.mp4
```

### 示例2：拼接并添加字幕

```bash
video-composer \
  --input shot_001.mp4 shot_002.mp4 shot_003.mp4 \
  --subtitles subtitles.srt \
  --output final.mp4
```

### 示例3：使用配置文件

```bash
video-composer --config project.json
```

## 在 Agent 中使用

```markdown
使用 video-composer skill 合成视频
```

Agent 会自动调用 skill 并传入参数。
