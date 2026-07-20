# GitHub 术语大白话详解

## Git vs GitHub

很多人以为 Git 和 GitHub 是同一个东西，其实不是。

- **Git**：一个装在你电脑上的程序，负责"记录代码的版本"。你每改一次代码，做一次 Commit，Git 就在你电脑上存一个快照。**不需要联网也能用**。
- **GitHub**：一个网站，等于"代码的百度网盘"。你把本地 Git 记录的历史上传到 GitHub，别人就能看到、下载、一起改。

打个比方：Git 是 Word 的"修订模式"，GitHub 是把 Word 文档传到网盘上分享。

## .git 文件夹是什么

每个 Git 项目根目录下都有一个隐藏文件夹 `.git`，里面存了这个项目的**所有历史版本**。删掉 `.git` 文件夹，这个项目就不再是一个 Git 仓库了（变成一个普通文件夹），之前所有的版本历史也没了。

## 三个区域：工作区 → 暂存区 → 版本库

Git 在你的电脑上分了三个"区域"：

1. **工作区（Working Directory）**：你现在正在看的、正在编辑的文件夹。你改了代码但还没告诉 Git，改动就在工作区。
2. **暂存区（Staging Area）**：`git add` 之后，改动进入暂存区。相当于你说"这堆改动我准备提交了"。
3. **版本库（Repository）**：`git commit` 之后，改动正式存入版本库，成为一个永久版本。

```
你编辑文件 → git add → git commit → git push
 (工作区)     (暂存区)    (本地版本库)   (GitHub远程)
```

## 为什么要有暂存区

因为你不一定想把所有改动都一次性提交。比如你改了 5 个文件，但只有 3 个是相关的，你可以：

```bash
git add 文件1 文件2 文件3     # 只暂存这 3 个
git commit -m "修复登录功能"
git add 文件4 文件5           # 剩下的另外提交
git commit -m "优化首页样式"
```

## merge vs rebase

两个都是"把两条分支合到一起"的方式，但做法不同：

- **merge**：创建一个新的"合并提交"，保留两条分支的完整历史。简单安全，推荐新手用。
- **rebase**：把你分支上的提交"搬家"到目标分支的最新位置。历史更干净（一条直线），但改写了提交历史。

新手建议：用 `merge`。等熟悉了再学 `rebase`。

## fork vs clone

- **clone**：把 GitHub 上的仓库下载到你电脑上。你的电脑 ← GitHub。
- **fork**：在 GitHub 网站上把别人的仓库"复印"一份到你自己的 GitHub 账号下。你的 GitHub ← 别人的 GitHub。

要参与开源项目，先 fork，再 clone 你 fork 的版本。

## HTTPS vs SSH

GitHub 提供两种连接方式：

|            | HTTPS                               | SSH                            |
| ---------- | ----------------------------------- | ------------------------------ |
| 地址格式   | `https://github.com/用户/仓库.git`  | `git@github.com:用户/仓库.git` |
| 需要配置吗 | 不需要，第一次要输密码              | 需要先配 SSH Key               |
| 体验       | 每次 push/pull 可能要输密码或 token | 一次配好，一直免密             |

## 常见的分支模型

### 简单个人项目

只用 `main` 分支就够了。

### 团队项目（GitHub Flow）

- `main` — 永远是可以部署的稳定代码
- `feat-xxx` — 每个新功能开一个分支，做完后 PR 合并回 main

### 大型项目（Git Flow）

- `main` — 正式发布版本
- `develop` — 开发主线
- `feature/xxx` — 功能分支
- `release/x.x.x` — 准备发布的版本
- `hotfix/xxx` — 紧急修复

新手不需要搞这么复杂，GitHub Flow 就够了。

## .github 目录

在仓库根目录下创建 `.github/` 文件夹，可以放项目的"元信息"：

```
.github/
├── ISSUE_TEMPLATE/         # Issue 模板
│   ├── bug_report.md
│   └── feature_request.md
├── PULL_REQUEST_TEMPLATE.md  # PR 模板
├── workflows/              # GitHub Actions 自动化
│   └── test.yml
└── FUNDING.yml             # 赞助信息
```
