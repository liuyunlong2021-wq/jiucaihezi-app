# GitHub 场景指令模板大全

> 每个场景都包含：大白话解释 → 操作步骤 → 指令模板。直接复制粘贴就能用。

## 目录

- [场景 1：创建项目并上传](#scenario-1)
- [场景 2：下载代码](#scenario-2)
- [场景 3：修改并更新](#scenario-3)
- [场景 4：参与别人的项目](#scenario-4)
- [场景 5：解决冲突](#scenario-5)
- [场景 6：撤销操作](#scenario-6)
- [场景 7：配置 SSH Key](#scenario-7)
- [场景 8：忽略文件](#scenario-8)
- [场景 9：查看历史](#scenario-9)
- [场景 10：GitHub Issues](#scenario-10)
- [场景 11：免费部署网站](#scenario-11)
- [场景 12：搜索开源项目](#scenario-12)
- [场景 13：多电脑同步](#scenario-13)
- [场景 14：分支管理](#scenario-14)
- [场景 15：自动化（Actions）](#scenario-15)
- [场景 16：发布版本（Release）](#scenario-16)
- [场景 17：给项目加许可证](#scenario-17)
- [场景 18：大文件管理（LFS）](#scenario-18)
- [场景 19：仓库瘦身](#scenario-19)

---

## 场景 1：创建项目并上传 {#scenario-1}

**大白话**：你电脑上写了一个项目，想把它放到 GitHub 上。

### 方式一：本地已有代码，推送到新仓库

```bash
cd /你的项目路径/
git init
git add .
git commit -m "第一次提交：初始化项目"

# 去 GitHub 网页创建新仓库（不要勾选任何初始化选项）
# 然后把下面的地址换成你的：
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

如果你的默认分支叫 `master` 而不是 `main`：

```bash
git push -u origin master
```

### 方式二：先在 GitHub 创建仓库，再下载到本地

在 GitHub 网页上创建仓库（可以勾选 README），然后：

```bash
git clone https://github.com/你的用户名/仓库名.git
cd 仓库名
# 现在可以在这个目录里写代码了
```

---

## 场景 2：下载代码 {#scenario-2}

**大白话**：把 GitHub 上的项目整个下载到你电脑上。

```bash
# 基本命令
git clone https://github.com/用户名/仓库名.git

# 下载到指定目录
git clone https://github.com/用户名/仓库名.git 我的目录名

# 只下载最新的版本（不包含历史，适合大项目快速下载）
git clone --depth=1 https://github.com/用户名/仓库名.git
```

**不需要 Git 的情况**：如果你只是想下载代码跑一下，不打算提交代码回去，可以直接在 GitHub 网页上点绿色的 **Code** 按钮 → **Download ZIP**。这样不用装 Git 也能拿到代码。

---

## 场景 3：修改并更新 {#scenario-3}

**大白话**：改了代码 → 保存版本 → 推送到 GitHub。

### 标准流程

```bash
# 1. 看看改了哪些文件（可选）
git status

# 2. 把所有改动加入暂存区
git add .

# 3. 提交（保存版本）
git commit -m "这里写你做了什么改动，比如：修复首页按钮点击无效"

# 4. 推送到 GitHub
git push
```

### 如果别人同时也改了代码（先拉再推）

```bash
git pull          # 先拉取别人的更新
# 如果有冲突，解决冲突（见场景 5）
git push          # 再推送自己的
```

### 只提交部分文件

```bash
git add 文件名1.js 文件名2.css
git commit -m "只修改了这两个文件"
git push
```

### Commit 信息怎么写（推荐格式）

```
好的 commit 信息：
✅ "添加用户登录功能"
✅ "修复移动端导航栏溢出问题"
✅ "更新 README，补充安装说明"

不好的 commit 信息：
❌ "改了点东西"
❌ "update"
❌ "111"
```

---

## 场景 4：参与别人的项目（Fork + PR） {#scenario-4}

**大白话**：发现一个开源项目有 bug / 想加功能，怎么把改好的代码贡献回去？

### 步骤概览

1. GitHub 网页 → **Fork** 别人的仓库到你名下
2. Clone 你 Fork 的版本到本地
3. 创建新分支 → 改代码 → Commit → Push
4. 在 GitHub 上创建 **Pull Request**

### 完整指令

```bash
# 步骤 1：Fork
# 在浏览器打开原项目页面 → 点右上角 Fork 按钮 → 完成 Fork

# 步骤 2：下载你 Fork 的版本
git clone https://github.com/你的用户名/项目名.git
cd 项目名

# 步骤 3：添加上游仓库（原项目）的地址，方便同步原项目的更新
git remote add upstream https://github.com/原作者/项目名.git

# 步骤 4：创建新分支（命名最好能看出你要做什么）
git checkout -b fix-xxx-bug

# 步骤 5：改代码 → 提交 → 推送
git add .
git commit -m "修复了 XXX 的问题"
git push origin fix-xxx-bug

# 步骤 6：回 GitHub 网页
# 你的 Fork 页面会出现绿色的 "Compare & pull request" 按钮
# 点击 → 写标题和说明 → Create pull request
```

### 原项目更新了，怎么同步到你 Fork 的版本？

```bash
git checkout main                          # 回到主分支
git pull upstream main                     # 拉取原项目的最新代码
git push origin main                       # 推到你自己 Fork 的仓库
```

---

## 场景 5：解决冲突 {#scenario-5}

**大白话**：两个人改了同一行，Git 不知道该听谁的。

### 冲突长什么样

执行 `git pull` 或 `git merge` 后，如果报冲突，打开冲突文件会看到：

```
<<<<<<< HEAD
你的版本
=======
别人的版本
>>>>>>> 分支名
```

### 解决步骤

```bash
# 1. 看看哪些文件冲突了
git status

# 2. 打开冲突文件，手动编辑
#    删掉 <<<<<<< HEAD、=======、>>>>>>> 分支名 这些标记
#    保留你想要的最终内容

# 3. 标记冲突已解决
git add 冲突文件.go

# 4. 继续提交
git commit -m "解决了 XXX 和 XXX 的合并冲突"

# 5. 推送
git push
```

### 如果冲突太乱想放弃合并

```bash
git merge --abort        # 回到合并前的状态
git rebase --abort       # 如果用的是 rebase，用这个
```

### 预防冲突

- **改代码前先** `git pull`，保证你本地是最新的
- **小步提交**，不要攒一大堆改动再提交
- **分工明确**，一个功能一个人改，避免同时改同一个文件

---

## 场景 6：撤销操作 {#scenario-6}

**大白话**：改错了 / 提交错了 / push 错了，怎么回退？

### 改了文件但还没 add（丢弃工作区改动）

```bash
# 丢弃某个文件的改动，回到上次 commit 的状态
git checkout -- 文件名

# 丢弃所有文件的改动
git checkout -- .
```

### 已经 add 了但还没 commit（取消暂存）

```bash
# 把某个文件从暂存区拿出来（保留改动）
git restore --staged 文件名

# 把所有文件拿出来
git restore --staged .
```

### 已经 commit 了但还没 push（修改最后一次提交）

```bash
# 追加改动到最后一次提交（不新增 commit）
git add 漏掉的文件.go
git commit --amend -m "更新了提交信息"

# 如果只是改提交信息，不改文件：
git commit --amend -m "新的提交信息"
```

### 已经 push 了（回退已推送的提交）

```bash
# 查看最近几次提交，找到你要回到哪个版本
git log --oneline -10

# 回退到某个提交（改动保留在工作区）
git reset --soft 提交哈希值

# 回退到某个提交（改动也丢弃，⚠️ 危险操作）
git reset --hard 提交哈希值

# 强制推送到 GitHub（⚠️ 如果别人也在用这个分支，别用这招）
git push --force
```

### 撤销某个具体提交（推荐方式，安全）

```bash
# 创建一个"反向提交"来撤销某次提交的改动
git revert 提交哈希值
git push
```

### 已经提交到错误的分支

```bash
# 把最后一次提交移到另一个分支
git checkout 正确的分支名
git cherry-pick 提交哈希值
git checkout 错误的分支名
git reset --hard HEAD~1
```

---

## 场景 7：配置 SSH Key {#scenario-7}

**大白话**：配好 SSH Key 后，push/pull 不用输密码。

### macOS / Linux

```bash
# 1. 生成 SSH Key（一路回车就行）
ssh-keygen -t ed25519 -C "你的GitHub注册邮箱@example.com"

# 2. 复制公钥内容
cat ~/.ssh/id_ed25519.pub

# 3. 打开 GitHub 网页 → 右上角头像 → Settings
#    → 左侧 SSH and GPG keys → New SSH key
#    → 把复制的内容粘贴进去 → Add SSH key

# 4. 测试连接
ssh -T git@github.com
# 看到 "Hi 你的用户名! You've successfully authenticated" 就成功了
```

### Windows

```bash
# 在 Git Bash 中执行同上步骤
# 公钥路径通常是 C:\Users\你的用户名\.ssh\id_ed25519.pub
```

### 配好 SSH Key 后

以后 clone 仓库用 SSH 地址（而不是 HTTPS）：

```bash
# ❌ HTTPS 方式（需要输密码）
git clone https://github.com/用户名/仓库.git

# ✅ SSH 方式（免密码）
git clone git@github.com:用户名/仓库.git
```

如果之前用的是 HTTPS 地址，想切换成 SSH：

```bash
git remote set-url origin git@github.com:用户名/仓库.git
```

---

## 场景 8：忽略文件（.gitignore） {#scenario-8}

**大白话**：有些文件不想提交到 GitHub（比如 node_modules 文件夹有几十万个文件、.env 里有密码）。

### 创建 .gitignore

在项目根目录新建文件 `.gitignore`，写入要忽略的内容：

```gitignore
# 依赖目录（不需要提交，别人下载后用 npm install 就能装回来）
node_modules/

# 编译产物
dist/
build/

# 环境变量（含密码/密钥，绝对不能提交！）
.env
.env.local

# 操作系统文件
.DS_Store
Thumbs.db

# IDE 配置
.vscode/
.idea/

# Python
__pycache__/
*.pyc
venv/

# 日志
*.log

# 数据库文件
*.sqlite
*.db
```

### 如果已经提交了想忽略的文件

```bash
# 1. 先从 Git 跟踪中移除（但不删除本地文件）
git rm --cached 文件名

# 2. 把这个文件加到 .gitignore 里
echo "文件名" >> .gitignore

# 3. 提交
git add .gitignore
git commit -m "忽略XXX文件"
git push
```

### 常用模板

GitHub 官方提供各语言的 .gitignore 模板：
https://github.com/github/gitignore

快速生成：

```bash
# 在项目目录下，告诉 AI 工具：
# "帮我生成一个 Node.js 项目的 .gitignore"

# 或者直接用 curl 下载 GitHub 的模板：
curl https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore > .gitignore
```

---

## 场景 9：查看历史 {#scenario-9}

**大白话**：想知道项目里谁在什么时候改了什么。

### 查看提交历史

```bash
# 查看全部提交历史
git log

# 简洁版（一行一个提交）
git log --oneline

# 最近 10 条
git log --oneline -10

# 看某个人的提交
git log --author="张三"

# 看某个文件的改动历史
git log -- 文件路径

# 图形化显示分支历史
git log --oneline --graph --all
```

### 查看具体改了什么

```bash
# 看当前未提交的改动
git diff

# 看某次提交改了哪些地方
git diff 提交哈希值

# 看某个文件在两次提交之间的区别
git diff 提交1..提交2 -- 文件名

# 看某次提交的详细内容
git show 提交哈希值
```

### 查看是谁改的某一行（找负责人）

```bash
# 查看文件每一行是谁在什么时间改的
git blame 文件名

# 只看某一行的改动历史
git log -L 10,20:文件名
```

---

## 场景 10：GitHub Issues {#scenario-10}

**大白话**：Issues 是 GitHub 上的"工单系统"，用来提 Bug、提需求、讨论问题。

### 创建 Issue

1. 打开项目主页 → 点 **Issues** → 点绿色的 **New issue**
2. 写标题（一句话说清楚问题）
3. 写详细描述

**好的 Issue 标题**：

- ✅ "登录页面的密码输入框在 Safari 浏览器上无法点击"
- ✅ "建议增加暗色模式切换功能"
- ✅ "修复统计页面日期筛选后数据不刷新的问题"

**不好的 Issue 标题**：

- ❌ "有 bug"
- ❌ "改一下"
- ❌ "求助"

### Issue 模板（直接复制用）

```markdown
## 问题描述

（用 1-2 句话描述你遇到的问题）

## 复现步骤

1. 打开 XXX 页面
2. 点击 XXX 按钮
3. 发现 XXX 不正常

## 期望行为

（你希望它应该怎样）

## 实际行为

（它实际怎样了）

## 截图 / 录屏

（如果有的话贴这里）

## 环境信息

- 操作系统：macOS 15 / Windows 11
- 浏览器：Chrome 132
- 项目版本：v1.2.0
```

### 搜索已有 Issue

在 Issues 页面的搜索框里搜关键字，确认你的问题是不是已经有人提过了。

### 标签（Labels）

仓库管理员可以给 Issue 打标签，常见的有：

- `bug` — 这是 bug
- `enhancement` — 新功能建议
- `good first issue` — 适合新手参与的任务
- `help wanted` — 需要帮助

---

## 场景 11：免费部署静态网站 {#scenario-11}

**大白话**：把 HTML/CSS/JS 项目免费部署到公网，别人可以直接通过网址访问。

### 方式一：GitHub Pages（最简单）

适合：纯静态网站、文档站、个人博客。

1. 把网站文件提交到 GitHub 仓库
2. 仓库页面 → Settings → Pages
3. Source 选 **Deploy from a branch** → 选 `main` 分支 → Save
4. 几分钟后，访问 `https://你的用户名.github.io/仓库名/` 就能看到

### 方式二：Vercel（推荐，功能更强）

适合：React/Vue/Next.js 等前端框架项目。

1. 打开 [vercel.com](https://vercel.com) → 用 GitHub 账号登录
2. 点 **New Project** → 选择你的 GitHub 仓库
3. 不用改任何配置 → 直接点 **Deploy**
4. 部署完成后会给你一个 `.vercel.app` 结尾的网址
5. 以后每次 `git push`，Vercel 自动重新部署

### 方式三：Cloudflare Pages

适合：和 Vercel 类似的体验。

1. 打开 [pages.cloudflare.com](https://pages.cloudflare.com) → 用 GitHub 登录
2. 连接你的 GitHub 仓库
3. 选择框架预设或留空
4. 点 **Save and Deploy**

### 方式四：Netlify

适合：拖拽就能部署，零配置。

1. 打开 [netlify.com](https://netlify.com) → 用 GitHub 登录
2. 点 **Add new site** → **Import an existing project** → 选 GitHub 仓库
3. 点 **Deploy site**
4. 也可以通过拖拽 dist 文件夹到网页上直接部署

---

## 场景 12：搜索开源项目 {#scenario-12}

**大白话**：GitHub 上有超过 6 亿个仓库，怎么找到自己需要的？用搜索过滤。

### 基本搜索

直接在 GitHub 顶部搜索框输入关键词。

### 高级过滤语法（组合使用）

| 语法                  | 作用                | 示例                      |
| --------------------- | ------------------- | ------------------------- |
| `stars:>1000`         | 星标超过 1000 个    | 找热门项目                |
| `language:python`     | 限定编程语言        | 只搜 Python 项目          |
| `topic:ai`            | 按话题搜索          | 搜 AI 相关                |
| `pushed:>2026-01-01`  | 最近有更新          | 筛掉死项目                |
| `created:>2026-01-01` | 2026 年后新创建     | 找新项目                  |
| `license:mit`         | 按开源协议          | 找 MIT 协议的项目         |
| `is:public`           | 只搜公开仓库        | —                         |
| `fork:true`           | 包括 Fork 的仓库    | —                         |
| `path:README.md`      | 搜索文件内容        | 在 README 里搜            |
| `user:github`         | 特定用户/组织的仓库 | 看某人的项目              |
| `NOT xxx`             | 排除关键词          | `NOT archived` 排除已归档 |

### 实用搜索组合

```text
# 找热门的 React 开源 UI 组件库
react component library stars:>500 language:typescript

# 找最近活跃的 AI 爬虫工具
crawler ai topic:web-scraping pushed:>2026-01-01

# 找适合新手参与的项目
stars:>100 label:good-first-issue language:python

# 找 ChatGPT 相关的开源项目（排除 archived/已废弃的）
chatgpt NOT archived stars:>500

# 找某公司在 GitHub 上的所有项目
user:google deepseek
```

### 搜索结果页怎么看

- **Stars** — 越多说明越受欢迎
- **最近更新时间** — 如果好几年没更新，可能已经不维护了
- **Issues 数量** — 太多 Open Issues 说明维护跟不上
- **README** — 有没有清晰的文档，决定你能不能快速上手
- **License** — 有没有许可证，决定了你能不能合法使用

---

## 场景 13：多电脑同步 {#scenario-13}

**大白话**：家里台式机 + 公司笔记本都在同一个项目上干活。

### 在家里的电脑上

```bash
# 正常开发 → 每天下班前
git add .
git commit -m "今天做的改动"
git push
```

### 到了公司/换到笔记本

```bash
# 拉取最新的代码
git pull

# 继续开发...
```

### 如果有一台电脑是完全新的（还没有这个项目）

```bash
git clone https://github.com/你的用户名/项目名.git
cd 项目名
# 开始干活
```

### 小技巧

```bash
# 在回家前，如果手头的工作还没做完，可以先提交到临时分支
git checkout -b wip-未完成的工作
git add .
git commit -m "WIP: 登录功能做了一半"
git push origin wip-未完成的工作

# 回家后
git pull
git checkout wip-未完成的工作
# 继续干活
```

---

## 场景 14：分支管理 {#scenario-14}

**大白话**：分支就像游戏的存档分支，主线 stable，新功能在分支上开发，做好了再合并。

### 创建并切换到新分支

```bash
# 基于当前分支创建新分支
git checkout -b feat-新功能名

# 例：
git checkout -b feat-dark-mode
```

### 切换分支

```bash
# 切换到已有分支
git checkout 分支名

# 回到主分支
git checkout main
```

### 查看所有分支

```bash
# 查看本地分支
git branch

# 查看所有分支（包括远程）
git branch -a
```

### 合并分支

```bash
# 1. 先切换到要合并到哪个分支（通常是 main）
git checkout main

# 2. 拉取最新代码
git pull

# 3. 合并你的功能分支
git merge feat-新功能名

# 4. 推送
git push
```

### 删除分支

```bash
# 删除本地分支（已经合并过的）
git branch -d 分支名

# 强制删除本地分支（还没合并的，⚠️ 确认不要了再删）
git branch -D 分支名

# 删除远程分支
git push origin --delete 分支名
```

### 分支命名约定

| 前缀        | 用途               | 示例                   |
| ----------- | ------------------ | ---------------------- |
| `feat/`     | 新功能             | `feat-user-login`      |
| `fix/`      | 修 Bug             | `fix-header-overflow`  |
| `docs/`     | 文档更新           | `docs-api-reference`   |
| `chore/`    | 杂务（依赖更新等） | `chore-update-deps`    |
| `refactor/` | 代码重构           | `refactor-auth-module` |
| `test/`     | 测试相关           | `test-unit-coverage`   |

---

## 场景 15：自动化（GitHub Actions） {#scenario-15}

**大白话**：给仓库配一个"机器人"，每次 push 代码时自动做检查、自动部署。

### 能干什么

- 每次 push 自动跑测试
- 自动部署到 Vercel / Cloudflare / 服务器
- 自动检查代码格式
- 定时任务（比如每天自动抓数据）
- PR 时自动评论

### 快速体验：自动测试

在项目根目录创建 `.github/workflows/test.yml`：

```yaml
name: 自动测试

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Node.js 项目示例
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm test

      # Python 项目示例（注释掉上面 Node 的，用下面的）
      # - uses: actions/setup-python@v5
      #   with:
      #     python-version: '3.12'
      # - run: pip install -r requirements.txt
      # - run: pytest
```

提交这个文件后，去 GitHub 仓库页面 → **Actions** 标签，可以看到机器人正在跑你的测试。

---

## 场景 16：发布版本（Release） {#scenario-16}

**大白话**：代码写到一定阶段，打个版本标签，正式发布。

### 在 GitHub 网页上操作

1. 代码都 push 到 main 分支后
2. 仓库页面 → 右侧 **Releases** → **Create a new release**
3. **Tag**: 填写版本号，比如 `v1.0.0`
4. **Release title**: 比如 "v1.0.0 正式版发布"
5. **Describe**: 写更新日志（这次版本加了什么、修了什么）
6. 点 **Publish release**

### 用命令行打标签

```bash
# 打标签
git tag v1.0.0

# 推送标签到 GitHub
git push origin v1.0.0

# 或者推送所有标签
git push --tags
```

### 版本号约定（语义化版本）

```
v主版本号.次版本号.修订号

v1.0.0 → v2.0.0 ：不兼容的大改动
v1.1.0 → v1.2.0 ：加了新功能，但兼容旧版本
v1.0.1 → v1.0.2 ：修了个小 bug
```

### 发布内容怎么写（模板）

```markdown
## 新增功能

- 新增暗色模式切换
- 支持导出 PDF 格式

## 修复问题

- 修复首页在 Safari 上加载失败的问题
- 修复移动端按钮点击无响应

## 其他改进

- 优化了搜索速度
- 更新了依赖版本
```

---

## 场景 17：给项目加许可证 {#scenario-17}

**大白话**：告诉别人你的代码可以怎么用、不可以怎么用。

### 在 GitHub 上添加

1. 仓库页面 → **Add file** → **Create new file**
2. 文件名写 `LICENSE`
3. 右侧会出现 "Choose a license template" 按钮
4. 选择合适的协议 → Review → Commit

### 常见许可证一句话解释

| 许可证           | 一句话说明                                  | 适合谁               |
| ---------------- | ------------------------------------------- | -------------------- |
| **MIT**          | 随便用，保留我的版权声明就行                | 大多数开源项目       |
| **Apache 2.0**   | 比 MIT 多了专利授权条款                     | 大公司项目           |
| **GPL v3**       | 用了我的代码，你的代码也必须开源            | 坚持开源的理想主义者 |
| **AGPL v3**      | 比 GPL 更严格，通过网络使用的也算           | SaaS 防闭源          |
| **BSD**          | 跟 MIT 差不多                               | —                    |
| **Unlicense**    | 放弃所有版权，随便怎么用                    | 完全开放的示例代码   |
| **CC BY 4.0**    | 转载要署名                                  | 文档、教程、设计     |
| **CC BY-NC 4.0** | 可以转载但要署名，禁止商用                  | 教程、博客           |
| **None**         | 没有许可证 = 保留所有权利，别人不能合法使用 | 商业闭源项目         |

---

## 场景 18：大文件管理（Git LFS） {#scenario-18}

**大白话**：Git 不适合存大文件（视频、模型权重、PSD 设计稿），需要用 Git LFS。

### 安装 Git LFS

```bash
# macOS
brew install git-lfs

# 安装后初始化
git lfs install
```

### 使用 Git LFS

```bash
# 在项目里，告诉 Git LFS 要管理哪些类型的文件
git lfs track "*.psd"
git lfs track "*.mp4"
git lfs track "*.mov"
git lfs track "models/*.bin"
git lfs track "datasets/*.csv"

# Git LFS 的配置会写入 .gitattributes 文件
git add .gitattributes

# 正常使用 git add / commit / push 就行
git add 大文件.psd
git commit -m "添加设计稿"
git push
```

### 注意

- GitHub 免费账号 LFS 有存储和带宽限制
- 视频类文件（>100MB）建议用 YouTube / B站上传，README 里放链接
- 模型权重建议用 Hugging Face 托管，README 里放链接
- 数据集建议用 Kaggle / Hugging Face Datasets 托管

---

## 场景 19：仓库瘦身 {#scenario-19}

**大白话**：仓库太大下载慢？因为历史提交里藏了大文件或者敏感信息。

### 清理大文件

```bash
# 1. 找出仓库里最大的文件
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '/^blob/ {print $3, $4}' | sort -rn | head -20

# 2. 用 BFG 或 git-filter-repo 清理
# 安装 git-filter-repo
brew install git-filter-repo    # macOS
# pip install git-filter-repo   # 或 Python pip

# 3. 清理大于 50MB 的文件
git filter-repo --strip-blobs-bigger-than 50M

# 4. 强制推送
git push --force
```

### 清理敏感信息（API Key 等）

如果你不小心把密钥/密码提交到 GitHub 了：

```bash
# 1. 立即去服务商后台重置那个 Key（最重要！）
#    因为一旦 push 到 GitHub，别人可能已经看到了

# 2. 用 git-filter-repo 清理
git filter-repo --path .env --invert-paths
git push --force

# 3. 把这个文件加到 .gitignore（防止再次提交）
echo ".env" >> .gitignore
git add .gitignore
git commit -m "添加 .env 到 .gitignore"
git push
```

### 如果仓库太大只想下载最新代码

```bash
# 浅克隆（只下载最新一个版本，不含历史）
git clone --depth=1 https://github.com/用户名/仓库.git
```

---

## 附录：Git 命令速查表

```bash
# ---------- 状态 ----------
git status                 # 看当前什么状态
git log --oneline -10      # 最近 10 条提交

# ---------- 改动 ----------
git add .                  # 暂存所有改动
git add 文件名             # 暂存指定文件
git commit -m "消息"       # 提交
git push                   # 推送到 GitHub
git pull                   # 拉取最新代码

# ---------- 分支 ----------
git branch                 # 列出本地分支
git checkout -b 新分支名   # 创建并切换到新分支
git checkout 分支名        # 切换分支
git merge 分支名           # 合并分支到当前分支
git branch -d 分支名       # 删除已合并的分支

# ---------- 撤销 ----------
git restore 文件名         # 丢弃文件改动（未 add）
git restore --staged 文件  # 取消暂存（已 add 未 commit）
git reset --soft HEAD~1    # 撤销最近一次 commit（保留改动）
git revert 提交哈希        # 安全撤销某次提交

# ---------- 远程 ----------
git remote -v              # 查看远程仓库地址
git remote add origin URL  # 添加远程仓库
git remote set-url origin URL  # 修改远程仓库地址
git fetch                  # 获取远程更新但不合并

# ---------- 其他 ----------
git stash                  # 暂存当前改动（切换分支前）
git stash pop              # 恢复暂存的改动
git tag v1.0.0             # 打版本标签
git diff                   # 看未暂存的改动
```

---

返回主文档：[SKILL.md](../SKILL.md)
