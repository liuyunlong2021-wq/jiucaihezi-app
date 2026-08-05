# 热缓存

> 更新：2026-08-04 | 阶段：记忆工作台单产品化分离准备

## 当前结论

- **唯一产品边界：保留记忆工作台现在拥有的全部功能；记忆工作台现在没有的功能全部迁出。** OpenCode、旧 Studio、文/武/道/创、电商、漫剧、制作工作台均属迁出范围。共享代码只要仍被记忆工作台直接或间接依赖，就必须保留，不能按目录名删除。唯一实施合同见 [[开发/通用记忆工作台单产品化分离SDD]]。
- 记忆工作台继续保留项目中心与文件树、Raw 对话、快速/记忆模式、完整 Wiki 能力、项目内工具、附件与文档转换、Markdown 阅读编辑、`.canvas` / `.jccanvas` / `.jcscene`、媒体生成、登录/模型/Skill/MCP，以及当前 Desktop、Web、Mobile 各自已经具备的能力。
- **文字云合同只有两个手动动作：** `上传并覆盖云端`以本地完整可同步文字快照覆盖云端，`下载并覆盖本地`以云端完整可同步文字快照覆盖本地。两者都不合并、不创建冲突副本、不自动双向同步；媒体、空目录、凭据、设置、Skill、MCP、Provider、Session 和 `.raw/.sync` 不比较、不传输、不删除。设置页只显示状态，操作只在项目中心。
- 发布身份不得因分离改变：Desktop `com.jiucaihezi.desktop`、Mobile `com.jiucaihezi.mobile`、`jiucaihezi://`、正式 Web <https://jiucaihezi.studio>、现有更新地址与公钥、应用数据目录、账号及云项目绑定全部保持连续。

## 已验证 / 未验证

- `v2.1.9` 已发布：`main` 与 tag 指向 `f302c251`；Web Production 正式域名返回 HTTP 200；GitHub Actions `30904082094` 的 macOS ARM、macOS Intel、Windows x64 和发布清单均成功；生产 `latest.json` 返回 `2.1.9`。
- 方向性文字覆盖已通过 focused `1438/1446`、TypeScript、Web quick build 和产物审计；真实 Web/Desktop/iPhone 覆盖删除矩阵仍待人工验收。
- Wiki 状态查询已按 append-only 合同改为从 `log.md` 末尾读取最新标题；应用内运行时 `12/12`、Wiki Skill 专项 `18/18`、完整 focused 与 TypeScript 通过，当前状态正确显示 2026-08-04 的最新决策。
- iOS 仍是已提交审核的 `2.1.7 (2.1.7.1)`，Android 无公开版；桌面三平台发布不等于 App Store 或 Google Play 上架。
- 单产品化分离尚未改代码、移动目录或删除文件。`v2.1.9` / `f302c251` 是正式回滚基线。
- 分离 SDD 已列出整目录保留、确认移出、混合目录拆分和禁止删除清单。`runtime/workbench` 的媒体文件、`public/skills/`、发布身份与用户数据永久保留；`opencodeClient` 必须等 `agentStore`、创作面板和全局搜索解除依赖后再迁出。

## 下一步

- 先读 [[开发/通用记忆工作台单产品化分离SDD]] 第 3 节，再初始化独立备份仓库并按 TDD 建立记忆入口、能力、身份和产物门禁；测试通过前不移动任何目录。
