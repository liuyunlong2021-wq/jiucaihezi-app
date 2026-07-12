# 0706-xiaobug 并发审计 — 2026-07-07

审计范围：@mention/autocomplete 重构 + 右键菜单修复 + GitHub 导入提醒

## 🔴 高风险

### 1. useFilteredList.reload() — stale async 覆盖（已修复）

**文件**: `src/composables/useFilteredList.ts:28`

**场景**: 用户快速输入 "@xy" → `onInput` 触发两次 reload：
1. reload("@x") 开始，读取 filter="x"
2. reload("@xy") 开始，读取 filter="xy"
3. reload("@xy") 完成，grouped = [xy 的结果]
4. reload("@x") 完成，grouped = [x 的结果] ← **覆盖了 xy 的结果！**

**根因**: `reload()` 没有版本控制，后完成的结果可能被先完成的结果覆盖。

**修复**: 加 `reloadVersion` 计数器，每次 reload 递增，完成后检查版本：
```ts
let reloadVersion = 0
async function reload() {
  const version = ++reloadVersion
  // ... async work ...
  if (reloadVersion !== version) return // discard stale
  grouped.value = groups
}
```

## 🟡 中风险

### 2. addPart 操作后 popover 未 cleanup

**文件**: `src/components/chat/ChatPanel.vue:closePopover()`

**场景**: `handleAtSelect` → `addPart` → `closePopover`。
`addPart` 修改 DOM（选区/节点），`closePopover` 只设 `popover = null`。
如果 `addPart` 抛异常，popover 保持打开但光标已移动。

**影响**: 低概率。`addPart` 内无 async，异常仅来自 Selection API。

**缓解**: `handleAtSelect` 已有 `try` 结构（隐式通过 `closePopover` 在 addPart 之后），但如果 addPart 抛异常，popover 不会关闭。建议加 try/finally：

### 3. 两个 useFilteredList 实例同时加载

**文件**: `src/components/chat/ChatPanel.vue`

**场景**: `atItems` 和 `slashCommands` 各自有 `useFilteredList` 实例，setup 时都调用 `void reload()`。即使用户没有输入 @ 或 /，两个 fuzzysort 查询都在跑。

**影响**: 极小。首次加载只做一次，后续只在用户输入时触发。skill 列表很小（几十个），fuzzysort 毫秒级。

**建议**: 不必修复，保持现状即可。

## 🟢 无风险

### 4. DOM 操作：addPart / createPill / getCursorPosition

所有操作同步，无 async，无竞态。Selection/Range API 调用符合 W3C 规范。

### 5. MentionPopover pointermove + click

`pointermove` 设 `activeKey`（同步），`click` 调 `handleAtSelect` → `closePopover`。即使用户在 pointermove 和 click 之间移动鼠标，popover 关闭后指针事件不再处理。安全。

### 6. handleSend 后 contenteditable 清空

`editor.textContent = ''` 是同步操作，在 `sendMessage` 之前完成。没有竞态。

### 7. 右键菜单边缘检测

`clampCtxMenu` 纯计算，无副作用，无 async。安全。

### 8. GitHub 导入成功提醒

`importDone` ref 在 `await store.importGitHubRepoSkills()` 后设为 true，UI 切换为完成状态。import 期间的错误走 catch 分支，不会设 `importDone`。安全。

### 9. handleInput 中 @ 和 / 的优先级

`@` 检测在 `/` 之前。如果用户输入 `@/test`，`atMatch` 先匹配（因为 `/` 不是 `\S`），正确。如果只输入 `/test`，`atMatch` 为 null，走 `slashMatch`。正确。

## 需要修复

| # | 严重 | 文件 | 问题 |
|---|------|------|------|
| 1 | 🔴 | useFilteredList.ts:28 | reload stale async — 加版本号去重 |
| 2 | 🟡 | ChatPanel.vue:handleAtSelect | addPart 后 popover 未 try/finally cleanup |
