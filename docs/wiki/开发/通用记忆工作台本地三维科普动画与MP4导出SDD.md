# 通用记忆工作台本地三维科普动画与 MP4 导出 SDD

> 日期：2026-08-02
> 状态：第一版、真实 Desktop 一句话成片与镜头时间线增强均已实施
> 范围：通用记忆工作台 Desktop 的本地 Three.js 几何科普动画与系统 FFmpeg MP4 导出；不改 AI 视频生成链路，不给安装包内置 FFmpeg。

## 1. 用户结果

用户在记忆模式直接说：

> 给我制作一个本地 Three.js 几何科普动画，讲清楚铁矿石从破碎、筛分、磁选、熔炼到铁块的流程。先保存 Markdown 讲解稿，最后调用我电脑里的 FFmpeg 导出 MP4。不要调用 AI 视频生成模型。

模型自动完成：

```text
生成 Markdown 讲解稿
  -> 创建带动画时间线的 .jcscene
  -> Three.js 播放并录制画布
  -> 调用系统 FFmpeg 转为 MP4
  -> 保存到 .raw/jc-media/视频
```

最终至少留下两份用户产物：

- `.raw/jc-media/文档/选矿流程.md`：可继续修改的讲解稿。
- `.raw/jc-media/视频/选矿流程.mp4`：可直接播放和使用的成片。

`.jcscene` 作为可再次生成视频的动画工程保留在文档目录。录制中间文件只放应用临时目录，成功后清理，不进入项目文件树。

## 2. 现在已经有什么

| 现有能力 | 当前作用 | 本功能是否复用 |
| --- | --- | --- |
| 记忆模式模型与 `create_document` | 根据自然语言生成并保存 Markdown | 直接复用 |
| `create_3d_scene` | 创建人物、方块、平面、球体、箭头、排列、灯光和机位 | 扩展复用 |
| Three.js / JavaScript / WebGL | 在现有 `.jcscene` 编辑器中实时绘制 3D 场景 | 直接复用 |
| Scene3DEditor 渲染循环 | 持续刷新场景、相机和交互 | 扩展复用 |
| 项目文件服务 | Web/Desktop 统一写入项目文档、图片和视频目录 | 直接复用 |
| Desktop 终端执行与三项审批 | 经用户批准运行本机命令 | 直接复用 |
| 自定义 MCP 桥 | 可选连接外部视频工具 | 本期不依赖 |
| 用户电脑已有 FFmpeg | 把录制中间文件编码为标准 MP4 | 外部复用，不打包 |

因此本功能不缺 3D 引擎、JavaScript、WebGL、项目存储或 FFmpeg 本体。

## 3. 唯一新增的核心：动画时间线

### 3.1 它是什么

动画时间线不是新引擎，也不是一个让用户单独操作的工具。它只是 `.jcscene` 中新增的一组数据，逐条说明：

```text
第几秒开始
持续多久
哪个对象
执行什么动作
最后变成什么状态
```

例如：

```json
{
  "duration": 12,
  "timeline": [
    { "at": 0, "target": "ore", "action": "show" },
    { "at": 1, "duration": 2, "target": "ore", "action": "move", "to": [0, 1, 2] },
    { "at": 3, "target": "ore", "action": "hide" },
    { "at": 3, "target": "particles", "action": "show" },
    { "at": 6, "duration": 2, "target": "camera", "action": "move", "to": [6, 5, 8] }
  ]
}
```

模型负责把 Markdown 中的“破碎、运输、磁选、熔炼”翻译成这组明确数据；运行时不重新猜测自然语言。

### 3.2 第一版动作

第一版只支持几何科普演示必需的动作：

- `show / hide`：出现和消失。
- `move`：移动到目标位置。
- `rotate`：旋转到目标角度。
- `scale`：放大、缩小或模拟破碎。
- `color`：改变颜色，区分材料和状态。
- `camera`：移动摄影机和观察目标。
- `label`：显示或切换当前步骤说明。

动作使用线性或统一缓入缓出，不增加曲线编辑器、关键帧面板或自定义动画代码。

### 3.3 场景协议

继续使用 `.jcscene`，不增加新文件类型。现有静态场景没有 `timeline` 时行为完全不变；动画场景只增加：

```text
duration       # 总时长，秒
timeline[]     # 动作列表
```

`create_3d_scene` 增加可选的 `duration` 和 `timeline` 参数。对象、排列、分组、灯光、机位和画幅继续使用现有合同。

## 4. 新增一个导出工具

新增记忆模式 Desktop 工具 `export_3d_scene_video`：

```text
path           # 当前项目内已有的 .jcscene
```

其余参数固定，不让模型和用户处理编码设置：

- 按场景画幅导出，长边默认 1920 像素。
- 固定 30 fps。
- 最终格式固定 MP4。
- FFmpeg 固定输出 H.264、`yuv420p` 和 faststart。
- 文件名取场景标题，同名保留两份。

工具内部顺序：

```text
读取并校验 .jcscene
  -> 用现有 Three.js 渲染器从 0 秒播放
  -> 浏览器原生 captureStream + MediaRecorder 录制画布
  -> 把中间视频写到应用临时目录
  -> 通过现有 Desktop 命令执行桥运行系统 ffmpeg
  -> 验证 MP4 文件存在、非空且可读取
  -> 写入项目视频目录
  -> 清理临时文件
```

`export_3d_scene_video` 会启动本机进程，必须复用现有终端工具审批语义；用户选择现有“始终允许”后按现行规则处理，不增加第二套弹窗。

## 5. 模型路由

不增加关键词分类器。工具描述负责让模型区分：

| 用户意图 | 应使用能力 |
| --- | --- |
| 写实、电影感、真实工厂视频 | 现有 AI 视频媒体工具 |
| 本地 Three.js、几何体、方块、颗粒、箭头、科普流程 | `create_3d_scene` + `export_3d_scene_video` |
| 只要静态空间排位或生图参考 | 现有 `create_3d_scene`，不生成时间线 |

用户一次提出完整目标后，模型可以连续调用 `create_document`、`create_3d_scene` 和 `export_3d_scene_video`；不要求用户记工具名或分三轮下达命令。

## 6. 播放与录制界面

现有 3D 编辑器只增加最小控制：

- 播放 / 暂停。
- 从头重播。
- 当前时间 / 总时长。
- 导出 MP4。

打开动画 `.jcscene` 后可以预览；普通静态 `.jcscene` 不显示空时间线。模型直接调用导出工具时不要求用户先手动打开编辑器。

录制按动画真实时长进行：20 秒动画需要约 20 秒播放录制，再执行短暂编码。第一版不做离线超实时逐帧渲染。

## 7. Desktop 与 Web 边界

- 第一版只在 Desktop 导出 MP4。
- 启动导出前执行 `ffmpeg -version`；系统找不到 FFmpeg 时明确提示安装或配置 PATH，不下载、不静默安装。
- Web 仍可打开和播放动画 `.jcscene`，但不承诺 MP4 导出；不接远程渲染服务。
- 自定义视频 MCP 是以后可选的外部出口，不是本期依赖，也不进入安装包。

## 8. 明确不做

- 不内置 FFmpeg、Chromium、Playwright、Remotion 或第二个 3D 引擎。
- 不做游戏、物理模拟、碰撞、人物骨骼、表情或口型。
- 不做视频编辑器、剪辑时间线、转场库、模板市场或编码设置页。
- 不做 AI 视频生成兜底；本地动画失败时明确失败。
- 第一版不加配音、音乐、字幕轨和音视频混流；步骤说明直接作为场景标签显示。
- 不保留 HTML 或 WebM 作为用户产物，不把临时帧写进项目。
- 不为普通用户捆绑运行环境；先服务已安装 FFmpeg 的 Desktop 用户。

## 9. 实施顺序

```text
1. 扩展 .jcscene 的 duration / timeline 校验和序列化
   -> 验证：旧静态场景不变，非法时间和未知对象被拒绝

2. 让现有 Three.js 渲染器按时间计算对象与摄影机状态
   -> 验证：播放、暂停、重播后同一时间点画面一致

3. 接入浏览器原生画布录制与临时文件生命周期
   -> 验证：固定样例得到非空中间视频，取消后没有残留录制任务

4. 新增 export_3d_scene_video，复用现有审批和系统 FFmpeg
   -> 验证：H.264 MP4 写入项目视频目录；缺少 FFmpeg 时明确失败

5. 跑自动与真实闭环
   -> 验证：一句自然语言生成 Markdown、动画工程和 MP4，且不进入 AI 媒体确认卡
```

## 10. 验收标准

1. 用户一次提出“本地 Three.js 选矿科普动画并导出 MP4”，模型自动完成 Markdown、动画场景和 MP4，不调用 AI 视频模型。
2. 选矿固定样例至少展示破碎、运输、磁选、熔炼和成块五步；对象、箭头、标签和摄影机按时间变化。
3. 旧 `.jcscene` 打开、编辑、截图和保存行为不变。
4. MP4 为 H.264、30 fps、`yuv420p`，画幅正确，时长与场景总时长仅允许录制与封装产生的小幅误差，抽取首中尾帧均非空。
5. 成功后项目中只有 Markdown、`.jcscene` 和 MP4，没有 HTML、WebM、图片序列或临时目录残留。
6. FFmpeg 不在应用依赖和安装包中；未安装、命令失败、用户拒绝、录制取消时均不伪造成功。
7. 定向测试、TypeScript、Desktop quick build、产物审计通过后，状态可记为第一版已实施；真实 Desktop 一句话成片单独标记人工验收状态。

## 11. 当前结论

这不是新增一套动画软件。现有能力已经覆盖内容生成、几何场景、实时 3D、项目存储和本机命令执行；新增工作只有三部分：

```text
时间线数据
+ Three.js 按时间播放
+ 一个录制并调用系统 FFmpeg 的导出工具
```

动画时间线是数据；`export_3d_scene_video` 才是新增工具。FFmpeg 继续属于用户电脑，不进入产品安装包。

## 12. 第一版实施结果

2026-08-02 已完成：

- `.jcscene` 保持 `version: 1`，新增可选 `duration / timeline`；支持 `show / hide / move / rotate / scale / color / camera / label` 与确定性时间状态计算。
- 现有 `Scene3DEditor` 增加播放、暂停、重播和时间显示；屏幕外复用同一编辑器，以浏览器原生 `captureStream + MediaRecorder` 实时录制。
- Desktop 记忆模式新增 `export_3d_scene_video`；复用现有三项审批，调用用户系统 PATH 中的 FFmpeg，固定导出 H.264、30 fps、`yuv420p` MP4 到 `.raw/jc-media/视频`，中间文件位于系统临时目录并在结束后清理。
- Web 不暴露 MP4 导出工具；未加入 FFmpeg、Chromium、Playwright、Remotion 或其他依赖。

自动证据：定向相关测试 73/73、完整 focused 1434/1442（8 跳过）、Rust 403/404（1 忽略）、TypeScript、Desktop quick build 与产物审计通过；本机 FFmpeg 8.1.2 含 `libx264`。当前本地 Web 页面无控制台错误。

2026-08-03 用户已在真实 Desktop 中完成 `create_document -> create_3d_scene -> export_3d_scene_video` 选矿 MP4 闭环并确认成片可播放。人工验收同时暴露一个明确缺口：模型生成的是固定全景流水线，没有按流程段落生成镜头语言。

## 13. 镜头时间线增强

### 13.1 根因与最小方案

现有播放器与 MP4 导出已经共用 `evaluateScene3DAnimation`，也已支持 `timeline` 中的 `camera` 动作。缺口不是 Three.js、录制或 FFmpeg，而是 `create_3d_scene` 的模型合同没有明确要求每个讲解段落都生成相机动作。

因此不新增 `shots[]`、第二套时间线或新依赖。镜头继续使用现有 `timeline`：

```json
[
  { "at": 0, "target": "camera", "action": "camera", "to": [12, 8, 14], "lookAt": [0, 1, 0] },
  { "at": 4, "duration": 2, "target": "camera", "action": "camera", "to": [5, 3, 6], "lookAt": [4, 1, 0], "easing": "ease-in-out" }
]
```

- 不写 `duration`：硬切到新机位。
- 写 `duration`：在该时长内连续移动；改变位置可实现推近、拉远和横移，只改变 `lookAt` 可实现摇镜。
- 每个科普段落至少有一条 `label` 和一条 `camera`，避免全片停留在同一全景。
- Markdown 只负责描述段落和镜头意图；模型在调用 `create_3d_scene` 时把它翻译为确定性坐标，运行时不解析 Markdown。

### 13.2 本期边界

只实现硬切、推近、拉远、横移和摇镜。不增加转场特效、焦距动画、景深、曲线编辑器、可视化剪辑轨或自动导演算法。

### 13.3 验收标准

1. 工具合同明确要求动画科普每段生成一个 `camera` 动作，并说明硬切与连续运镜的数据表达。
2. 同一求值器在指定时间点稳定得到硬切后的机位和连续运镜中的插值机位，预览与 MP4 导出无需分叉。
3. 旧 `.jcscene` 和只含物体动画的时间线继续可读、可播、可导出。

实施结果：`create_3d_scene` 工具合同已要求每个科普段落生成独立 `camera` 动作，并明确硬切与连续运镜的表达；复用现有求值器，无新字段、依赖或播放器分支。镜头与工具合同定向测试 25/25、TypeScript 检查通过。

真实验收：2026-08-03 用户再次在 Desktop 记忆模式生成选矿 MP4，确认分段镜头语言已经生效并通过验收。至此，一句话生成 Markdown、`.jcscene`、分段运镜动画和最终 MP4 的真实 Desktop 闭环完成。
