# video-composer

视频合成工具 v1.0 - 拼接视频并添加字幕

## 快速开始

### 基础拼接

```bash
python3 ~/.openclaw/skills/video-composer/scripts/compose.py \
  --input shot_001.mp4 shot_002.mp4 shot_003.mp4 \
  --output final.mp4
```

### 拼接 + 字幕

```bash
python3 ~/.openclaw/skills/video-composer/scripts/compose.py \
  --input shot_001.mp4 shot_002.mp4 shot_003.mp4 \
  --subtitles subtitles.srt \
  --output final.mp4
```

### 使用配置文件

```bash
python3 ~/.openclaw/skills/video-composer/scripts/compose.py \
  --config project.json
```

## 生成字幕文件

从镜头数据生成 SRT：

```bash
python3 ~/.openclaw/skills/video-composer/scripts/srt_generator.py \
  --shots shots.json \
  --output subtitles.srt
```

镜头数据格式（shots.json）：
```json
[
  {
    "台词": "你好吗？",
    "时长": 3.0
  },
  {
    "台词": "我很好，谢谢。",
    "时长": 4.0
  }
]
```

## 在 drama-producer 中使用

drama-producer agent 可以直接调用此 skill：

```markdown
使用 video-composer 合成视频
```

## 依赖

- ffmpeg（必须已安装）

检查 ffmpeg：
```bash
ffmpeg -version
```

## 版本规划

- **v1.0（当前）**：视频拼接 + 字幕
- **v1.1（计划）**：背景音乐（BGM）
- **v1.2（计划）**：配音（TTS）
- **v1.3（计划）**：音效（SFX）

## 文件结构

```
video-composer/
├── skill.md                    # Skill 定义
├── README.md                   # 使用文档
├── example_config.json         # 配置示例
└── scripts/
    ├── compose.py              # 主程序
    └── srt_generator.py        # SRT 生成工具
```
