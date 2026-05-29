# NarratoAI → 韭菜盒子 全量融合 SDD

> 对照仓库: https://github.com/linyqh/NarratoAI
> 协议: 仅供学习参考（NarratoAI 禁止商用）
> 策略: 拆为搭子(SKILL.md) + 工具(TS/Rust) + 依赖(whisper.cpp)

---

## 源码对照表

| # | NarratoAI 源文件 | 韭菜盒子目标 | 类型 | 内容 |
|---|---|---|---|---|
| 1 | `prompts/documentary/narration_generation.py` | `public/skills/narrato-docu/SKILL.md` | 搭子 | 通用影视解说：黄金三秒+十大钩子+结构范式 |
| 2 | `prompts/short_drama_narration/script_generation.py` | `public/skills/narrato-short/SKILL.md` | 搭子 | 短剧解说：黄金开场+爽点放大+吐槽+悬念+原声 |
| 3 | `prompts/short_drama_narration/plot_analysis.py` | 合并到 #2 | 搭子 | 剧情分段分析+时间戳定位 |
| 4 | `services/subtitle_text.py` | `src/utils/srtParser.ts` | 工具 | SRT 字幕解析（纯JS） |
| 5 | `services/fun_asr_subtitle.py` | `src-tauri/src/whisper.rs` | 工具 | 视频→SRT字幕（whisper.cpp） |
| 6 | `services/generate_video.py` + `task.py` | `src/utils/videoNarrator.ts` | 工具 | JSON脚本→ffmpeg合成成片 |

---

## 实施顺序

1. ✅ P0: SRT 解析工具（纯 JS，零依赖）— `src/utils/srtParser.ts`
2. ✅ P0: 影视解说工坊 SKILL.md — `public/skills/narrato-docu/SKILL.md`
3. ✅ P0: 短剧解说工坊 SKILL.md — `public/skills/narrato-short/SKILL.md`
4. ✅ P1: whisper.cpp Rust 集成 — `media_transcribe_file` 支持 whisper-cli 回退
5. ✅ P1: 视频解说合成 — `local_subtitle_burn` + `local_video_narrate` 管道工具
6. ✅ 注册搭子 + 构建部署 — agentStore.ts 36个搭子

**全部完成！** 用户现在可以：
- 粘贴 SRT 字幕 → 搭子分析剧情 → 生成解说 JSON
- 上传视频 → `local_video_narrate` → 自动提取字幕 → 解说 → 烧录成片

**依赖要求（桌面端）：**
- `brew install whisper-cpp` + 下载模型到 `~/Library/Caches/whisper/ggml-base.bin`
- ffmpeg（已有）
