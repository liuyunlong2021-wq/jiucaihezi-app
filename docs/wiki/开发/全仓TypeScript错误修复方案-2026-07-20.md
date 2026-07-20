# 全仓 TypeScript 错误修复方案

> 日期：2026-07-20
> 目标：清除 `pnpm exec vue-tsc -b` 当前报告的 16 个错误，不改变产品功能。

## 根因归并

| 根因                                              | 错误数 | 最小修复                                                                     |
| ------------------------------------------------- | -----: | ---------------------------------------------------------------------------- |
| `Uint8Array<ArrayBufferLike>` 不能作为 `BlobPart` |      3 | 创建新的 `Uint8Array` 副本后传给 `Blob`，确保其底层为标准 `ArrayBuffer`。    |
| 创作面板动态字段类型过宽                          |      3 | 使用现有 `CreationFieldSpec`；桌面文件选择只接受当前插件实际返回的文件路径。 |
| 文件树异步节点和生命周期事件类型丢失              |      5 | 在 `await` 前保存已判空节点；给事件变量显式标注已有的两个字面量联合类型。    |
| ZX 上游渠道新增后标签表未同步                     |      3 | 在三个现有完整标签表补一项 `zx: 'ZX'`。                                      |
| 批量冲突过滤的类型谓词与可选字段矛盾              |      1 | 使用与 `ProjectBatchConflict` 一致的冲突对象类型，不收窄为不兼容的必填字段。 |
| 插件目录只读标签写入可变状态                      |      1 | 复制标签数组后再写入 Store。                                                 |

## 修改边界

- `src/components/creation/CreationPanel.vue`
- `src/components/filetree/ProjectFileTree.vue`
- `src/runtime/creation/creationMediaPlan.ts`
- `src/runtime/creation/creationModelRegistry.ts`
- `src/services/projectFileService.ts`
- `src/stores/pluginStore.ts`
- 仅在已有测试无法覆盖契约时补最小测试。

不改模型接口、媒体任务状态机、文件树行为、批量操作语义或插件数据内容。

## 执行与验收

1. 先以当前 `vue-tsc -b` 作为失败基线。
2. 按上述六组逐项修正类型边界，保持运行时数据不变。
3. 运行关联的 focused tests。
4. 运行 `pnpm exec vue-tsc -b`，必须零错误。
5. 运行格式、静态检查和 `git diff --check`。

## 风险控制

- 二进制数据只复制，不转换、不压缩、不改变 MIME。
- 文件树只增强 TypeScript 的空值和字面量识别，不更改分支条件。
- ZX 只补展示标签；模型注册、请求路径和轮询均不动。

## 验证结果

- `pnpm exec vue-tsc -b`：通过，原 16 个错误归零。
- 相关合同测试：16/16 通过，覆盖创作模型计划、文件树与项目文件服务。
- `oxfmt --check` 与 `git diff --check`：通过。
- 另有 11 个既有行为测试仍失败：它们期待已被工作区其他改动替换的 Web 媒体读取实现与已移除的模型注册项；本次不修改这些行为测试或恢复已移除模型。
