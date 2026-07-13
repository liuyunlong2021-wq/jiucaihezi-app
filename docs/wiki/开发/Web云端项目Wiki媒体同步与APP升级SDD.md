# Web 本地优先项目、Skill Wiki 与媒体处理 SDD

> 状态：设计确认稿，实施前置文档
> 日期：2026-07-14
> 核心策略：Web 先能完整创作，免费优先；云同步和 APP/Web 互通最后实施

## 1. 一句话决策

当前阶段不建设 D1 项目库，不用 R2 长期或临时保存用户媒体，不做 APP/Web 数据同步。

Web 项目、Wiki 和文本先保存在用户当前浏览器的 IndexedDB；图片和视频不复制进平台云存储，保留上游 URL 或用户本地引用，并提供“另存为”和整项目导出。服务器只负责现有 LLM/API 链路，以及按需对用户明确选择的单个视频做临时 FFmpeg 抽帧。

## 2. 为什么这样做

产品核心是漫剧生产。一个项目可能积累大量图片、音频和数小时视频，平台替所有用户长期保存媒体会持续产生存储、流量和备份成本，免费产品无法承担。

当前真正需要完成的是：

1. Web 有和 APP 相近的项目文件树；
2. Skill 能在 Web 项目中执行自己的建库能力；
3. LLM 能按需读取和写入 Wiki；
4. 创作面板产生的素材能预览、引用、分析和另存为；
5. 不因为云同步延迟 Web 上线。

## 3. 本阶段目标

### 3.1 项目与文件树

- Web 第二列增加项目和文件树；
- 文件树数据存入 IndexedDB；
- 支持目录、Markdown、文本、图片、视频、音频和素材引用；
- 刷新页面后项目仍在；
- 当前浏览器是 Web 项目的唯一真源；
- 换浏览器、清理站点数据或换电脑不会自动恢复，必须通过项目导出/导入迁移。

### 3.2 Skill 自己建库

项目不是自动生成通用 Wiki。用户选择 Skill 后，由 Skill 自身定义并执行建库能力。

以 `public/skills/JC-短剧-世界模型` 为事实源：

- `SKILL.md` 定义 `.raw/`、`wiki/`、`CLAUDE.md` 和写作流程；
- `scripts/scaffold_wiki.py` 定义一键建库行为；
- `references/` 提供建制、续写、调性和质量规则。

Web 只负责执行 Skill 输出的文件操作，不在产品代码里另造一套固定 Wiki 模板。

### 3.3 渐进式上下文

```text
用户输入
  + 当前 Skill 的必要内容
  + 项目 CLAUDE.md
  + wiki/hot.md 或 wiki/index.md
  ↓
LLM 判断还缺什么
  ↓
wiki_search / wiki_read
  ↓
生成内容
  ↓
wiki_mkdir / wiki_write
  ↓
IndexedDB 与文件树立即更新
```

不把整个 Wiki 每轮塞进模型。`CLAUDE.md` 是导航，`hot.md`/`index.md` 是快速记忆，具体文件由工具按需读取。

## 4. 非目标

- Web 不启动 OpenCode；
- 不把 Desktop 的 `openCodeSyncStore` 直接搬到 Web；
- 不给用户开放服务器宿主机 Shell；
- 不做 D1 项目同步；
- 不做 R2 媒体存储；
- 不做 APP/Web 自动同步；
- 不保证浏览器数据被清理后可以恢复；
- 不在本阶段部署 Production，全部功能完成后统一构建发布。

## 5. Web 数据架构

### 5.1 IndexedDB 保存什么

- 项目元数据；
- 文件夹和文本文件；
- `CLAUDE.md`、Wiki 和剧本正文；
- Skill 绑定信息；
- 会话记录和工具操作记录；
- 媒体元数据、缩略图和来源 URL；
- 用户主动导入的小型文件。

### 5.2 IndexedDB 不保存什么

- 数小时视频；
- 大批高清图片原始字节；
- 可从上游 URL 重新获取的大型媒体；
- FFmpeg 临时文件。

媒体在文件树中是一个项目素材条目，条目记录名称、类型、尺寸、来源、上游 URL、本地导入状态和过期状态，不代表平台永久保存了媒体字节。

## 6. 最小工具协议

| 工具 | 作用 | 执行位置 |
|---|---|---|
| `project_list` | 列出 Web 项目 | 浏览器 |
| `project_create` | 创建空项目 | 浏览器 |
| `wiki_list` | 列出目录和文件 | 浏览器 |
| `wiki_search` | 搜索路径、标题和内容 | 浏览器 |
| `wiki_read` | 读取文本文件 | 浏览器 |
| `wiki_mkdir` | 创建目录 | 浏览器 |
| `wiki_write` | 写入文本文件 | 浏览器 |
| `skill_scaffold` | 执行 Skill 建库结果 | 浏览器 |
| `media_read` | 读取被用户选中的素材 | 浏览器/服务器 |
| `media_extract_frames` | 提取视频关键帧 | 服务器 FFmpeg 服务 |
| `export_file` | 另存为单个文件 | 浏览器/Desktop |
| `export_project` | 导出整个项目 | 浏览器/Desktop |

Web 仍然直连现有 LLM API。模型返回工具调用后，由浏览器工具执行器操作 IndexedDB，再把结果返回模型继续运行。

## 7. Skill 建库实现边界

浏览器不能直接运行 Python 的 `scaffold_wiki.py`。第一阶段采用构建期预编译：

```text
Skill 包
  → 构建阶段读取 scaffold 脚本和 Skill 文件约定
  → 生成可审计的 scaffold manifest
  → Web skill_scaffold 执行 manifest
  → 创建目录和初始文件
```

manifest 只翻译 Skill 已有能力，不改变 Skill 的目录结构和内容。若某个 Skill 的脚本包含无法静态表达的复杂计算，再单独接入受限服务器执行器，不为所有 Skill 预先建设通用 Shell。

## 8. 素材保存、引用与导出

### 8.1 创作面板生成素材

- 优先保留模型供应商返回的远程 URL；
- 文件树保存素材条目和缩略图，不复制大媒体到平台存储；
- 用户可以预览、拖入输入框、让模型分析；
- 上游 URL 可能过期，用户需要长期保留时使用“另存为”；
- 平台不承诺供应商 URL 永久有效。

### 8.2 右键另存为

第二列项目文件树统一增加右键“另存为”：

| 环境 | 行为 |
|---|---|
| Desktop | 原生保存对话框，将本地文件或远程素材保存到用户目录 |
| Web | 浏览器下载，将文本或远程素材保存到下载目录 |

这能解决 Web 用户保存生成图片、视频和文本的问题，不需要平台替用户长期存储。

### 8.3 整项目导出/导入

当前阶段用手动导出代替付费云同步：

- 导出项目为 zip；
- 文本、Wiki、Skill 绑定和媒体清单写入 zip；
- 用户主动导入并保存在 IndexedDB 中的小型媒体可选择包含；
- 只有远程 URL 的媒体只导出引用清单；
- 浏览器无权自动读取下载目录，已另存到本地的大媒体需由用户重新选择后才能包含；
- 在另一台电脑导入 zip 后恢复项目树。

## 9. 图片和视频分析

### 9.1 图片

- 远程图片：将安全 URL 作为视觉模型输入；
- 用户本地图片：浏览器读取用户明确选择的文件，并作为多模态输入发送；
- 不将图片长期存入平台云端。

### 9.2 视频

只处理用户明确选中的单个视频，不扫描或上传整个项目。

```text
用户选择视频
  → 临时上传或传入可访问 URL
  → FFprobe 读取时长
  → FFmpeg 定点提取少量关键帧
  → 关键帧交给视觉模型
  → 返回分析结果
  → 立即删除视频和关键帧临时文件
```

不对整段视频做转码，不把数小时素材批量送入服务器。首版限制：

- 单任务并发 1；
- 只抽取 8-24 张关键帧；
- 任务超时 10 分钟；
- 临时目录设置磁盘上限；
- 无论成功失败都清理文件；
- 超大文件要求用户先截取片段或使用可 Range 读取的 URL。

## 10. 服务器现状与 FFmpeg 判断

根据 `docs/wiki/运维/服务器运维.md` 在 2026-07-12 的最后核验：

- 阿里云香港：4 vCPU / 8 GiB / 70 GiB；
- 系统盘约已使用 30 GiB；
- 停用 OCR 容器后，可用内存约 5.5 GiB；
- 正在运行 Nginx、NewAPI、PostgreSQL、Redis、RH/支付/创作模型适配器和 8090 Python 服务。

结论：安装 FFmpeg 本身没有问题。真正风险是多用户同时处理大视频导致 CPU、内存和临时磁盘被占满。

第一阶段推荐：

- 安装 `ffmpeg`/`ffprobe`；
- 只提供固定参数的“关键帧提取”服务；
- 禁止用户提交任意 Shell 命令；
- 并发固定为 1；
- 临时目录独立并自动清理；
- 不改动或重建 NewAPI 容器。

## 11. 服务器核验与安装命令

以下命令由用户登录服务器后执行，AI 不直接操作生产服务器。

### 11.1 先核验

```bash
ssh root@47.82.86.196

ffmpeg -version || true
ffprobe -version || true
free -h
df -h /
uptime
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker stats --no-stream
```

### 11.2 未安装时再安装

```bash
apt-get update
apt-get install -y ffmpeg
ffmpeg -version
ffprobe -version
```

安装 FFmpeg 不需要重启 NewAPI、PostgreSQL、Redis 或 Nginx。当前只安装二进制，不创建公网接口，不部署抽帧服务。

## 12. APP/Web 同步延期

本阶段明确延期：

- D1 项目数据；
- R2 媒体；
- 多设备自动同步；
- APP 本地 SQLite 与 Web 的同步；
- 冲突合并和版本游标。

未来若用户愿意为同步付费，优先只同步文本、Wiki、会话和媒体清单。大媒体仍由用户自有存储或单独付费存储承担，不能默认进入平台公共存储。

## 13. APP 自动升级延期但保留根因

APP 自动升级不阻塞本轮 Web 建设，最后单独处理。当前已知问题：

- macOS `latest.json` 指向普通 DMG，而不是 updater 专用归档；
- Windows 发布的是 portable zip，没有 NSIS/MSI updater 产物；
- 下载页安装包和 OTA 更新包被混为一套产物。

后续必须分离：

| 用途 | macOS | Windows |
|---|---|---|
| 手动下载 | DMG | portable zip |
| OTA 更新 | Tauri updater 归档 + 签名 | NSIS/MSI updater 归档 + 签名 |

## 14. 实施顺序

1. Web 项目模型和第二列文件树；
2. IndexedDB 文件 CRUD；
3. Skill scaffold manifest 与 Skill 建库；
4. `CLAUDE.md`/Wiki 渐进式读取和写入工具；
5. 创作面板素材进入项目树；
6. Desktop/Web 统一右键另存为；
7. 整项目 zip 导出/导入；
8. 服务器核验并安装 FFmpeg；
9. 单视频关键帧服务；
10. 全链路验证后统一构建和 Production 部署；
11. APP OTA 修复；
12. 最后再评估 D1/R2 和 APP/Web 同步。

## 15. 验收标准

- Web 用户能创建项目并在第二列切换项目；
- 用户选择 `JC-短剧-世界模型` 后，由该 Skill 创建自身 Wiki 结构；
- LLM 能搜索、读取和写入 Wiki；
- 写“第一集”后，正文进入 Skill 约定的 Wiki 路径；
- 刷新页面后项目和 Wiki 不丢；
- 图片、视频和文本能出现在项目素材树；
- Web/APP 均能右键另存为；
- 项目可以导出 zip 并重新导入；
- 用户选中的图片可以交给视觉模型；
- 用户选中的视频可以抽取关键帧后分析；
- 平台不长期保存用户大媒体；
- 本阶段不产生 D1/R2 项目存储费用；
- 全部完成后才执行 Web Production 部署。
