---
name: jc-everything-wiki
description: Use when a user wants help designing or creating a precise Wiki folder structure for an existing Jiucaihezi memory space. Trigger on 规划Wiki, 创建Wiki目录, 完善Wiki架构, 我不知道Wiki该建什么, 根据我的需求设计Wiki, or 把这个项目整理成Wiki.
---

# JC Everything Wiki

1. 读取用户目标和现有 Wiki 目录；沿用现有 Wiki 根目录。信息不足以确定结构时，只问会改变目录设计的问题。
2. 识别需要长期保存和反复检索的知识，确定目录、子目录及其归属关系。
3. 先给方案，不写入；用户确认后再创建并复查实际结构。

目录设计必须满足：

- 每个目录有唯一用途；用途相同的合并。
- 子目录内容必须属于父目录；同级目录保持相同粒度。
- 单篇内容用文件，持续增加的同类内容才用目录。
- 只创建当前需求需要的结构，不建空模板。
- 保留已有内容，不覆盖。
- `index.md` 只导航顶层目录；每个目录的 `_index.md` 说明本目录用途并导航直属子目录。

方案固定输出：

```text
[现有 Wiki 根目录]/
├── [目录]/
│   ├── _index.md
│   └── [子目录]/
└── [页面].md
```

| 路径 | 用途 | 放什么 | 不放什么 | 为什么归属该父目录 |
|---|---|---|---|---|
| `[Wiki 根目录]/...` | ... | ... | ... | ... |

最后列出本次不创建的目录及原因，并请用户确认。
