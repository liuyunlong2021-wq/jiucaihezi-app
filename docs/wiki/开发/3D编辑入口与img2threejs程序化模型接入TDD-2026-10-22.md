# 3D 编辑入口与 img2threejs 程序化模型接入 TDD

> 日期：2026-10-22。
> 状态：设计与待实施测试合同；未新增测试、未实施产品功能、未安装上游 Skill、未执行真实生成或跨平台验收。
> 用户确认：输入框「3D 编辑」→ 图片和需求 → img2threejs 工作流 → 程序化模型进入现有编辑器并可查看。机位、运镜和录视频由用户自己操作。

## 1. 唯一目标与完成定义

用户在现有输入框选择「3D 编辑」，提供图片与要求，Agent 使用 img2threejs 的程序化重建流程，把结果交付为可在现有 `Scene3DEditor` 中打开的 `.jcscene`。用户能旋转观察、选择对象、移动位置，关闭重开仍看得到；继续使用既有手动机位与录制能力。

成功必须同时满足：参考图片确实被读取；实际执行 img2threejs 的分析、规格、分阶段生成和视觉检查；TypeScript 程序化源码与规格可追溯；正式场景保存成功；现有编辑器加载完成；Agent 看到该编辑器渲染的截图。只返回提示词、TS 文件、独立网页、外部展示站或一张效果图均不算交付完成。

本期交付静态可查看的程序化模型，不要求执行 `tick`、物理、破碎、表情、角色动画或映射现有人物骨骼。模型的结构与部件层级保留，不把静态可查看写成动画就绪。原有桌面全部功能保留。

非目标：图生 GLB、混元/TRELLIS 替代路线；新 3D 编辑器、模型市场、通用插件平台、自建 Agent 循环；自动编排机位、自动录制/导出视频；重写现有摄影、灯光和后期系统。

## 2. 已核对的代码与真正缺口

本地审阅基线 `40db5aaa`，另有用户在途改动；实施前重新读取工作树，不以本文覆盖他人更新。以下是源码事实，不代表已完成真机验收。

| 现有位置 | 已有能力 | 本次复用/必要改动 |
| --- | --- | --- |
| `src/components/memory/MemoryWorkbench.vue` | `scene3dSelected`、@3D、附件、草稿与发送快照、场景成果标记、编辑器预览 | 增加「3D 编辑」按钮，复用同一输入和场景打开链路 |
| `src/runtime/memory/productionSkills.ts`、`src-tauri/resources/deepseek-harness/production-skills.mjs` | 结构化 `productionMode`、官方 Skill provider、目录与按名称加载双重范围限制、来源约束 | 扩展一个 3D Skill 范围，不复制选择器与加载器 |
| `src/services/deepSeekHarness.ts` | 本机桥接、3D 工具注册、requiredTools、图片能力、Session/Inbox | 传递入口范围、保留实际工具齐备检查和原生图片块 |
| `scripts/prepare-deepseek-harness.mjs` | 官方目录与加载范围的最小补丁 | 仅扩展范围数据；不新建路由器、不每轮注入 Skill 全文 |
| `src/runtime/direct/desktopProjectTools.ts` | create/inspect/edit、expectedRevision、条件写回、保存后截图、结果标记 | 接入程序化资产的验证与场景提交 |
| `src/runtime/memory/scene3d.ts` | `.jcscene` 校验与序列化、对象/分组、时间线、机位 | 增加一种程序化模型对象，旧对象及文件行为保持 |
| `src/components/memory/Scene3DEditor.vue` | Three.js、拾取/变换、异步人物加载、包围盒定位、截图、手动录制 | 新资产挂进同一 root/selection/transform，扩展就绪等待 |
| `src/runtime/memory/scene3dHost.ts`、工作台 `sceneHost` | beginEdit、saved、preview、撤销历史、隐藏渲染器串行队列 | 保留同一写入和截图闭环，不开第二窗口冒充编辑器 |
| `src/components/media/Model3DViewer.vue` | GLB/GLTF 独立查看 | 无需改动，不能将其当成本任务的编辑器 |

根因：当前 `Scene3DObject` 只允许固定 `Scene3DShape` 和指定 Storyboarder 人物；`buildScene()` 对每个对象调用 `makePrimitive()`，没有程序化资产描述、加载分支和可持久化的模型入口。已有 GLTFLoader 主要服务固定人物，不等于任意模型已能进入场景。

另一个缺口是 Skill 包与运行依赖：现有官方 Skill 范围机制已经在工作树中实现，不能继续按旧文档当作尚未存在；但当前内置包没有 img2threejs，随包 Node 不等于已经随包 Python、TypeScript 转译器或浏览器自动化运行时。

## 3. 上游基线与去伪存精

审阅上游固定提交：[`954cd5845e90efd045694bab725d68a9863c20e0`](https://github.com/img2threejs/img2threejs/tree/954cd5845e90efd045694bab725d68a9863c20e0)，提交时间 2026-10-21 UTC。该提交的 SKILL.md 标记 `2.0.0`，npm package.json 标记 `0.1.1`，二者不是同一个版本指标。实现与包清单固定 commit/hash，不运行 `@latest` 作为生产依赖。

| 上游内容 | 产品处理 | 理由 |
| --- | --- | --- |
| 图片适用性、宏观到细节分析、隐藏面不确定性 | 保留 | 是从图到模型的输入合同 |
| qualityContract、ObjectSculptSpec、detailInventory、局部材质依据 | 保留 | 防止“几个积木占位”冒充图片重建 |
| `forge/state.py` / `next.py`、严格校验、分阶段构建、reviewHistory | 保留原实现及资源闭包 | 现有 Session 管对话；上游文件管重建进度，两者不另建统一工作流引擎 |
| generic / 静态 character | 首期支持范围，按实际目标选择 | 不预装全部领域插件，不把人物统一降成 generic |
| 渲染、截图、对照检查和有界纠错 | 保留语义，宿主截图换成现有编辑器 | 不引入 showcase 作为另一套用户产品 |
| 上游 factory、生成几何和材质 | 保留 | 这是用户选择该项目的核心 |
| 上游相机控制器、展示页、PresentationComposer、示例灯光/renderer 配置 | 不接管产品场景 | 宿主已有机位、灯光与渲染器；若材质确需额外效果，先披露差异，不暗改全场景 |
| 自动 idle/tick、破碎交互、动画插件、外部资产/神经模型适配器 | 不在本期执行 | 用户只要求生成后能在编辑器查看；不宣称完成这些能力 |
| 安装器为多宿主创建链接、img2 插件 CLI | 不用于产品运行时 | 复用产品内置 Skill 包；不改用户其他 AI 工具目录 |

“精简”不等于把上游改成一句生图提示词，或把被删的质量规则藏进系统提示。采用一个内置 `img2threejs` Skill 包，按上游许可保留出处；产品宿主适配说明单独成文，说明哪些宿主步骤替换、哪些能力未实现。不得同时注册同名不同来源的两个包。

采用最小的 **完整资源闭包**：入口引用的 `forge/`、`grimoire/`、`docs/`、本地 spec 搜索数据、材质 registry、间接 Python imports 和许可都必须存在；不能只拷贝 SKILL.md。先保留可执行闭包，再依据实际调用与测试裁剪示例/展示资源。上游互有差异的说明以该提交实际脚本和门禁为准，不擅自解除硬失败。

上游要求的分阶段视觉核查、多角度、对照图、关键部件覆盖和适用材质门禁仍须执行；不适用步骤必须由上游允许的 skip+reason 留证。不能把“用户只查看”当作删掉全部建模质量门禁的理由。默认每阶段 3 次、总计 6 次纠正的有界停止沿用上游；命中停止后报告未达成点，不无限重试或换成别的模型路线。

## 4. 输入框与范围合同

### 4.1 一个按钮、一份消息、一套 Session

- 在现有创作入口附近增加桌面「3D 编辑」按钮，沿现有按钮样式和结构化范围机制接入。按钮不自动发送、不调用分类模型、不预写 `/img2threejs`、不每轮强制加载全文。
- 本轮业务 Skill 可发现与可加载集合只有随包固定来源的 `img2threejs`；资源文件按需读取。目录隐藏和实际加载都要限制，同名个人/项目 Skill 不得劫持。
- 复用现有创作入口互斥语义：与漫剧/短剧/小说范围不能同时激活；切换不删除草稿、图片和项目。退出恢复既有普通 Skill 行为。
- 原生 Wiki、present、文件/图片、官方工具和用户已配置能力仍按原产品合同工作；“仅 img2threejs”是本入口的业务工作流选择，不是把官方工具全部删掉或声明成安全沙箱。
- 新入口启用现有 3D 能力及本次模型发布所需工具；不顺带开启付费影音、电脑操控或安装领域插件。图片已经由本轮附件/项目路径提供，不要求用户再上传一遍。
- 模型无图片输入能力、图片读取失败、Skill 包/运行时缺失时，明确可恢复错误；不能假装看图，不能静默退成白模拼积木或混元/GLB。

### 4.2 保留旧入口与发送生命周期

现有 `@3D`、白模创建/增量编辑、姿态/骨骼工具和旧历史全部保留。「3D 编辑」是专用程序化重建入口，不强制把所有旧 @3D 请求改走图片工作流。

范围绑定发送时的消息快照，覆盖正常发送、运行中 Inbox、重发、冷恢复、子任务继承和同工作区多会话。运行中换按钮不改写已经执行的步骤。不得另建临时会话替换原 Session，不能从历史正文猜测本轮模式。

## 5. 程序化资产承接合同

### 5.1 源码是建模依据，场景数据是渲染交接

首选承接方式：上游 factory 在建模执行阶段构建 `THREE.Group`，输出经过验证的 Three.js 对象数据；现有编辑器用同版本 `THREE.ObjectLoader` 重建。保存 TypeScript、spec、参考图及证据，后续模型修改重建对象数据。全链路不经过 GLB、不用神经网格替换程序化源码。

这是**静态视图快照**，不是用 JSON 代替 img2threejs 生成过程。对象数据不能独立成为“已经执行上游工作流”的证据；必须绑定源码/spec/选项/hash，保留完整重建依据。函数、闭包、`onBeforeCompile`、tick 和运行时引用不能假定会被 ObjectLoader 恢复。

建议沿现有文档目录保存，不新增用户文件扩展名：

```text
.raw/jc-media/文档/<名称>.jcscene
.raw/jc-media/文档/3d-assets/<asset-id>/<revision>/
  createObjectModel.ts
  object-sculpt-spec.json
  object.json
  manifest.json
  reference.<原始扩展名>
  textures/...                 # 仅实际使用的本地贴图
  .img2threejs/state.json
  evidence/...                # 评估、门禁、对照图与构建记录
```

目录名为本合同建议落点，实施时只跟随现有项目文件抽象，不新建资产数据库。`.jcscene` 继续作为用户打开的入口。

新增对象概念 `type: 'procedural'`，描述只含现有对象 ID、位置/旋转/尺寸及本地资产 manifest 相对路径/hash；字段最终名称随第 0 关小样固定。manifest 至少包含 schemaVersion、producer/upstreamCommit、Three.js 版本、真实 factory 导出名及调用方式、seed/options、各源码/spec/对象数据/贴图 hash、静态支持能力和质量状态。禁止把可执行代码塞入 `.jcscene` 字符串再 eval。

资产路径仅允许项目内、无符号链接逃逸的受控目录；拒绝绝对路径、`..`、UNC、网络 URL 和资源超预算。外部参考图先走现有附件落盘；引用图片可作为材质证据，不允许暗中运行任意外链。

### 5.2 第 0 关：先证明交接，不先写按钮

以下为已发现的具体兼容问题，必须用固定提交的真实 factory 样本验证，不能用手写 cube 代替：

1. 上游文档提 `factory(spec, options)`，实际 generator 可输出 `factory(options = {})` 并内嵌 spec。必须记录并调用真实导出签名，不猜测参数顺序。
2. factory 含 `document.createElement('canvas')`、CanvasTexture、参考贴图与异步加载路径；裸 Node 不是通用运行环境。先确认样本实际触发哪些 DOM/贴图依赖。
3. `userData.sculptRuntime` 含 nodes、meshes 等 Object3D 引用，且对象本身可能带回 root 的引用。不能直接 `JSON.stringify(root)` 或假设 `root.toJSON()` 必然无循环。构建时保留原 runtime，交接只输出明确允许的纯数据与部件 ID/UUID 映射。
4. 骨骼/蒙皮、InstancedMesh、BufferGeometry、法线/UV、PBR/颜色空间和贴图必须往返验证；不能静默用白色材质或包围盒替代。
5. 上游后期、环境贴图或自定义 shader 对外观的影响要单独记录。普通 PBR/本地纹理为首期基线；无法等价交接的模型返回明确不支持原因并保留源码，不假报成功。

小样产出：一个硬表面物体、一个带程序化贴图物体、一个静态角色；记录真实源码/依赖、调用方式、输出格式、编辑器正面及侧面截图、重开与转换差异。子项未通过不得宣称该类型支持。

**运行环境决策也在此关完成，而不是留到发布时猜测。** 优先复用官方 Terminal/Skill 脚本的现有执行与权限语义，使用随包 Node 处理其能够支持的构建；涉及 DOM/Canvas 时，必须证明受控浏览器构建环境与依赖闭包可用，随后回到现有编辑器检视。不能假设开发机有 Playwright、Chrome、Python、esbuild 就代表安装版有。

本次未验证上述构建环境，因此这里是尚未解除的技术门禁。第 0 关先对照“官方脚本执行后输出数据”与“隔离浏览器构建后输出数据”的实际依赖、跨平台与贴图支持，选定最小可行路径并把结果补入本节；不得同时建设两个通用执行平台。若静态数据交接无法满足必需材质，不默默阉割，要先修订承接设计再实施 UI。

生成代码不得进入主 WebView 的 eval/new Function/任意动态 import，也不得为此全局开放 `unsafe-eval`、`unsafe-inline`。Node 子进程和 `node:vm` 都不是天然安全沙箱；沿用既有脚本权限、取消/超时与资源边界，不虚称“隔离进程即可阻止文件或网络访问”。若采用浏览器构建，需验证 Tauri IPC、父页面、文件和网络边界，以及超时后真实终止；不把现有 HTML iframe 当作已验证的代码模型执行环境。

### 5.3 编辑器只补资产对象

- 异步加载资产后挂进现有对象容器，沿用 `sceneSelection`、拾取、TransformControls、分组和隐藏/删除逻辑；保留模型原始局部层级与材质，外层变换由 `.jcscene` 管理。
- 单位按米、Y 向上，源坐标转换记录在 manifest/对象局部变换中；不要多次归一化。加载与重开保持尺寸和位置一致。首次交付用现有包围盒定位让模型进入视野，后续刷新不重置用户机位。
- 复用 `sceneBuildToken` 防止旧异步结果挂进新场景；切项目/切场景/撤销后在途加载失效。每个实例只释放自己拥有的几何、材质、贴图；共享缓存不得被另一编辑器提前 dispose。
- 将现有 `waitForCharacters()` 的就绪概念扩展为场景资源就绪，覆盖程序化对象及纹理；截图、隐藏渲染器和用户手动录制都等待同一资源状态。失败显示资产与原因，不能无声空白或截半加载画面。
- 不把新模型视为 Storyboarder 人物，不套用只认指定骨骼的 pose/seat。界面隐藏不适用控件，原人物控件保留。
- 原焦距、机位、漫游、截图、时间线及录制算法不重写。不注册新的自动运镜工作流。

## 6. 工具、保存与视觉反馈

优先扩展现有 create/inspect/edit 工具的参数与对象 schema，不并排建设第二套 3D 工具协议。若跨进程交接确需专用 publish 操作，只允许一个窄工具：接收本地资产 manifest 并校验/引用，不接收任意 JS 代码执行。具体落点在第 0 关固定，不提前虚构 SDK API。

1. Agent 用官方 skill 加载 img2threejs，读取图片，按上游 state/next 执行并保存真实产物。
2. 每次构建生成独立 revision 目录；所有资产与 hash 完成、交接可加载后，才允许 `.jcscene` 引用。已提交版本不原地覆盖，避免旧场景、撤销与并发读到半份模型。
3. 新场景复用现有 keepBoth 文件命名与成果 marker；修改已打开场景先 `beginEdit`、等待手动保存，再检查 `expectedRevision`，一次条件写回。版本冲突不能覆盖用户拖动结果。
4. 复用 `sceneHost.saved` 刷新已打开场景，沿现有成果打开动作把新场景展示在同一编辑器。不能只有路径消息而没有可打开成果。
5. 复用 `sceneHost.preview`、`withSceneRenderer` 与 Harness 原生图片回传。检查图必须来自**保存后的同一资产 hash**，不是上游独立预览网页。
6. 技术检查视角采用临时相机上下文，保留正面/侧面/背面证据；不得写入用户 savedCameras/timeline、改变用户机位或启动视频录制。检查视角不等于替用户设计运镜。
7. factory/贴图/解析失败时保持最后可用版本。允许保留构建中间文件以便诊断；正式场景不引用半成品。不在本期建设自动垃圾回收系统。
8. 场景保存与质量状态分开回执：可以报告“草稿已进入编辑器，材质检查未通过”，不能把保存成功说成视觉验收成功。模型看图能力缺失时标明未完成并停止自动质量声明。

不新增自动视频提交或把 `export_3d_scene_video` 设为生成完成的下一步。旧 @3D 的该工具和用户手动录制入口保留；新入口的完成标准不包含调用它。

## 7. 先红后绿的测试合同

下面均为**待新增、待执行**。先运行旧实现确认对应根因红灯，再以行为测试变绿；不能只靠字符串匹配按钮名称证明功能完成。

| 编号 | 首先锁定的失败 | 通过标准与证据 |
| --- | --- | --- |
| T01 | 入口不存在/自行生成路由手势 | 真实按钮复用输入，点击不发送；发送只带结构化模式与原图片/需求 |
| T02 | 范围外或同名个人 Skill 可加载 | 官方目录仅固定来源 img2threejs；按名称/显式手势也不能绕过，退出恢复普通模式 |
| T03 | 每轮注入正文或自建分类路由 | 真实 SDK 请求中按官方发现/skill加载，无宿主强制每轮调用、无额外分类请求 |
| T04 | Inbox/恢复/并行会话串模式 | 消息快照、重发、冷恢复、子任务继承与多会话隔离，复用现有夹具 |
| T05 | 图片未读、包/依赖缺失却继续生成 | 无视觉模型/坏附件/缺脚本/Python时明确失败；不降级为白模或图生GLB |
| T06 | 只打包 SKILL.md、运行依赖靠开发机 | 干净安装资源闭包可解析，断网可读包与资源；三平台路径/空格/中文名正确 |
| T07 | 工厂签名错误、循环 userData 崩溃 | 使用固定提交真实工厂，调用正确；保留纯数据部件映射，无运行时循环进文档 |
| T08 | 仅 cube 可加载、纹理/实例丢失 | 第0关真实三类样本往返：几何数/索引/UV/实例矩阵/层级/包围盒及材质纹理语义匹配 |
| T09 | 不支持材质被静默替代 | 自定义回调等不能保真时明确拒绝/未支持，原可用场景仍在，不冒充成功 |
| T10 | `.jcscene` parser 丢新字段 | 新对象序列化/重读保留资产描述；旧白模/人物/分组/时间线夹具往返不退化 |
| T11 | 路径越界、hash错配或大对象被解析 | 在 ObjectLoader 前拒绝路径逃逸/外链/坏hash/非有限数/非法引用和超资源预算，无原生IPC或外网副作用 |
| T12 | 模型虽显示却无法操作/定位漂移 | 实际挂进现有 root，拾取/平移/旋转/分组/删除/聚焦行为正确，重开尺寸位置一致 |
| T13 | 旧加载结果污染新场景/卸载漏资源 | 切场景、同资产双实例、撤销和卸载均无过期挂载与误dispose，记录资源计数 |
| T14 | 截图早于模型和纹理就绪 | 同一就绪屏障覆盖截图与隐藏录制器；延迟加载夹具不截半成品，错误含具体资产 |
| T15 | Agent 覆盖用户修改/资产原地改坏撤销 | 使用 beginEdit/expectedRevision/条件保存；冲突不写回；旧revision仍能撤销/重开 |
| T16 | 中间文件/其他预览被冒充成果 | 返回可打开 `.jcscene`，正式场景hash与编辑器检查图绑定；可见编辑器实际打开 |
| T17 | Skill 成功只因 JSON 合法 | 确有 upstream state/strict gate/分阶段review/多视角证据；缺证据与达到纠错上限均不能continue |
| T18 | 规格错误只打补丁、重启失进度 | refine-spec/refine-code分流遵从上游；从state恢复，不重跑已完成任务或无限纠错 |
| T19 | 检查截图篡改用户摄影设置 | 临时检查前后 `.jcscene` 的camera/savedCameras/timeline保持；无自动录制/导出调用 |
| T20 | 新代码在主WebView执行或扩大CSP | 实际构建链不执行于主页面，无全局unsafe-eval/unsafe-inline；隔离与取消按所选环境留证 |
| T21 | 新模型令旧编辑/录制失效 | 白模、真实人物姿态/骨骼/落座、机位、漫游、撤销、GLB预览保留；用户手动录制新模型画面可见 |
| T22 | 安装版缺依赖/旧项目打不开 | ARM Mac、Intel Mac、Windows分别记录依赖预检、首次生成、重开与旧项目升级；未执行者标待验收 |

测试落点：

- 入口/打开/资源就绪：`src/components/memory/__tests__/memoryWorkbench.test.ts`，必要时增加真实组件/隔离浏览器交互测试。
- 范围/队列：`src/services/__tests__/deepSeekHarness.test.ts`、`scripts/__tests__/manju-skill-scope.test.mjs`、`deepseek-session-lifecycle.test.mjs` 与 `deepseek-harness-patch.test.mjs`，扩展已存在范围测试，不复制框架。
- 场景/工具：`src/runtime/memory/__tests__/scene3d.test.ts`、`src/runtime/direct/__tests__/desktopProjectTools.test.ts`。
- 资产小样与数据交接：新增一个聚焦的资产行为测试文件，跑真实 Three.js ObjectLoader 与真实 upstream 工厂，不以源码正则替代几何/材质检查。
- 有原生命令改动才补 Rust；没有则不为本任务加一套原生执行层。

资源上限（源码/JSON/解码纹理字节、节点/顶点/三角形、构建时长）由第0关样本与现有设备预算给出固定初值并写入测试；发布前必须明确数值，不能保留“适量”“大文件”这样的不可测描述。超预算先拒绝并反馈，不自动减质或改变用户要求。

## 8. 最小实施顺序与门禁

1. **G0 数据交接小样**：锁定上游提交，验证真实 factory、Canvas/PBR、层级和静态角色；确定唯一构建环境、依赖提供方式、支持矩阵、资源上限和ObjectLoader往返。产出证据，补全§5.2。未通过不进入按钮实施。
2. **G1 资产与旧场景红灯**：先写 T07–T15，扩展 schema/资产加载与就绪，旧场景回归；不加通用代理或插件框架。
3. **G2 一个Skill包、一个范围**：内置资源闭包、许可/hash、官方范围扩展与「3D 编辑」按钮；T01–T06、T20通过。包在安装版所需依赖无保障时不能登记完成。
4. **G3 原工具交付闭环**：接入条件提交、成果打开、现有截图回传，上游分阶段修正；T16–T19通过。
5. **G4 真实用户流程**：一张真实参考图与需求 → 工具调用证据 → 现有编辑器可见 → 旋转/移动 → 关闭重开；另跑一次用户手动机位/录制保留验证，不把它接成自动工作流。
6. **G5 回归与平台验收**：按变更跑定向、完整 focused、类型和桌面构建/产物审计；涉及Rust再跑原生。三平台与安装版逐项留证。发布仍为独立事项，不在本次写TDD授权中。

不以测试全绿代替图片重建效果验收，不以 Mac 开发版成功代替 Intel/Windows，不以一例硬表面模型成功扩写为人物、贴图或任意图片已支持。

## 9. 当前交付与依据

- 本次只写设计文档及知识库索引，不改产品源码、依赖、Skill包、服务器或用户项目。
- T01–T22未新增、未跑红灯/绿灯；G0尚未执行，运行环境/贴图交接尚未验证。本文没有“已接入”结论。
- 用户确认的是产品路径与范围；本合同给出优先承接设计及技术验证门禁，G0结果必须回写，不能把待验证方案当成现成能力。

参考：

- [上游SKILL与阶段合同](https://github.com/img2threejs/img2threejs/blob/954cd5845e90efd045694bab725d68a9863c20e0/SKILL.md)
- [实际factory生成器](https://github.com/img2threejs/img2threejs/blob/954cd5845e90efd045694bab725d68a9863c20e0/forge/stage3_build/generate_threejs_factory.py)
- [根因纠正与视觉评分边界](https://github.com/img2threejs/img2threejs/blob/954cd5845e90efd045694bab725d68a9863c20e0/grimoire/review/self_correction.md)
- [上游架构](https://github.com/img2threejs/img2threejs/blob/954cd5845e90efd045694bab725d68a9863c20e0/docs/ARCHITECTURE.md)
- [Three.js r185 Object3D序列化](https://github.com/mrdoob/three.js/blob/r185/src/core/Object3D.js)
- [[开发/三创作入口删除自建路由与DSH官方Skill范围接入TDD-2026-10-22]]
- [[开发/3D编辑器与Agent四项闭环TDD-2026-10-19]]
- [[开发/3D编辑器快速定位与漫游TDD-2026-10-20]]
- [[开发/通用记忆工作台3D手动运镜录制TDD]]
