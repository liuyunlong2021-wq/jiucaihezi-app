---
name: jc-watch
display_name: 看视频
description: Use when 用户给出一个视频链接或本地视频文件，要求把视频反推成 MiniMax H3 或 Seedance 视频提示词，或要求分析、拆解、总结、提问、找问题、提取文案字幕、对比参考视频或基于视频内容创作。触发词：看视频、视频转提示词、反推提示词、扒提示词、复刻这个视频、转H3、转Seedance、拆解视频、分析视频、总结视频、这个视频讲了什么、帮我看看这个视频、视频转文字、提取视频文案、提取字幕、录屏哪里出问题、竞品视频拆解、参考视频分析、爆款拆解、jc-watch。不用于生成视频、剪辑视频或单纯的视频转码压缩。
triggers:
  - '看视频'
  - '视频转提示词'
  - '反推提示词'
  - '扒提示词'
  - '复刻这个视频'
  - '转H3'
  - '转Seedance'
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
看视频：<视频链接或本地文件路径>，转 H3 提示词
看视频：<视频链接或本地文件路径>，转 Seedance 提示词
看视频：<视频链接或本地文件路径>
拆解这个视频：<链接>，重点讲开头钩子、节奏和结构
这个视频讲了什么：<链接>
提取视频文案：<链接>
这个录屏哪里出问题了：<本地文件路径>
```

## 运行

脚本必须落在本机固定位置：技能目录在运行时是 HTTP 资源路径，拿不到文件系统路径。

### 1. 探测 Python 解释器

各平台的可执行名不一样，**按顺序试，用第一个能打印出版本号的**：

```bash
python3 --version    # macOS / Linux 首选
python  --version    # Windows 首选
py -3   --version    # Windows 启动器兜底
```

> Windows 上 `python3` 常常是**微软商店的占位符**，会打印
> `Python was not found; run without arguments to install from the Microsoft Store`
> 并返回退出码 **9009**。看到这个直接换下一个解释器，别在原地反复重试。

### 2. 确认脚本已落地

```bash
<解释器> <用户目录>/.jiucaihezi/tools/jc-watch/jc_watch.py --help
```

`<用户目录>` 取 `$HOME`（macOS / Linux）或 `$env:USERPROFILE`（Windows）。

### 3. 未落地就部署一次

把技能自带的 `scripts/*.py`（共 6 个）复制到 `~/.jiucaihezi/tools/jc-watch/`，**平铺放，不要再套一层 `scripts/`**。

macOS / Linux：

```bash
mkdir -p ~/.jiucaihezi/tools/jc-watch && cp "<技能目录>/scripts/"*.py ~/.jiucaihezi/tools/jc-watch/
```

Windows（PowerShell）：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.jiucaihezi\tools\jc-watch" | Out-Null
Copy-Item "<技能目录>\scripts\*.py" "$env:USERPROFILE\.jiucaihezi\tools\jc-watch\"
```

**不要用 `ln -s` / `mklink` 建符号链接**：Windows 创建符号链接需要管理员权限或开发者模式，普通用户机器上大概率失败，而且失败方式很难诊断。复制是唯一跨平台可靠的部署方式，这几个文件只有几十 KB。

落地后的路径就是 `~/.jiucaihezi/tools/jc-watch/jc_watch.py`，**没有 `scripts/` 这一层**；而仓库里的布局是 `skills/jc-watch/scripts/`。两者不一样，排错时别混用。

### 4. 跑

```bash
<解释器> ~/.jiucaihezi/tools/jc-watch/jc_watch.py "<视频链接或本地路径>" [参数]
```

## 流程

1. **跑脚本**：`terminal` 调用上面的命令，拿到 markdown 报告。
2. **读帧图**：报告 `## Frames` 段列出帧路径，逐个用 `read` 读取——图片会作为画面进入上下文，这才是"看"。
3. **读转录**：报告 `## Transcript` 段是带 `[MM:SS]` 时间戳的台词。
4. **回答**：结论必须落在你实际看到的画面和听到的台词上，不要根据标题或常识推测。

当前模型能直接接收视频附件（如 Gemini 原生读 MP4，画面和声音都在上下文里）时，直接看，不跑脚本；看不了才走上面的抽帧链路。

## 视频转提示词

用户要把视频变成 H3 或 Seedance 提示词时走这一段。用户没说哪个模型就只问一句「H3 还是 Seedance」，不猜、不两个都写。

1. **抽帧**：1 分钟以内用 `--detail token-burner --no-dedup --language zh`，保留每个场景切换帧；更长的先问用户要哪段，用 `--start/--end`。报告里 `reason=scene` 的帧时间就是镜头切点。报告写 `uniform fallback`、没有 `reason=scene` 帧时，说明没检测到切点：按相邻帧判断是一镜到底（含推拉摇移）还是漏检，别默认只有一个固定镜头。每个镜头至少看到开头、中间、结尾三张帧，不够就用 `--timestamps` 补抓再读。
2. **先拆逐镜表（内部，不交付）**：每镜写起止秒、景别、角度、运镜、人物位置与朝向、动作与接触、表情、逐字台词及说话人、看得见的音效来源。看不到、听不到的不写；同一角色跨镜用同一个称呼（如"红衣女子"）。转录里的现场口令（"三二一开始""卡"等打板、导演喊话）不是台词，剔除；说话人看不到口型时记为画外声。
3. **按模型上限分段**：H3 每段 4–15 秒，Seedance 每段 ≤30 秒；优先在镜头切点处分段；单个连续镜头超过上限时，在动作停顿、无台词的瞬间切开，后一段开头写清前一段末尾的人物姿态、位置和机位，H3 可改用 I2VA 拿该时刻的截帧当首帧。不为凑时长删台词或动作。每段时间从 0 起，独立可提交。
4. **按对应 Skill 的格式写**，格式规则只认那边，这里不另定：
   - H3：read [H3](../h3-prompt-writing/SKILL.md)。默认 T2VA（读 `references/base-en.txt`）；用户要用视频截帧当首帧时用 I2VA，并把该帧路径告诉用户；用户给了角色/场景参考图时用 Ref2VA（读 `references/ref-en.txt`）。
   - Seedance：read [Seedance](../jc-seedance/SKILL.md)，交付五模块。视频里的人物、场景、剧情道具按首次出现顺序列 @图槽位，用逐镜表里的称呼命名，用户之后按顺序上传参考图即可。
5. **不走漫剧 Wiki 流程**：两个 Skill 里的 wiki_read_guidance、读工程稿、自动 wiki_save_artifact 只适用于漫剧制作；视频转提示词按普通模式，不读 Wiki、不自动保存，用户明确说保存到项目才存。
6. **声音如实**：抽帧链路只拿到台词文字，听不到音色、BGM 和细碎环境声。Seedance 的声音九维按画面可见的年龄、性别、情绪写保守描述；H3 的 soundscape 只写画面里有声源的声音，`non_diegetic_music` 无依据时写无。提示词正文之外用一句话告诉用户哪些声音是推测、哪些没有转录；没转录到台词时不编台词。
7. **交付**：先给一行分段表（段号、原视频起止秒、镜头数），再逐段给可直接复制的提示词。分段表和推测说明不进提示词正文。

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

| 依赖 | 缺了会怎样 | 安装 |
|---|---|---|
| `ffmpeg` / `ffprobe` | 抽不了帧，整个技能不可用 | macOS `brew install ffmpeg` · Windows `winget install Gyan.FFmpeg`（或 `choco install ffmpeg`）· Linux `apt install ffmpeg` |
| `yt-dlp` | 只能处理本地文件，链接下不了 | macOS `brew install yt-dlp` · Windows `winget install yt-dlp.yt-dlp` · Linux `pipx install yt-dlp` |
| `whisper-cli` + ggml 模型 | 拿不到台词，报告 `Transcript` 段为空，只能靠画面 | 见下 |

### whisper 模型发现顺序

桌面端应用和本脚本**共用同一份约定**，所以放一个地方两边都能用。按顺序找：

1. `--whisper-model <路径>`
2. 环境变量 `$JC_WATCH_WHISPER_MODEL`
3. 环境变量 `$WHISPER_MODEL`
4. **`~/.jiucaihezi/tools/whisper-models/`** ← 推荐用户放这里
5. `~/.cache/whisper.cpp/`
6. `~/.jiucaihezi/models/whisper/`
7. macOS brew：`/opt/homebrew/share/whisper.cpp/`、`/usr/local/share/whisper.cpp/`

模型必须是 ggml 格式，**多语言版优先**（`.en` 版识别不了中文）。`ggml-base.bin` 约 148 MB，够起步：

```bash
mkdir -p ~/.jiucaihezi/tools/whisper-models && curl -L -o ~/.jiucaihezi/tools/whisper-models/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

用户**已经自己下载过模型**时，先按上面的顺序找一遍，用 `--whisper-model` 指过去即可，**不要复制、移动或重复下载用户的文件**。

注意：`for-tests-ggml-*.bin` 是 whisper.cpp 的 CI 空壳模型，转录结果为空，不是可用模型。

### 拿不到转录时必须如实说明

报告里会写 `Transcript: none available`。此时回答要明确声明「基于画面、没有语音信息」，**绝不能凭画面猜台词**。画面里出现字幕另算——那是画面内容，可以读。

## 取舍

- **转录免费且离线**：走本机 whisper.cpp，不消耗 API 额度，视频不出本机。
- **token 花在帧上**：10 分钟以上的视频默认最多 100 帧，覆盖会很稀。长视频先问用户要看哪一段，用 `--start/--end` 聚焦，比全片扫一遍有用得多。
- **字幕优先**：有平台字幕时直接抓字幕，不跑 whisper（快得多）。中文优先、英文次之。
- **平台上限**：能下什么取决于用户网络能访问什么；访问不到的平台如实说明，不要编造视频内容。
