---
name: jc-watch
display_name: 看视频
description: Use when 用户给出一个视频链接或本地视频文件，要求分析、拆解、总结、提问、找问题、提取文案字幕、对比参考视频或基于视频内容创作。触发词：看视频、拆解视频、分析视频、总结视频、这个视频讲了什么、帮我看看这个视频、视频转文字、提取视频文案、提取字幕、录屏哪里出问题、竞品视频拆解、参考视频分析、爆款拆解、jc-watch。不用于生成视频、剪辑视频或单纯的视频转码压缩。
triggers:
  - '看视频'
  - '拆解视频'
  - '分析视频'
  - '总结视频'
  - '视频转文字'
  - '提取视频文案'
  - '竞品视频拆解'
allowed-tools:
  - read
  - terminal
---

# jc-watch（看视频）

把视频变成看得见、听得见的内容：脚本下载视频、按预算抽帧、拿到带时间戳的转录，输出一份 markdown 报告；**你必须用 `read` 工具逐张读报告里的帧图**，再结合转录回答。不读帧图就等于没看视频。

## 指令

```commands
看视频：<视频链接或本地文件路径>
拆解这个视频：<链接>，重点讲开头钩子、节奏和结构
这个视频讲了什么：<链接>
提取视频文案：<链接>
这个录屏哪里出问题了：<本地文件路径>
```

## 运行

脚本在固定路径（技能目录在运行时是 HTTP 资源路径，拿不到文件系统路径，所以脚本必须落在本机固定位置）：

```bash
python3 ~/.jiucaihezi/tools/jc-watch/jc_watch.py "<视频链接或本地路径>" [参数]
```

若该路径不存在，先用 `terminal` 部署一次：

```bash
mkdir -p ~/.jiucaihezi/tools && ln -sfn "<应用仓库>/public/skills/jc-watch/scripts" ~/.jiucaihezi/tools/jc-watch
```

（找不到仓库路径时，改用 `cp` 把技能自带的 `scripts/*.py` 复制到 `~/.jiucaihezi/tools/jc-watch/`。）

## 流程

1. **跑脚本**：`terminal` 调用上面的命令，拿到 markdown 报告。
2. **读帧图**：报告 `## Frames` 段列出帧路径，逐个用 `read` 读取——图片会作为画面进入上下文，这才是"看"。
3. **读转录**：报告 `## Transcript` 段是带 `[MM:SS]` 时间戳的台词。
4. **回答**：结论必须落在你实际看到的画面和听到的台词上，不要根据标题或常识推测。

## 参数

| 参数 | 用途 |
|---|---|
| `--detail transcript` | 只要台词，不抽帧。最省，适合纯口播、提取文案 |
| `--detail efficient` | 抽关键帧（上限 50），最快，适合快速过一遍 |
| `--detail balanced` | 场景变化抽帧（上限 100），默认档 |
| `--detail token-burner` | 不设上限，保留所有场景帧，最细最贵 |
| `--start 1:30 --end 2:00` | 只分析指定区间。帧密度自动提高，长视频强烈建议用 |
| `--timestamps 0:05,1:20` | 指定时间点补抓帧，用于精确定位某个瞬间 |
| `--language zh` | 语音语言，默认 `auto`。中文视频建议显式传 `zh` |
| `--whisper-model <路径>` | 指定 whisper 模型，默认自动查找常用目录 |
| `--no-whisper` | 禁用转录（无字幕时只给画面） |
| `--no-dedup` | 关闭近似帧去重（默认开启，静态录屏可省大量 token） |
| `--max-frames N` | 覆盖帧数上限 |
| `--out-dir <目录>` | 指定工作目录（默认临时目录，用完即删） |

## 依赖与排错

| 依赖 | 缺失时的处理 |
|---|---|
| `yt-dlp` | 只能处理本地文件。提示用户 `brew install yt-dlp` |
| `ffmpeg` / `ffprobe` | 无法抽帧。提示用户 `brew install ffmpeg` |
| `whisper-cli` + ggml 模型 | 无字幕视频拿不到台词，只能靠画面。提示用户 `brew install whisper-cpp`，模型见下 |

whisper 模型查找顺序：`--whisper-model` → `$JC_WATCH_WHISPER_MODEL` → `$WHISPER_MODEL` → `~/.cache/whisper.cpp/` → `~/.jiucaihezi/tools/whisper-models/`。没有多语言模型时提示：

```bash
mkdir -p ~/.cache/whisper.cpp && curl -L -o ~/.cache/whisper.cpp/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

注意：`for-tests-ggml-*.bin` 是 whisper.cpp 的 CI 空壳模型，转录结果为空，不是可用模型。

## 取舍

- **转录免费且离线**：走本机 whisper.cpp，不消耗 API 额度，视频不出本机。
- **token 花在帧上**：10 分钟以上的视频默认最多 100 帧，覆盖会很稀。长视频先问用户要看哪一段，用 `--start/--end` 聚焦，比全片扫一遍有用得多。
- **字幕优先**：有平台字幕时直接抓字幕，不跑 whisper（快得多）。中文优先、英文次之。
- **平台上限**：能下什么取决于用户网络能访问什么；访问不到的平台如实说明，不要编造视频内容。
