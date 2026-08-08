# 通用记忆工作台 Storyboarder 五人物导演预演 TDD

> 状态：已实施，自动验证通过；Desktop 真机人物交互待人工验收
> 日期：2026-08-08
> 目标：把现有 3D 白膜人物升级为可用于机位、角度和构图设计的五种可摆姿势人物

## 1. 目标

用户可以在现有 `.jcscene` 编辑器中放入 Storyboarder 原始人物，调整人物的身高、位置、朝向、头部、四肢和手势，再用现有摄影机、焦段、画幅、截图和保存能力完成导演预演。

第一波只解决“人物如何服务构图”这一件事，不把产品做成建模器、动画器或影片制作器。

## 2. 唯一允许复用的来源

来源仓库：`wonderunit/storyboarder`

锁定技术基线：

```text
8b81a25c71d5f7ca46e8d5b8e3d4f7b3968f95c2
```

只允许接入以下原始文件：

```text
src/data/shot-generator/dummies/gltf/adult-male.glb
src/data/shot-generator/dummies/gltf/adult-female.glb
src/data/shot-generator/dummies/gltf/teen-male.glb
src/data/shot-generator/dummies/gltf/teen-female.glb
src/data/shot-generator/dummies/gltf/child.glb
src/js/shared/reducers/shot-generator-presets/poses.json
src/js/shared/reducers/shot-generator-presets/hand-poses.json
```

五个 GLB 共用原始骨骼命名；姿势和手势数据保持原格式，不重新制作、不重绘、不改骨骼名称。每个资源进入应用前记录来源 commit、相对路径、文件大小、SHA-256 和授权/许可说明。权利人的再分发授权已于 2026-08-08 由项目所有者通过邮件确认，邮件原件由项目所有者保管。

婴儿模型、表情数据、附件、道具和其他 GLB 不属于本 TDD。

## 3. 明确禁止

- 不接入 Storyboarder 仓库以外的任何人物、动作、贴图、材质或模型。
- 不自行建模、重拓扑、重绘人物脸部、制作十字标记或生成新动作数据。
- 不复制 Storyboarder 的 React、Redux、Electron 外壳或约 9,500 行旧 IK 控制器。
- 不新建 3D 场景格式、人物业务 ID、素材市场或独立编辑器。
- 不做灯光系统、房间库、办公桌库、道具库、动画时间线、自动编排和生图联动。
- 不删除当前积木人物；GLB 加载失败时继续显示现有积木人物并提示原因。

## 4. 现有链路复用

```text
.jcscene
  -> parseScene3DDocument / 现有文件服务
  -> Scene3DEditor.vue
  -> Three.js + GLTFLoader + SkeletonUtils + TransformControls
  -> 现有相机、焦段、画幅、截图、手动录制和保存链路
```

不创建第二套状态源。GLB 人物实例只在打开 `.jcscene` 时按需加载；普通对话、Web 启动和没有人物的场景不加载五个 GLB。

## 5. 最小数据合同

在现有 `Scene3DObject` 上增加可选人物字段；旧文件不迁移也能继续打开：

```ts
type Scene3DCharacter = {
  model: 'adult-male' | 'adult-female' | 'teen-male' | 'teen-female' | 'child'
  scale?: number
  bones?: Record<string, [number, number, number, number]>
}
```

约束：

- `model` 只能是五个白名单资源 key。
- `scale` 使用统一缩放表达身高差异，不新增体型 Morph。
- `bones` 只接受模型实际存在的白名单骨骼名和有限四元数。
- 未提供 `character` 的 `person` 继续按现有积木人物渲染。
- 保存的是骨骼四元数和人物变换，不保存运行时 Three.js 对象或外部路径。
- 原始姿势和手势只在 3D 编辑器按需加载；应用后统一保存最终骨骼四元数，不把预设 ID 变成第二套状态源。

## 6. 第一波交互

### 6.1 人物

- 从五个人物白名单中选择模型。
- 整体移动、旋转和统一缩放。
- 头部左右转、抬头、低头。
- 左右肩、上臂、前臂、手腕的局部旋转。
- 左右髋、膝、脚踝的局部旋转。
- 使用原始手势预设；至少能应用放松、张开、握拳、单指指向、双指。
- 现有模型自带的面部朝向标记继续保留；编辑器不得遮挡它。

### 6.2 姿势

不平铺全部 342 个姿势。只从原始 `poses.json` 取当前已验证的七个预设：`stand`、`sit chair`、`crouch inspect`、`walk`、`run`、`point`、`cross arms`。不手写新的骨骼动作，也不承诺上游数据中未验证的躺下或敬礼预设。

### 6.3 摄影机

不改现有摄影机能力。继续复用平视、俯拍、低机位、侧视、透视/正交、广角/标准/长焦、画幅、保存机位、截图和手动运镜录制。

## 7. 红灯测试（先写，当前应失败）

测试文件：`src/runtime/memory/__tests__/scene3d.test.ts` 或与人物资源合同相邻的最小测试文件。

1. **五个人物白名单**
   - 五个允许的 `model` 均可通过场景校验。
   - `baby`、未知 key、绝对路径、远程 URL 均被拒绝。

2. **旧场景兼容**
   - 没有 `character` 的旧 `person` 场景解析结果不变，仍能渲染积木人物。

3. **骨骼白名单**
   - 允许模型实际存在的骨骼四元数。
   - 未知骨骼、NaN、Infinity、错误长度和超范围值被拒绝。

4. **姿势/手势来源约束**
   - 编辑器选项只从原始 `poses.json`、`hand-poses.json` 读取。
   - 应用预设后保存最终骨骼四元数，重开不依赖预设再次求值。

5. **实例隔离**
   - 同一模型复制两次后分别改姿势，两个 skeleton 互不串联。

6. **保存恢复**
   - 保存人物的 `model`、scale、bones、position、rotation 后，重新解析 `.jcscene` 得到相同数据。手势预设只写入最终 bones，不保存 `handPose` ID。

7. **资产完整性**
   - 五个 GLB 均能从应用受控资源目录加载。
   - 任一资源缺失或哈希不符时，场景保留并显示可理解的占位错误，不击穿编辑器。

8. **现有能力回归**
   - 积木人物、方块、排列、机位、截图、手动运镜和对话增量编辑的现有测试继续通过。

## 8. 实施顺序

```text
1. 建立五个 GLB、两个 JSON 的 manifest 与 SHA-256
   -> 验证：来源、授权、路径、哈希齐全；清单外资源为红灯
2. 为 Scene3DObject 增加可选 character 合同与解析校验
   -> 验证：白名单、骨骼、姿势、手势和旧场景兼容测试先红后绿
3. 接入 GLTFLoader 按需加载和 SkeletonUtils.clone
   -> 验证：五个人物可单独/并列打开，实例姿态不串
4. 在现有 TransformControls 上增加最小局部骨骼旋转与预设应用
   -> 验证：头、臂、指、腿能完成构图动作并保存
5. 接通现有 .jcscene 保存、重开、相机和截图
   -> 验证：指尖前景镜头闭环通过
6. 跑 focused tests、typecheck、Desktop 构建和人工 Desktop 矩阵
   -> 验证：Web 不预载 GLB；macOS/Windows 打开、编辑、重开无回归
```

## 9. 第一波验收场景

```text
创建一个 3D 白膜场景。
放入 adult-male 和 child 两个人物。
让 adult-male 右手单指指向前方，头部朝向指尖；child 坐在旁边。
把摄影机放到指尖附近，让手指成为前景，设置近景、低机位、标准焦段。
截图，关闭场景，再打开并核对人物姿态、面朝方向、身高和机位。
```

通过标准：人物身份、脸部朝向、手指方向、坐站关系、摄影机位置、焦段和画幅均可复现；截图非空；重开后无姿态漂移。

## 10. 完成边界

完成本 TDD 只代表五个人物可用于手动导演预演，不代表完成完整 Storyboarder 能力。只有当用户真实使用中证明“手动转骨骼仍不够快”时，才另写 TDD 评估 IK；只有方块无法表达空间关系时，才另写资产接入 TDD。

## 11. 实施回执

- 从锁定 Storyboarder commit 原样接入成年男、成年女、少年男、少年女、儿童五个 GLB，以及完整原始姿势和手势 JSON；manifest 固定来源路径与 SHA-256。
- 五个 GLB 作为 Tauri Desktop 资源打包，不进入 Web `public/`；打开 `.jcscene` 且存在 `character` 时才通过 `GLTFLoader` 加载，同模型实例通过 `SkeletonUtils.clone` 隔离。
- 现有人物对象增加可选 `character.model / scale / bones`，旧积木人物合同不变，非法模型、外部路径、未知骨骼和非法四元数会被拒绝。
- 编辑器已提供五模型切换、整体移动/转向、身高缩放、七个原始全身姿势、五个原始手势的左右手应用，以及头、颈、手臂、腿和食指骨骼旋转。
- 姿势和手势只在异步 3D 编辑器块加载；应用后保存 54 个有效骨骼的最终四元数，关闭重开不重新推导姿势。
- 自动验证：场景/资源/工作台/Desktop 工具定向测试 84 项通过，TypeScript、完整 focused/Tauri 测试与 Desktop quick build、Desktop dist 审计通过；五个原始 GLB 已实际并列渲染，画布非空且人物姿势修改可见。真实 Desktop 编辑器内的拖动骨骼、截图和关闭重开仍需人工验收。

## 12. 五个 P1 根因修复回执（2026-08-08）

1. Tauri CSP 的 `connect-src` 允许 `asset:` 和 `http://asset.localhost`，使 `GLTFLoader` 可以通过 `fetch` 加载受控资源。
2. Windows 便携 ZIP 复制 `release/storyboarder` 目录，并在 smoke test 中校验 manifest 与五个 GLB，避免只带 EXE 导致人物不可用。
3. 切换人物模型时删除旧 `bones`，不把其他模型的 54 根骨骼四元数套用到新模型。
4. 人物 GLB 加载过程有可见的加载中/失败提示；姿势、手势和骨骼控件在加载或失败时禁用，失败仍保留积木白模。
5. 骨骼四元数只接受四个有限的真实数，并要求模长接近 1；拒绝布尔、字符串、零四元数和超大数。

TDD 回归：新增的联合合同测试 67 项全部通过；完整 `pnpm run test:focused` 通过（包含 Tauri 396 项，1 项按设计忽略）；`pnpm run build:desktop:quick` 与 Desktop dist 审计均通过。

## 13. P2 质量收口回执（2026-08-08）

- 每次重建场景都释放旧积木、标签、材质和纹理；人物克隆与缓存模板共享的 GPU 资源只在编辑器卸载时统一释放。
- 骨骼拖动结束的同一次 `pointerup` 不再触发场景重选，骨骼编辑状态不依赖事件监听器注册顺序。
- 人物模型、姿势、手势和骨骼按钮使用与原有 3D 工具一致的默认、悬停、选中和禁用样式。
- `create_3d_scene` 工具 Schema 现在要求 `character.model`，并把 bones 的值限定为四个 `[-1, 1]` 数字；运行时继续负责骨骼白名单和单位模长校验。
- 测试锁定 `SkeletonUtils.clone`、原始预设来源、积木回退、GPU 释放、骨骼选择、按钮样式、嵌套 Schema、文件字节数与 SHA-256。
- manifest 已记录七个原始资源的真实字节数与邮件授权事实；TDD 删除了未实现的躺下、敬礼和 `handPose` 持久化承诺。

P2 回归：定向合同测试 88/88；完整 focused 前端测试 1010/1010；Tauri 396 通过、1 项按设计忽略；Desktop quick build 与 dist 审计通过。
