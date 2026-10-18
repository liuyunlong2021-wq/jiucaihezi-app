# DSH 0.2.1-rc.2 升级与 SDK 桥接收敛

> 日期：2026-10-18。用户授权：立刻升级，但不打包发布。
> 运行时：`0.2.0-rc.2` → 精确锁定 `0.2.1-rc.2`；App 版本不变。
> 状态：源码与依赖已更新，本地自动验证完成；三平台原生与安装版验收未执行。

## 1. 上游依据与目标

- [rc.1 汇总](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)、[rc.2 发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)。固定源码 `687f282e8625c6b8d11ff58211a90524be2e4317`。
- [SDK 客户端](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/client/README.zh.md)、[协议](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/protocol/README.zh.md)。
- 升级吸收流空闲超时、资源关闭、会话恢复和子任务等待改进；所有既有桌面能力保留。
- 此次 npm 查证 SDK `next=0.2.1-rc.2`，`latest=0.0.1-rc.1`；不使用浮动标签。

## 2. 实施与保留边界

1. SDK、Computer Use 与原生 Cua Driver 三个直接依赖及 subprocess 安装脚本授权同步锁定新版，更新 npm 锁文件；随包 Node 保持 `22.23.2`。锁内 DSH 包均为 `0.2.1-rc.2`，Windows/Intel Mac 的平台依赖仍保留。
2. 准备脚本不再堆叠旧版过渡补丁。保留上游 `createSession` 原实现并委托它创建/恢复、初始化 failure 状态，保留上游 `session/resume`、`session/wait`、工作目录 RPC 与关闭流程。
3. App 的惰性恢复、已激活 Agent 复用与恢复竞争后复查仍由小范围适配承接：普通 prompt/权限操作可续原 Session，不伪造借用 Agent 的销毁权。官方创建先登记 Agent，桥接挂载尚未完成时，其他消费者必须优先等待共享创建 Promise。
4. 官方尚无历史 list/read、权限、审批、队列编辑、轮次取消及文本增量通知 RPC；保留这些桥接和原有 Skill/Wiki/漫剧/小说/短剧绑定。权限仍调用官方命令面，取消仍保留已受理队列。SDK 子进程的 Windows 隐窗、资源裁剪继续保留。
5. `run-task.mjs` 按官方低层协议先订阅、prompt 后 `session/wait`，等待根 Agent、受管理后代与根会话后续汇总；持续转发通知并取得根会话最后正文。首次 idle 不再作为完整任务终点。错误、缺少持久入队回执、传输退出均拒绝并释放订阅；子会话失败不直接覆盖根会话结论。
6. 准备脚本保持布局不符即失败和重复运行幂等。没有修改用户会话、生产配置或发布清单。

## 3. 验证

- 升级前定向基线 45/45。新增官方恢复测试先在旧 SDK 因无 `resumeSession()` 失败，再在新版通过。
- 新版 SDK 定向 49/49（含准备脚本幂等、冷恢复、写锁竞争、审批、队列编辑/停止/steer、创作绑定、完整任务等待和无回执拒绝）。
- 全量 focused Node 2000/2000，零失败/忽略/取消。
- Rust：491 passed / 2 ignored / 0 failed；既有编译 warning 保留。
- TypeScript、修改的运行时代码与生命周期测试定向 lint、`git diff --check` 通过；旧补丁测试文件的三条既有 lint warning 未改。
- 随包 Node `22.23.2` 下真实 SDK 恢复、运行中权限切换、创作 Skill 注入 3/3。
- 独立临时旧运行时使用原锁文件安装真实 `0.2.0-rc.2`，本地 HTTP 模型替身写入 Session 后关闭；新版 `resumeSession()` 恢复同一份存储并继续一轮。两轮历史保留、模型请求恰为两次、无重复投递。测试隔离 DSH_HOME/agents 目录，未读取或升级用户会话。
- 未构建安装包、未发布、未替换安装版、未执行真实收费模型和 Windows/Intel Mac 原生操作。新版 Search/Fetch、模型与 UI 设置入口的实际接通不由本次依赖升级证明。

## 4. 当前合同

本页更新 [[韭菜盒子Harness会话与可选建库统一合同-2026-09-24]] §12.4 的当前版本与补丁实现；该节旧版逐步替换过程保留为历史证据。会话单写者、权限审批与桌面能力保留规则不变。
