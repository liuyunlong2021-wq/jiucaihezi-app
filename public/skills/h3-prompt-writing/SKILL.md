---
name: h3-prompt-writing
description: Write MiniMax H3 video generation prompts for T2VA, I2VA, FL2VA, L2VA, and Ref2VA. Use when rewriting multimodal requests into H3 prompt structures, composing integrated_multimodal_description, overall_soundscape, and non_diegetic_music, aligning keyframes, or defining reference labels for images, videos, and audio.
compatibility: Portable to any agent that can read local files — no external API calls, MiniMax Hub tools, or proprietary runtime required. The agents/openai.yaml file only adds optional ChatGPT/Codex UI metadata; it does not restrict the skill to OpenAI agents.
---

## 漫剧交接：分镜、资产、风格

生成本段提示词前实际读取：本集工程剧本目录内的时间戳分镜（或用户已确认的旧工程稿）、本段关联的角色及造型／场景／道具资产正文与真实图片绑定、已确认的项目比例与风格。沿 Wiki 索引与制作进度的 assets 登记定位，核对当前版本与本段时间范围。分镜正文不需要资产清单；不因缺少镜号、资产说明或风格头而重写分镜。新稿以时间范围定位，旧稿可沿镜号；完整保留动作、台词、声音及顺序，再换算为本段从0起的时间。纯文生或没有需要带图的资产时允许空引用，不能虚构图号或已上传状态。缺少必需分镜、风格或本段所需资产时说明具体缺项，不凭旧聊天补造。


## 漫剧 Wiki 精准输入与归档

本节适用于漫剧制作。始终读取用户本轮消息，以本轮要求决定修改范围；上下文只辅助指代，不以旧聊天替代当前Wiki正文。下列“本轮应读”必须通过read实际读取正文；本轮刚生成、保存在聊天里或只读index均不算。相同版本可在本轮复用已读正文，文件修改后须重读。先wiki_read_guidance(overview)，沿真实index唯一定位，不凭人名猜路径，不把索引摘要当正文。

- 本轮应读：本集指定工程剧本或对应H3四格提示词；分镜遗漏的动作、台词、声音回查工程稿，角色声音按实际档案继承。
- 输出与保存：video_prompt，video_model=H3，segment=001等 → 剧本/视频提示词/H3/第x集001视频提示词.md。完整产物自动归档，修订先读原文并更新同一文档；解释、提问和未成稿讨论不自动保存。用户明确不要保存时遵守。
- 旧库可能使用项目资料/原作、改编版或旧资产目录，沿实际index取对应版本，不混读、不自动搬迁。缺资料先报告具体缺项；项目已有风格时不得因本轮未重复说明就采用默认写实或16:9。
- 参考图已由用户准备时，只需保证占位的对象、用途和镜号映射准确；没有绑定不能虚构真实图号或已上传状态，不重复生图。


# H3 Prompt Writing

## 全自动成片（按段选 Ref2VA 或 T2VA）

流水线指令为【全自动成片·第N集】且视频模型为 H3 时，参考图按段决定：本段 refs 不为空就按 Ref2VA（`references/ref-en.txt`）写，宿主按本段资产图生成参考视频；refs 为空（纯文生项目，或本段是空镜、氛围等无需外观一致的画面）就按 T2VA（`references/base-en.txt`）写，不出现 `<Picture N>`，主体外观在正文里写清。用户明确要求纯文生或不用参考图时一律 T2VA，不以本节默认为由暂停。Ref2VA 段的规则：

- 本段入画的角色、场景、已登记道具（仅剧情道具与角色标志物；杯碗筷、桌椅、食物等日常物件属于场景陈设，不占图）各对应一张 `<Picture N>`，从1连续编号，顺序与进度中本段 refs 一致；张数不超过指令给出的上限（如 6 张），超出就拆镜或减少本段入画资产，不合并资产。
- 换装角色用其造型资产作一张 `<Picture N>` 并写全名（如 `<Subject 1> is 顾云舟·帝王 from <Picture 1>`），不另放服装图。
- 人群用已登记的群像图作一张 `<Picture N>`（如 `<Subject 4> is the 太虚宗弟子 crowd from <Picture 4>`），镜头里写明人数与队形（如 “over one thousand disciples stand in a square formation behind <Subject 1>”），群像图只锁定服制与外观。
- `subject_definitions` 每张图单独一行并写出资产名，例如 `<Subject 1> is 顾云舟 from <Picture 1>, ...`、`<Picture 2> is the environment reference for 后山石道, ...`，名称与资产档案一致。
- 每段都写清参考图与角色空间关系：谁在画面哪一侧、距离、朝向、视线、持物，以及场景地标的位置；不能只写“沿用上一段”。每段独立可提交，时间从0起，时长不超过指令上限。
- 角色声音按人物声音档案写进对白与 soundscape；不写制作备注、上传说明或预算。

## Workflow

1. Identify the input mode: T2VA, I2VA, FL2VA, L2VA, or full-reference Ref2VA.
2. For base text/keyframe modes, read `references/base-en.txt` and follow its final prompt structure.
3. For full-reference mode, read `references/ref-en.txt` and follow its six-section rewrite format.
4. Preserve the exact field names, section order, labels, and timing notation from the selected guide.

## Base Modes

- T2VA: build the full audiovisual timeline from text.
- I2VA: start from the first frame and develop forward from it.
- FL2VA: describe the continuous path between the first and last frames.
- L2VA: infer a plausible opening and converge to the supplied last frame.

Use `integrated_multimodal_description`, `overall_soundscape`, and `non_diegetic_music` in the order shown in `references/base-en.txt`.

## Full-Reference Mode

Ref2VA rewrites use `subject_definitions`, `summary`, `retention_analysis`, `detailed_description`, `overall_soundscape`, and `non_diegetic_music` in that order. Reference labels stay consistent across all sections.

Read `references/ref-en.txt` for label rules, retention analysis, and complete examples.

## Output Rules

- Write rewrite sections in English; preserve dialogue, lyrics, and visible scene text in their original language.
- Describe each shot by composition, subjects, environment, actions, camera, sound, and the exact point where referenced content appears.
- Avoid plot summaries, unresolved reference labels, and timing that does not match the requested duration.
## Tips for Better Results
- Always match the total duration of the description to the requested video length (4–30 seconds; in the 漫剧 pipeline use the plan's `limits.max_seconds`).
- Keep reference labels consistent (e.g. `<Picture 1>`, `<Video 1>`, `<Audio 1>`) across every section.
- Prefer concrete visual and audio details over abstract words like "cinematic" or "beautiful".
- When using keyframes (I2VA / FL2VA / L2VA), clearly state how the first and/or last frame connects to the timeline.
