---
name: jc-gitHubzhidao
description: 专门面向 GitHub 小白用户的保姆级上手指南。涵盖 GitHub 注册、双重认证（2FA）、高效搜索、建仓库、管理 Issue、本地 Git 操作、项目部署、Fork 与 Star 机制，以及协作核心 Pull Request（PR）与 Push 流程。当用户询问"GitHub 怎么用"、"怎么在 GitHub 上找代码"、"怎么上传代码到 GitHub"、"如何参与开源项目"、"什么是 Fork 和 PR"或需要 GitHub 基础操作指导时，使用此 Skill。也覆盖 AI-first 微信小程序开发——当用户说"想做一个小程序"、"微信小程序开发"、"AI 开发小程序"、"小程序零基础"、"写个微信小程序"、"用 AI 做小程序"时使用。
---

# 面向小白用户的 GitHub 速查手册

## 快速索引

用户的问题如果匹配下面的关键词，直接去对应章节找指令模板：

| 用户说什么 | 去这里看 |
|-----------|---------|
| 创建一个新项目 / 上传代码 / 推到 GitHub | [场景 1：创建项目并上传](#场景1) |
| 下载别人的代码 / clone / 克隆 | [场景 2：下载代码](#场景2) |
| 改了代码怎么更新 / push / 提交 | [场景 3：修改并更新](#场景3) |
| 参与开源 / fork / pr / pull request | [场景 4：参与别人的项目](#场景4) |
| 冲突了 / merge conflict / 怎么合并 | [场景 5：解决冲突](#场景5) |
| 撤销 / 回退 / 改错了想回去 / revert / reset | [场景 6：撤销操作](#场景6) |
| SSH key / 免密码 / Permission denied | [场景 7：配置 SSH Key](#场景7) |
| .gitignore / 不想提交某些文件 / node_modules | [场景 8：忽略文件](#场景8) |
| 看历史 / 谁改了什么 / git log | [场景 9：查看历史](#场景9) |
| Issue / 提 bug / 提需求 | [场景 10：GitHub Issues](#场景10) |
| 部署网站 / GitHub Pages / 静态网站 | [场景 11：免费部署网站](#场景11) |
| 怎么找好项目 / 搜索 / discover | [场景 12：搜索开源项目](#场景12) |
| 多台电脑 / 同步 / 换电脑 | [场景 13：多电脑同步](#场景13) |
| 分支 / branch / 开发新功能 | [场景 14：分支管理](#场景14) |
| Actions / 自动测试 / CI/CD | [场景 15：自动化](#场景15) |
| Release / 发布版本 / 发版 | [场景 16：发布版本](#场景16) |
| 许可证 / License / 开源协议 | [场景 17：给项目加许可证](#场景17) |
| 存储不够 / LFS / 大文件 | [场景 18：大文件管理](#场景18) |
| 仓库太大 / 历史清理 / 敏感信息 | [场景 19：仓库瘦身](#场景19) |
| 怎么让 AI 帮我操作 GitHub | [使用 AI 工具操作 GitHub](#ai-tools) |
| 想做一个小程序 / AI 开发小程序 / 微信小程序 / 小程序零基础 / 用 AI 做小程序 | [AI-first 微信小程序开发指南](#miniprogram-guide) |

## Git / GitHub 大白话术语对照

读完这张表，你就知道大家在说什么了。

| 术语 | 大白话解释 |
|------|-----------|
| **Git** | 一个"版本记录器"，装在你电脑上，帮你记住代码的每一次改动。比如你改了 5 次，Git 就记了 5 个版本，随时可以回到任何一次。 |
| **GitHub** | 一个"代码网盘网站"，把 Git 记录的历史上传到云端。这样你可以分享给别人、和别人一起改。Git 是工具，GitHub 是网站，不是一个东西。 |
| **仓库（Repository / Repo）** | 一个项目文件夹 + Git 的版本历史记录。一个项目就是一个仓库。 |
| **克隆（Clone）** | 把 GitHub 上的整个仓库下载到你电脑上。不只是下载文件，还包括所有的历史版本。 |
| **提交（Commit）** | 你改了一些代码，觉得可以"存档"了，就做一个 Commit。每个 Commit 是一张"快照"，记录了此刻所有文件的样子。 |
| **推送（Push）** | 把你电脑上做的 Commit，上传到 GitHub 云端。这样别人就能看到你的改动了。 |
| **拉取（Pull）** | 把 GitHub 上别人做的 Commit，下载到你自己电脑上。 |
| **分支（Branch）** | 像游戏的"存档分支"——主线是一条，你要试新玩法就新开一分支，不会影响主线。改好了再"合并"回去。 |
| **合并（Merge）** | 把两条分支的代码合到一起。 |
| **冲突（Conflict）** | 两个人同时改了同一行代码，Git 不知道用谁的。需要你手动决定。 |
| **Fork** | 把别人的仓库"复印"一份到你自己名下。这样你可以随意改，不影响别人。 |
| **Pull Request（PR）** | "我改好了，请拉取我的代码"——请求仓库主人把你的改动合并到他的仓库。开源贡献的核心流程。 |
| **Issue** | 类似于"工单"或"留言板"——报 bug、提需求、讨论问题的地方。 |
| **Star** | 相当于"点赞收藏"。Star 越多，说明越多人觉得这个项目好。 |
| **README** | 每个仓库主页展示的介绍文件。一个项目有没有 README，决定了别人 5 秒内能不能看懂它是干嘛的。 |
| **.gitignore** | 一个配置文件，告诉 Git "这些文件别管它们，不用记录版本"。（比如 node_modules、.env 等） |
| **SSH Key** | 相当于你电脑和 GitHub 之间的"免密通行证"。配好了以后，push/pull 都不用输密码。 |
| **main / master** | 默认的主分支名。现在的项目一般叫 main，老项目可能叫 master。 |
| **Actions** | GitHub 自带的"自动化机器人"。比如你每次 Push 代码，自动帮你跑测试、自动部署网站。 |
| **Release** | 给某个版本打个标签，打包发布。比如"v1.0.0 正式发布"。 |

## 核心场景速查 {#scenarios}

以下是最常用的 5 个场景的指令模板。更多场景见 `references/github_scenarios.md`。

### 场景 1：创建新仓库并上传代码 {#场景1}

**大白话**：你电脑上写了一个项目，想把它放到 GitHub 上。

```bash
# 第 1 步：进入你的项目文件夹
cd /你的项目路径/

# 第 2 步：初始化 Git（告诉 Git"开始记录这个文件夹"）
git init

# 第 3 步：把所有文件加入暂存区
git add .

# 第 4 步：做第一个提交
git commit -m "第一次提交：初始化项目"

# 第 5 步：去 GitHub 网页上创建一个新仓库（不要勾选 README/.gitignore/LICENSE）
# 创建后 GitHub 会给你一个地址，类似：https://github.com/你的用户名/仓库名.git

# 第 6 步：把本地仓库连到 GitHub
git remote add origin https://github.com/你的用户名/仓库名.git

# 第 7 步：推送到 GitHub（第一次推送用 -u）
git push -u origin main
```

如果主分支叫 `master`（老仓库），把上面的 `main` 换成 `master`。

### 场景 2：把别人的代码下载到自己电脑上 {#场景2}

**大白话**：你看到一个好项目，想下载下来自己跑一跑。

```bash
# 克隆到当前目录
git clone https://github.com/用户名/仓库名.git

# 克隆到指定文件夹
git clone https://github.com/用户名/仓库名.git 我的文件夹名

# 例：下载一个 AI 工具项目
git clone https://github.com/AIDC-AI/Pixelle-Video.git
```

下载完后，`cd Pixelle-Video` 进入项目目录就能用了。

### 场景 3：修改代码后更新到 GitHub {#场景3}

**大白话**：你在项目里改了点代码，想让 GitHub 上的代码也同步更新。

```bash
# 第 1 步：看看你改了哪些文件（可跳过）
git status

# 第 2 步：把所有改动加入暂存区
git add .

# 如果你只想提交特定文件：
git add 文件名1 文件名2

# 第 3 步：提交（写清楚你做了什么）
git commit -m "修复了登录页面的样式问题"

# 第 4 步：推送到 GitHub
git push
```

### 场景 3.5：先拉取最新代码（别人也改了的情况下）

```bash
# 先把别人的更新拉下来
git pull

# 如果有冲突，解决完再做自己的提交
git add .
git commit -m "合并了远程更新"
git push
```

### 场景 4：给别人的开源项目提交代码 {#场景4}

**大白话**：你发现某开源项目有个 bug，想修好贡献回去。

流程一共 6 步（都在 GitHub 网页上操作 + 命令行配合）：

```bash
# 第 1 步：在 GitHub 网页上，打开你想贡献的项目，点击右上角 Fork 按钮
# → 这会在你自己的 GitHub 账号下创建一个副本

# 第 2 步：把你 Fork 的版本下载到本地
git clone https://github.com/你的用户名/项目名.git
cd 项目名

# 第 3 步：创建新分支（一定要在分支上改，不要直接在 main 上改！）
git checkout -b fix-login-bug

# 第 4 步：修改代码 → 提交 → 推送
# ... 修改代码 ...
git add .
git commit -m "修复了登录时密码框无法输入的问题"
git push origin fix-login-bug

# 第 5 步：打开 GitHub 上你 Fork 的仓库页面
# 点击绿色的 "Compare & pull request" 按钮
# 填写标题（一句话说清楚你改了啥）和描述（补充细节）
# 点击 "Create pull request"

# 第 6 步：等待项目维护者审核，他们可能会留言让你修改
# 如果有意见，直接在本地继续改 → commit → push
# PR 会自动更新，不需要重新创建
```

### 场景 5：解决代码冲突 {#场景5}

**大白话**：你和小明同时改了同一行代码，Git 不知道该用谁的。

当 `git pull` 或 `git merge` 报冲突时：

```bash
# 1. 先看看哪些文件冲突了
git status

# 2. 打开冲突文件，你会看到类似这样的标记：
# <<<<<<< HEAD
# 你的代码版本
# =======
# 别人的代码版本
# >>>>>>> 分支名

# 3. 手动编辑文件：删掉 <<< === >>> 标记，保留你想要的最终版本

# 4. 保存后，标记冲突已解决
git add 冲突文件名

# 5. 继续提交
git commit -m "解决了XXX冲突"
git push
```

**如果冲突太复杂想放弃合并**：
```bash
git merge --abort    # 一键回到冲突前的状态
```

## 使用 AI 工具操作 GitHub {#ai-tools}

如果你在用 **Claude Code / OpenCode / Codex / Cursor** 等 AI 编码工具，它们**本身就可以帮你执行 Git 命令**，你不需要自己敲。

### 模式 1：让 AI 直接帮你操作

直接告诉 AI，用大白话说你要干嘛：

> "帮我把当前项目的代码提交到 GitHub，commit 信息写'修复首页加载慢的问题'"

> "帮我把这个项目从 GitHub 上下载到本地"

> "帮我创建一个新分支叫 feat-dark-mode，然后切换过去"

> "帮我在 GitHub 上搜一下有没有好用的 Python 爬虫项目，stars 要超过 1000"

AI 会自动帮你执行对应的 Git 命令。

### 模式 2：命令我也能看懂，我自己敲

如果你更想自己敲，告诉 AI：

> "我要把代码推送到 GitHub，给我命令，我一条一条执行"

### 模式 3：代码审查

> "对比一下 main 分支和我当前分支的区别，看看我改了哪些"

> "帮我写一个 Pull Request 的描述，总结我这次做了什么改动"

### 模式 4：看不懂就让它解释

> "git status 输出是：...（贴上去）。帮我用大白话解释这是什么意思"

> "为什么 git push 报这个错：...（贴错误信息）"

## AI-first 微信小程序开发指南 {#miniprogram-guide}

**核心概念**：你不会编程、不懂架构、不会用 GitHub，这些都不重要。你只需要像产品经理一样——描述你想要的、在微信开发者工具里看效果、不满意就告诉 AI 改。AI 是给你干活的工程师。

下面六步走完，你就能做出一个能跑的小程序。

### 总体路线图

| 阶段 | 干什么 | 做完的标志 |
|------|--------|-----------|
| 0 | 需求梳理 | AI 理解你想做什么，输出功能清单 |
| 1 | 环境准备 | 注册好微信小程序账号 + 装好开发者工具 |
| 2 | 选组件库 | 确定用哪套组件库，AI 帮你装好 |
| 3 | 搭建骨架 | 所有页面创建完毕，TabBar 能点击 |
| 4 | 逐页开发 | 每个页面内容写好了，能正常预览 |
| 5 | 打磨细节 | 交互顺滑、样式满意 |
| 6 | 上线发布 | 提交审核，用户能用 |

### 阶段 0：需求梳理 — 你究竟想做什么？

先不要急着写代码。用大白话告诉 AI 你想做什么，让它帮你理清思路。

> "我想做一个微信小程序，功能是 [用大白话描述]。请帮我梳理成一张功能清单，列出需要哪些页面，每页有什么内容和交互。先不要写代码，我们先确认方向。"

检查 AI 的输出：它理解对了吗？有没有漏掉你想做的功能？确认无误后再进入下一步。

### 阶段 1：环境准备 — 把工具装好

1. 去 [微信公众平台](https://mp.weixin.qq.com/) 注册小程序账号（个人就能注册，注意：个人主体不能做电商/外卖/社交等类目）
2. 登录后获取 **AppID**（开发 → 开发管理 → 开发设置）
3. 下载 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
4. 用 AppID 在开发者工具里新建项目

> "我已注册微信小程序并获取了 AppID。请告诉我如何在微信开发者工具里创建一个新项目，选择什么模板、填什么参数。我选择不使用云开发。"

如果需要用到 GitHub（比如下载 vant-weapp 等组件库），参考本指南的场景 2 [下载代码](#场景2)。

### 阶段 2：选型 — 选什么组件库？

**大白话**：组件库就是别人写好的现成按钮、列表、弹窗、导航栏。你不用从零画一个按钮，直接用就行。

根据你的需求，从下面五选一：

| 组件库 | 适合场景 | 一句话定位 | GitHub 地址 |
|--------|----------|-----------|------------|
| **vant-weapp** | 电商/商城/生活服务 | 组件最丰富（70+），有赞出品，适合大部分应用 | [youzan/vant-weapp](https://github.com/youzan/vant-weapp) |
| **WeUI** | 极简工具/官方风格 | 微信官方出品，最轻量，和微信原生风格一致 | [Tencent/weui-wxss](https://github.com/Tencent/weui-wxss) |
| **TDesign Miniprogram** | 企业应用/专业工具 | 腾讯设计体系，大气专业，适合企业级应用 | [Tencent/tdesign-miniprogram](https://github.com/Tencent/tdesign-miniprogram) |
| **iView Weapp** | 后台管理/数据面板 | 企业级，表格和图表组件强 | [TalkingData/iview-weapp](https://github.com/TalkingData/iview-weapp) |
| **纯原生（不用组件库）** | 1-2 页极简应用 | 零依赖，完全自定义，适合极简需求 | — |

**推荐决策**：把你的需求告诉 AI，让它帮你选——
> "我想做一个小程序，类型是 [电商/工具/展示/管理]，大概有 [X] 个页面，风格偏好是 [简洁/专业/活泼]。根据这些条件，帮我从 vant-weapp / WeUI / TDesign / iView Weapp / 纯原生 中推荐最合适的，并说明理由。"

选定后，让 AI 帮你安装（以 vant-weapp 为例）：
> "我要用 vant-weapp 组件库开发微信小程序。请帮我用 npm 方式安装 vant-weapp 并完成配置（包括修改 app.json、project.config.json 等）。先只做配置，不写页面代码。"

**关键提示**：安装完 npm 包后，记得在微信开发者工具里点击"工具 → 构建 npm"，否则组件不生效。

### 阶段 3：搭建项目骨架

现在让 AI 把你所有页面的"空壳"搭好。

> "基于阶段 0 整理的功能清单，帮我搭建小程序的项目骨架：1) 配置 app.json（包括所有页面路由和底部 TabBar）2) 为每个页面创建 .wxml / .wxss / .js / .json 四个文件 3) 写好全局样式 app.wxss。用 [选定的组件库] 的导航组件。先做空壳，不填内容。"

做完后在开发者工具里点编译，确认：TabBar 能切换、每个页面能正常显示（虽然是空的）。

### 阶段 4：逐页开发 — 核心循环

这是最关键的阶段。**一次只做一页**，每页的流程如下：

1. 告诉 AI 这一页要展示什么、有什么交互
2. AI 生成代码
3. 你在开发者工具里预览
4. 不满意就描述问题让 AI 改

每页的 prompt 模板：
> "现在开发 [页面名] 页面。需要展示：[具体要展示的内容列表]。用户点击 [某处] 后 [跳转/弹窗/切换]。请用 [组件库] 的 [具体组件名，如 van-button、van-cell、van-tabbar] 来实现。同时生成 wxml 结构、wxss 样式、js 逻辑和 json 配置。不要生成其他页面的代码。"

逐一完成所有页面。**每完成一页就预览一次**，确认没问题再做下一页。

### 阶段 5：打磨细节

全页做完后，开始打磨：

| 要检查的 | 怎么告诉 AI |
|----------|------------|
| 样式不满意 | "首页的按钮在手机上显示太小了，请调大一些，圆角也加大一点。" |
| 页面跳转有问题 | "点击商品卡片后没有跳转到详情页，帮我检查一下。" |
| 数据没显示 | "列表页是空的，没有显示商品数据。请帮我加上模拟数据。" |
| 交互不流畅 | "页面切换时感觉卡顿，帮我优化一下性能。" |
| 颜色/字体 | "整体颜色太素了，帮我改成暖色调，主色用 #FF6B35。" |

**技巧**：把开发者工具的截图贴给 AI（如果能发图片），或者描述"我看到的"vs"我期望的"，AI 就能精准修改。

### 阶段 6：上线发布

1. 在开发者工具右上角点击"上传"，填好版本号（如 1.0.0）和备注
2. 去 [微信公众平台](https://mp.weixin.qq.com/) → 管理 → 版本管理
3. 找到刚上传的版本，点击"提交审核"
4. 等待审核（通常 1-7 天）

提交前让 AI 做最后检查：
> "我的小程序要提交审核了，帮我检查：1) 所有页面路径是否正确 2) 有没有硬编码的测试数据 3) 是否符合微信小程序的基本规范。如果有问题请列出。"

审核通过后，点击"发布"即可。如果审核被驳回：
> "我的小程序审核被驳回了，原因是 [贴驳回原因]。请帮我修改对应的代码。"

---

## GitHub 常见错误速查

| 错误信息 | 大白话原因 | 怎么修 |
|---------|-----------|--------|
| `fatal: not a git repository` | 你不在一个 Git 项目文件夹里 | `cd` 到正确的项目目录，或者先 `git init` |
| `Permission denied (publickey)` | SSH Key 没配 | 去看 [场景 7](#场景7) |
| `error: failed to push some refs` | 远程有你本地没有的更新，或者你本地落后了 | 先 `git pull` 再 `git push` |
| `Please tell me who you are` | 没设置用户名和邮箱 | `git config --global user.name "你的名字"` 和 `git config --global user.email "你的邮箱"` |
| `fatal: refusing to merge unrelated histories` | 本地和远程是两个不相关的仓库 | `git pull origin main --allow-unrelated-histories` |
| `Your branch is ahead of 'origin/main' by X commits` | 你本地有一些提交还没推送到 GitHub | `git push` |
| `.DS_Store` 文件老是出现 | macOS 系统文件，应该在 .gitignore 里忽略 | 在 .gitignore 里加一行 `.DS_Store` |
| `Updates were rejected because the remote contains work` | 远程有别人推的新代码 | `git pull --rebase` 再 `git push` |
| `fatal: detected dubious ownership` | 文件夹的所有者和当前用户不一致 | `git config --global --add safe.directory /路径` |

## 更多场景

完整 19 个场景的指令模板、大白话解释和注意事项，见：[references/github_scenarios.md](references/github_scenarios.md)

环境检查脚本：[scripts/git_check.sh](scripts/git_check.sh) — 运行它检查你的 Git 有没有配置好。

微信小程序完整开发指南（含组件库对比、逐页 prompt 模板、常见坑汇总）：[references/wechat_miniprogram_guide.md](references/wechat_miniprogram_guide.md)
