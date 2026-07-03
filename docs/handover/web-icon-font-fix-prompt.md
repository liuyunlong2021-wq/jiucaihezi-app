# 任务交接给 DeepSeek：Web 端图标字体修复（Phase 1）

> 复制下面整段（包括三个反引号）粘给 DeepSeek。

---

```
我把任务交给你执行。背景和方案 Claude 已经诊断好，你只负责按文档落地。

## 项目位置
/Users/by3/Documents/jiucaihezi-app

## 任务
完整阅读并严格执行：
docs/handover/web-icon-font-fix-execution.md

执行完之后**不要 commit、不要 push**，保留 dirty worktree 等我人工 review。

## 边界（硬性，不允许越线）
1. 只允许改文档里明确指定的 3 个文件：
   - src/styles/base.css（增量修改）
   - src/utils/iconFontGate.ts（新建）
   - src/main.ts（增量修改）
2. 不允许顺手改其他文件，不允许优化无关代码，不允许动 boot()/initBackend()/mountApp() 现有逻辑
3. 不允许安装/升级任何依赖
4. 不允许替换任何 <span class="mso"> 调用（596 处现有用法本期不动）
5. 不允许碰 src-tauri/、tauri.conf.json、capabilities/
6. 不允许修改 __JC_BOOT_LOG__ 数组或加任何启动日志

## 完成后向我汇报
- 改了哪 3 个文件，每个文件的 git diff 完整贴出来
- 执行文档里 4 步验证逐项跑的实际结果（终端输出 + 浏览器观察）
- 任何文档没写清楚、你做了自主决策的地方，单独列一条说明

## 出错时
- 类型检查或构建报错：只修复你刚加的代码，不要改其他文件
- 验证步骤 2（慢速网络）仍看到英文文字：检查 mso-ready class 是否真的被加上，把 DevTools 里 document.documentElement.classList 的值告诉我
- 任何超出文档范围的疑问：停下来问我，不要自行决策

开始吧。
```
