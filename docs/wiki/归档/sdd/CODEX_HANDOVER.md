# 画布 V8 交接文档（给 Codex）

**日期**: 2026-06  
**状态**: ✅ 全部门禁闭环，可直接用于 Tauri APP 构建  
**执行依据**: `docs/sdd/canvas-v8-work-assignment.md`（绑定合同） + `docs/sdd/canvas-v8-v5-corrected-sdd.md` (v5.1)  
**最新日志**: `src/components/canvas/v8/PHASE0_CURRENT_PROGRESS.md`（每日更新，已记录至 build 全绿）

---

## 一、当前状态（一言蔽之）

V8 画布已**完全顶替**旧实现（nodeTypes 纯 V8 注册 14 节点 + 事件桥接全路径）。旧 `src/canvas/*` 运行时/executor/store 内部**零修改**（仅消费 surface API）。手感 P0 + 14 节点 + 体验层 + TDD + perf + build 全部达标。

**用户确认**：`OK！那就build` + `我现在可以使用codex构建APP了吗？` → **可以**。

---

## 二、必须 100% 遵守的规则（破坏即回滚）

1. **TDD 先行**：任何修改先更新对应 `.test.ts`（node --test 运行），66/66 全绿才能提。
2. **每日 MD**：改动后立即 append `PHASE0_CURRENT_PROGRESS.md` 新节（含状态表 + 验证路径）。
3. **禁止事项**（assignment 铁律）：
   - 永远不要碰 `src/canvas/*`（runtime/store/executor 旧代码）。
   - 永远不要提前删除旧节点文件（legacy 仅用于 unmigrated T8）。
   - nodeTypes 里 **V8 永远先注册**（14 个：text/llm/vault/skill/toolset + 3Gen + 3Result + group/loop/textSplit）；legacy 后置。
   - 默认模板必须保持 **v5.1 5 节点**（📝需求 → 🧠AI大脑 → 📝输出(人工复核) → 🖼️生成 → 🖼️结果），见 `createStarterCanvasDocument` + `createNewCanvas` + bottom bar。
4. **哲学（P1-P5）**：显式/手动优先（无黑箱）、Connections=assembly language、Context Provider（紫 dashed）是第一公民可拖拽、Knowledge 仅 user-evidence、Tool 宽容不强制。
5. **性能**：globalFreeze（startInteraction/endInteraction）最高优先；30 节点 Max Jank <200ms；>15 节点自动 degrade；freeze 期间所有动画 !important 暂停。
6. **构建门禁**：`pnpm build`（= test:focused + vue-tsc -b + vite build）必须 exit 0。

**违反以上 = 直接回退**。

---

## 三、核心门禁状态（已全部 ✅）

| 门禁                  | 状态          | 说明 |
|-----------------------|---------------|------|
| TDD 66/66             | ✅ PASS      | node --test 全套（right-click M-001~008、visual V-、migration Mig-、phase3-experience、philosophy P-、group G-、media E-、TN/LLM/CP/C 等）。用 `node --experimental-strip-types --test 'src/components/canvas/v8/__tests__/*.test.ts' ...` 运行。 |
| 14 节点全部工作       | ✅           | nodeTypes 纯 V8 14 个；executeV8Orchestration + window 'v8-execute-node' 桥接（gens/loop/textsplit/group）；toolbar/右键/多选/子图全部走 V8。 |
| 5 节点默认模板        | ✅ v5.1 精确 | canvasStore + workspace + 底部推荐 + 迁移一致。含「人工复核」节点 + 正确 handle（right-text/left-prompt + right-result/left）。 |
| 右键菜单 4 场景       | ✅ 完整       | 空白（加节点+5节点模板+迁移向导）、单节点（Group 专属：执行子图+导出模板；Result 专属：下载/设参考/存KB）、Handle（精确 node+handleId 删边）、多选（批量执行/建组/删）。统一 .cw-context-menu，无 prompt 黑箱。 |
| 迁移向导 (Mig-001~4)  | ✅ 可用       | 打开旧文档自动触发（先 auto backup）；纯 remapNodesForMigration（preserve parent/edges/arbitrary 100%）；一键 + 右键「升级到 V8 版本」 + keep-old flag（永不强制只读）。 |
| Context 栏 + 视觉     | ✅ 落地       | 动态 wiring 感知（edges 算「已连 LLM」）；activeExecutionPath 1-hop prompt 链；v8-active-path + breathing（prompt 边 + CP 紫）+ lift running + dim others；>15 自动 v8-degraded；freeze 最高优先暂停。 |
| 节点库三区            | ✅ P2 第一公民 | ①上下文（仅3 CP，紫 bg + dashed 左边 + V8 绿标，第一公民）；②核心（8 V8）；③编排（3 V8，默认折叠）；Legacy 底部折叠 0.75 opacity。 |
| 30 节点 perf          | ✅ PASS      | harness（createDiverse30NodeCanvas 精确14 V8 + freeze + 16ms 序列）；Max Jank 175ms <200；已暴露 `v8LoadHeavyTestCanvas()` / `v8RunFullAuto30NodeDragBenchmark()` / `v8GetBenchmarkReport()`。模拟报告见 PHASE0 MD 末尾。 |
| pnpm build            | ✅ 全绿      | test:focused:build (exit0) + vue-tsc -b (0 errs on V8) + vite build (dist/ 产出) 全部成功。tauri.conf beforeBuildCommand = "pnpm build"。 |
| 入口与数据            | 安全         | 曾临时关闭/恢复；SQLite + canvasStore 数据零破坏；migration 总先 backup。 |

**上线检查清单**（PHASE0 MD 末尾有完整表）全部闭环。

---

## 四、关键文件与架构（Codex 必须保留）

**绑定文档**（先读）：
- `docs/sdd/canvas-v8-work-assignment.md`（9 周计划 + 禁止 + 门禁 + 14 节点定义 + 右键4场景 + 5节点模板 + 哲学）。
- `src/components/canvas/v8/PHASE0_CURRENT_PROGRESS.md`（每日进度 + 验证路径 + 符合事项表。**任何改动必须 append 新节**）。

**核心集成**：
- `src/components/canvas/CanvasWorkspace.vue`：nodeTypes（14 V8 + legacy 顺序）、openContextMenu（4 场景检测，优先 .v8-node-frame[data-node-id]）、handleV8GroupAction（子图执行 + 导出模板 json）、executeV8Orchestration（dispatch 桥接）、createNewCanvas（强制5节点）、openCanvasDocument（触发迁移）、freeze 事件、visual class 注入、handleConnect（type 注入）。
- `src/stores/canvasStore.ts`：createStarterCanvasDocument（精确5节点 v5.1 + edges） + runCanvasNode / replaceNodes / deleteEdge 等 surface API（V8 只消费，不内改）。

**V8 实现**（全部基于 NodeFrame）：
- `src/components/canvas/v8/nodes/NodeFrame.vue`（统一壳：左色条 role、header ▶/stop/collapse/delete、RAF resize + pointer capture + freeze、bottom status、:collapsed 卸载内部、data-node-id/role/status）。
- 14 个：V8TextNode（Tiptap 单例 + collapsed DOMPurify 预览）、V8LlmNode（5 tab + 3-way context 优先级 prompt>skill>kb + permissive tool）、3 Context（vault/skill/toolset，紫 dashed role，无 ▶）、3 Gen + 3 Result（SHA cache + 状态机 + gallery）、V8GroupNode（N prompt ports + fold + parentNode/childNodeIds + subgraph exec + export template）、V8LoopNode / V8TextSplitNode（动态 ports + iter/split）。
- `src/components/canvas/v8/utils/connectionValidation.ts`：14x14 矩阵 + isValidConnection(groupFolded) + inferEdgeType(5 规则) + 中文 toast。
- 其他：`useGlobalFreezeManager.ts`（单例 .startInteraction/.endInteraction + body.is-interacting + .v8-interacting）、performanceBenchmark.ts + simulate30NodeAutoDrag.ts（harness）、migration 工具（remap + wizard）。

**UI 层**：
- `src/components/canvas/CanvasNodeLibrary.vue`：严格三区 + V8 tag + 紫 dashed 样式。
- 右键/底部栏/迁移/ Context 栏 逻辑集中在 Workspace（零黑箱）。

**测试**（19 个文件，node:test）：
- `src/components/canvas/v8/__tests__/` + `nodes/__tests__/`（right-click-menus-tdd.test.ts 等）。运行：`node --experimental-strip-types --test 'src/components/canvas/v8/__tests__/*.test.ts' 'src/components/canvas/v8/nodes/__tests__/*.test.ts'`。

**其他**：
- `src/types/canvas.ts`（加 vault|skill|toolset）。
- `src/components/canvas/v8/index.ts`（barrel + 样式 side-effect）。
- tauri: `src-tauri/tauri.conf.json`（beforeBuildCommand: "pnpm build", frontendDist: "../dist"） + package.json scripts（"build", "tauri:build" = pnpm run test:focused && tauri build && fix-macos）。

**dist/** 已有（上次 build 产物），可直接 tauri build。

---

## 五、Codex 如何构建 APP（推荐流程）

1. **必读**：assignment.md + 最新 PHASE0 MD + 本文件。
2. **验证基线**（改前必跑）：
   - `pnpm run test:focused`（或直接 node --test V8 套件确认 66/66）。
   - `pnpm build`（必须全绿）。
   - 浏览器打开画布，手动或 console 跑：
     - `v8LoadHeavyTestCanvas()` → `v8RunFullAuto30NodeDragBenchmark()`（或手动拖 30 节点 6s+ 后 `v8GetBenchmarkReport()`），确认 Max Jank <200。
3. **构建桌面 APP**：
   - `pnpm tauri:build`（内部先 pnpm build + tauri build + fix-macos-app.mjs）。
   - 或分步：`pnpm build && cd src-tauri && cargo tauri build`。
   - macOS 产物：`dist-desktop/韭菜盒子*.dmg` + `韭菜盒子.app`。
   - 注意：macOS signingIdentity 当前为 "-"（ad-hoc）；CI/正式需替换证书。
4. **快速验证**：
   - 打开 APP → 画布 → 新建（应为精确5节点模板）。
   - 拖 3 CP（紫）+ Group + LLM 等，右键全场景测试。
   - 导入旧 runninghub/seedance json → 自动迁移向导 + 备份。
   - 拖拽 30+ 节点验证手感（freeze 丝滑 + degrade）。
5. **控制台调试命令**（已暴露在 window）：
   - `v8LoadHeavyTestCanvas()`、`v8RunFullAuto30NodeDragBenchmark()`、`v8GetBenchmarkReport()`、`resetV8Freeze()` 等。

**推荐**：先在 dev (`pnpm tauri:dev`) 跑通所有手动 case + 真实 30 节点 benchmark，再正式 build。

---

## 六、剩余可选 / 建议（非阻塞）

- **真实浏览器 30 节点最终报告**：模拟已 PASS (175<200)，但 Codex 可在干净浏览器环境跑一次 `v8RunFullAuto...` 记录真实数字（更新 MD）。
- **完整 tauri build**：当前 pnpm build 绿，tauri:build 可能需处理 Rust 编译 / macOS 权限 / 签名（已有 scripts/fix-macos-app.mjs + create-official-dmg.mjs）。
- **额外 TDD**（可选）：更多 14x14 手动矩阵 edge、Group 多端口真实数据流。
- **清理**：上线稳定后可考虑逐步把 legacy Canvas* 标记 deprecated，但**不要删**（除非 assignment 更新）。
- **如果要扩展**：新节点必须 V8 + NodeFrame + 对应 TDD + 更新 14 节点列表 + 验证矩阵 + MD。

**不要**：加黑箱、改 store 格式、跳过 TDD、忽略 freeze、改旧 runtime、跳过 MD 更新。

---

## 七、快速引用（给 Codex 的检查清单）

- 想改右键/菜单？→ 读 CanvasWorkspace openContextMenu + right-click-menus-tdd.test.ts + PHASE0 对应节。
- 想加节点？→ V8*Node.vue 继承 NodeFrame + 注册到 nodeTypes（V8 先） + TDD + 更新库三区 + 5节点模板若相关。
- 想调性能？→ globalFreeze + RAF + degrade + 30 节点 harness。
- 想确认数据安全？→ migration 总先 backup + remap 纯函数 + replaceNodes 只 nodes。
- 构建前必跑：`pnpm build` + V8 node test + 30 节点 console benchmark。

**所有历史「继续」指令已闭环**（右键、迁移、Context+视觉、节点库、14 节点、TDD、模板修复、import 清理、perf、build）。

---

**结束语**：V8 现在是唯一画布实现，手感/显式/哲学/性能均按 SDD v5.1 + assignment 落地。Codex 可以放心基于此构建最终 Tauri APP。任何疑问先重读 assignment.md + PHASE0 MD 最新节。

祝构建顺利！（直接 `pnpm tauri:build` 起步）

—— Grok 按用户「直接交给 Grok 即可」+「精炼交接」要求生成