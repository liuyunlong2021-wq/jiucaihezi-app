# 任务交接给 DeepSeek：图标系统最终修复（offline mode + 本地 bundle）

> 上次你做的 Phase 1/2A/2B/2C 结构上是对的，但 JcIcon 用了 `@iconify/vue` 的默认 API mode，运行时从 `api.iconify.design` 拉 SVG，被 CSP 拦截，图标全挂。
>
> 这次一次性把根因修了：切到 offline mode + 本地打包 bundle。零外部请求，CSP 不用动。
>
> 复制下面整段（包括三个反引号）粘给 DeepSeek。

---

```
继续图标系统修复，这次做最终修复（一次性完成，不分阶段）。

## 项目位置
/Users/by3/Documents/jiucaihezi-app

## 任务
完整阅读并严格执行：
docs/handover/icon-system-final-fix-execution.md

执行完后**不要 commit、不要 push**，保留 dirty worktree 等我人工 review。

## 边界（硬性，不允许越线）
1. **不要往 CSP 里加 api.iconify.design** — 这是治标不治本，本次任务的目的就是消除外部 CDN 依赖
2. **不要回退 Phase 1/2A/2B/2C 的任何改动** — 它们结构是对的
3. **不要换图标库**（保留 @iconify/vue + Material Symbols 体系，只切到 offline mode）
4. **不要装 unplugin-icons** — 它不支持动态 name prop
5. **不要碰 src-tauri/lib.rs、capabilities/** — 本次只动 tauri.conf.json 也只有必要时
6. **不要修改 main.ts 现有的启动逻辑**（boot/initBackend/mountApp 函数体不动）

## 重点新增 / 修改
- 装 @iconify-json/material-symbols 作为 devDependency
- 新建 scripts/bundle-icons.mjs（扫描 + 生成 bundle）
- 新建 src/assets/icons-bundle.json（生成的产物，本身不需要手写）
- 改 src/components/icons/JcIcon.vue 用 addCollection 加载本地 bundle
- 改 package.json 的 build / build:desktop 脚本，加入 bundle 生成步骤

## 中间确认点
跑完 bundle script 第一次后**停下来汇报**：
- 收集到多少图标
- bundled 多少
- ⚠️ unmapped 列表（在 Material Symbols Iconify 包里找不到的图标名）
等我确认 unmapped 处理方案后再继续后续步骤。

## 完成后向我汇报
- 改/新增/删除的文件清单
- git diff --stat 输出
- bundle 体积（KB）
- 完整 4 步验证结果（vue-tsc / vite build / tauri dev / 模拟生产）
- 任何文档没明说、你自主决策的地方

## 出错时
- 类型错：贴出错信息说你打算怎么修
- 某些图标 bundle 不到：列出来问我（可能要加 ICON_ALIAS 或换名）
- vite build 报 JSON 导入错：贴出报错，可能要调 tsconfig 的 resolveJsonModule
- 任何超出文档范围的疑问：停下来问我

开始吧。
```
