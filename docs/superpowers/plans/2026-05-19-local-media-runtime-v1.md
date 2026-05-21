# 本地音视频执行器 v1

日期：2026-05-19

## 目标

把上一阶段的音视频“识别/规划”升级为可真实执行的本地处理能力，让用户上传音频或视频后，可以通过搭子或普通对话生成可下载结果。

## 已实现范围

- 上传音频/视频时，桌面端会把文件缓存到 App 数据目录。
- 附件摘要包含文件名、类型、大小、时长、视频尺寸和本地缓存路径。
- 新增 `local_media_process` 工具。
- 支持的动作：
  - `compress`：压缩视频。
  - `convert`：转换为 mp4、mov、webm、mkv、mp3、wav、aac、flac、ogg。
  - `extract_audio`：从视频中抽取音频。
  - `trim`：按秒截取片段。
  - `mute`：生成静音视频。
- 新增 `local_media_transcribe` 工具：
  - 调用本地 `whisper` 命令，把音频/视频转成 txt、srt、vtt 或 json。
  - 如果本机没有安装 `whisper`，返回明确错误，不伪造转写结果。
- 新增 `local_subtitle_burn` 工具：
  - 调用本地 `ffmpeg`，把 SRT 字幕烧录进视频。
  - 字幕可以来自工具参数 `subtitle_text`，也可以来自上传的 `.srt/.vtt/.txt` 文本附件。
- 处理完成后返回本地 `asset:` 下载链接，复用现有导出/下载按钮。

## 安全边界

- 只处理韭菜盒子缓存目录内的媒体文件。
- 不开放任意 shell。
- `ffmpeg` 参数由白名单动作生成。
- `whisper` 只用于转写，不允许透传任意命令参数。
- 输出写入 App 数据目录的 `media-outputs`。
- ffmpeg 不存在或执行失败时，返回明确错误给对话，不伪造成功。

## 非本轮范围

- 暂不做复杂滤镜、拼接、多轨混音。
- 暂不自动安装 ffmpeg。
- 暂不自动安装 Whisper 模型或 Whisper 运行时。

## 验证

- `src/utils/__tests__/localContentTools.test.ts`
- `src/utils/__tests__/officeDownloads.test.ts`
- `pnpm build`
- `cargo check`
- 本机 ffmpeg 冒烟测试
