# 伏笔追踪表 —— Obsidian Bases (.base)

> 模板文件。jiyasuo 整理记忆时，扫描 `wiki/剧情/悬念.md`，自动生成/更新此表。
> 在 Obsidian 中打开可看到表格视图、按状态筛选、按集数排序。

## 文件位置

`wiki/剧情/伏笔追踪.base`

## 模板

```yaml
filters:
  - and:
    - property: status
      operator: "!="
      value: "废弃"

formulas:
  - name: overdue
    definition: |
      if(
        status != "已收" and status != "废弃",
        (now() - planted_date).days,
        null
      )

properties:
  status:
    display: 状态
  episode_planted:
    display: 埋笔集
  episode_resolved:
    display: 回收集
  overdue:
    display: 已悬置(天)
    type: formula

summaries:
  - formula: "已收"
    condition:
      property: status
      operator: "=="
      value: "已收"
    aggregate: count
    display: 已回收
  - formula: "未收"
    condition:
      property: status
      operator: "=="
      value: "未收"
    aggregate: count
    display: 待回收

views:
  - type: table
    name: 全部伏笔
    columns:
      - property: title
        display: 伏笔
      - property: status
        display: 状态
      - property: episode_planted
        display: 埋笔集
      - property: episode_resolved
        display: 回收集
      - property: overdue
        display: 已悬置

  - type: cards
    name: 未收伏笔
    filter:
      property: status
      operator: "=="
      value: "未收"
    columns:
      - property: title
      - property: episode_planted
      - property: overdue
```

## 对应的悬念.md 格式

jiyasuo 确保 `wiki/剧情/悬念.md` 中每条悬念有明确的 frontmatter 字段：

```markdown
---
title: 悬念追踪
类型: 剧情/悬念
---
# 悬念追踪

## 已埋悬念

| 悬念 | 埋笔集 | 状态 | 回收集 |
|------|--------|------|--------|
| 红云的气息被老怪物感应到 | 第3集 | 未收 | — |
| 韭菜盒子的模型权重文件来自未来 | 第1集 | 未收 | — |
| 鲲鹏在寻找红云的遗物 | 第5集 | 未收 | — |
```

jiyasuo 整理时，将此表同步到 .base 文件的 views 中，确保表格视图和 markdown 表格内容一致。

## 其他可用 .base 视图

| 用途 | 文件 | 说明 |
|------|------|------|
| 角色出场统计 | `wiki/剧情/出场统计.base` | 表格：角色/出场集数/出场次数 |
| 爽点分布 | `wiki/剧情/爽点分布.base` | 卡片：集号/爽点类型/强度 |
| 章节字数 | `wiki/剧情/字数统计.base` | 表格：集号/场次数/总字数 |

这些按需生成——jiayasuo 在用户说「生成XX统计表」时创建，不自动生成所有。
