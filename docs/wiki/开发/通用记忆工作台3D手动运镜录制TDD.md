# 通用记忆工作台 3D 手动运镜录制 TDD

> 日期：2026-08-07
> 状态：已实施

## 目标

在现有 3D 编辑器增加“开始录制 / 停止录制”。录制期间用户继续使用现有 OrbitControls 旋转、平移、推进和拉远；停止后复用现有 `MediaRecorder -> dev_export_scene_video -> FFmpeg -> .raw/jc-media/视频` 链路保存 MP4。

## 红灯合同

- 手动录制不要求 `.jcscene` 存在 `duration` 或 `timeline`。
- 只录制 Three.js Canvas；录制时隐藏网格与对象变换控件，停止后恢复编辑状态。
- Desktop 工作台接收录制 Blob，调用现有 `dev_export_scene_video` 保存 MP4。

## 非目标

- 不记录或编辑相机关键帧。
- 不增加新文件类型、录制引擎、依赖或远程服务。
- 不修改现有自动时间线播放与模型生成动画导出。

## 实施回执

- 3D 工具栏已增加开始/停止手动运镜录制；录制时继续使用现有 OrbitControls。
- 录制只采集 Three.js Canvas，临时隐藏网格和变换控件，停止后恢复编辑状态。
- Desktop 工作台复用 `dev_export_scene_video` 和系统 FFmpeg，输出 `.raw/jc-media/视频/*.mp4`。
- 通过：手动录制合同 `49/49`、TypeScript、图标完整性检查和 `git diff --check`。
- 未验证：真实 Desktop 手动拖动、停止、FFmpeg 输出仍需人工验收。
