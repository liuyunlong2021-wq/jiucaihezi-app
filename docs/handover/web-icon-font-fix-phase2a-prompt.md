# 任务交接给 DeepSeek：Web 图标字体修复 · Phase 2A

> Phase 1 已完成（你上次跑的）。这次做 Phase 2A：引入 `<JcIcon>` 包装组件 + codemod 替换 596 处静态调用。**本期零渲染行为变化**——包装组件内部仍然用 Material Symbols 字体，只是统一了入口。
>
> 复制下面整段（包括三个反引号）粘给 DeepSeek。

---

```
继续上次的图标字体修复任务，这次做 Phase 2A。

## 项目位置
/Users/by3/Documents/jiucaihezi-app

## 任务
完整阅读并严格执行：
docs/handover/web-icon-font-fix-phase2a-execution.md

执行完后**不要 commit、不要 push**，保留 dirty worktree 等我人工 review。

## 边界（硬性，不允许越线）
1. 不要装任何新依赖（Iconify、unplugin-icons、@iconify-json/* 都是 Phase 2C 的事）
2. 不要碰任何**动态**图标用法（`<span class="mso">{{ x }}</span>` 或 `:class` 计算 mso 的情形）——本期只处理硬编码字面量
3. 不要碰这 6 个动态映射函数：statusIcon、iconFor（两个）、getIcon、fileStatusIcon、toolLabel（这些是 Phase 2B 的事）
4. 不要碰 PlatformIcon.vue（Phase 2B 的事）
5. 不要删除 base.css 里的 `.mso` / `.mso-fill` 规则、不要删字体文件、不要碰 iconFontGate.ts、不要碰 mso-ready 逻辑
6. 不要碰 src-tauri/、tauri.conf.json、capabilities/
7. 不要碰 `<span class="material-symbols-outlined">`（应该没有，但万一遇到也别动）

## 必须做的事
- 创建 src/components/icons/JcIcon.vue（facade 组件）
- 在 src/main.ts 全局注册 JcIcon
- 创建 src/types/components.d.ts 提供 TypeScript 类型
- 写 scripts/codemod-mso-to-jcicon.mjs（codemod 脚本）
- **先 dry-run 跑一次，把统计结果汇报给我**
- 等我确认后再 --write 真跑
- 跑完做 4 步验证

## 完成后向我汇报
- codemod dry-run 阶段：匹配到的总数、按类型分布、可能漏掉的 N 处的样例（file:line）
- 等我说「确认」之后再真跑
- 真跑后：改动文件数、git diff --stat 输出
- 4 步验证逐项结果
- 任何文档没明说、你自主决策的地方

## 出错时
- 类型检查或构建报错：贴出报错，说你打算怎么修
- codemod 漏掉很多：贴出 5-10 个漏掉的例子，问我怎么处理
- 任何超出文档范围的疑问：停下来问我，不要自行决策

开始吧。
```
