/**
 * vaultTemplates.ts — 内置知识库模板
 *
 * 每个模板包含 CLAUDE.md 配置 + raw/wiki 文件夹结构，
 * 用户在知识库仓库中点击"添加"时自动创建完整骨架。
 */

export interface VaultTemplate {
  id: string
  name: string
  icon: string
  oneLineDesc: string
  keywords: string[]
  type: 'novel' | 'project' | 'general'
  claudeMd: string
  rawFolders: string[]
  wikiFolders: string[]
}

export const VAULT_TEMPLATES: VaultTemplate[] = [
  {
    id: 'tpl_lawyer',
    name: '律师知识库',
    icon: 'gavel',
    oneLineDesc: '刑事辩护律师的案件、法规和辩护策略管理',
    keywords: ['律师', '法律', '案件', '辩护', '刑事'],
    type: 'project',
    claudeMd: `# 律师知识库配置文件

## 基本信息
profession: "律师"
specialty: "刑事/民事案件"

## 文件夹结构
folders:
  案件:
    description: "所有案件的详细信息"
    classification:
      - 按罪名/案由（主要）
      - 按结果（辅助）
      - 按年份（辅助）
    metadata_required:
      - 案号
      - 罪名/案由
      - 当事人（脱敏）
      - 关键证据
      - 辩护策略
      - 判决结果
      - 经验教训

  法律知识:
    description: "法律法规、司法解释"
    classification:
      - 按法律类别（刑法、刑诉法）
      - 按条文编号

  辩护策略:
    description: "可复用的辩护方法"
    classification:
      - 按策略类型（无罪、罪轻、程序）

  判例库:
    description: "指导案例和典型判例"

  文书模板:
    description: "辩护词、质证意见等模板"

  证据分析:
    description: "证据审查方法论"

## 提取规则
extract_from_conversations:
  - 案件基本信息（案号、当事人、罪名）
  - 辩护思路和策略讨论
  - 法律条文引用
  - 判决结果和经验教训

## 隐私保护
privacy:
  - 当事人姓名自动替换为"张某""李某"
  - 身份证号、电话号码自动脱敏

## 使用场景
use_cases:
  - "快速找到类似案例"
  - "总结某个罪名的辩护经验"
  - "生成辩护词初稿"
  - "统计胜诉率"
  - "查询法律条文"`,
    rawFolders: ['对话记录', '参考资料', '灵感笔记'],
    wikiFolders: [
      '案件/按罪名', '案件/按年份', '案件/按结果',
      '辩护策略/无罪辩护', '辩护策略/罪轻辩护', '辩护策略/程序辩护',
      '法律知识/刑法', '法律知识/刑诉法', '法律知识/司法解释',
      '判例库',
      '文书模板',
      '证据分析',
    ],
  },
  {
    id: 'tpl_novel',
    name: '小说知识库',
    icon: 'auto_stories',
    oneLineDesc: '小说创作的角色、世界观、情节和章节管理',
    keywords: ['小说', '写作', '创作', '角色', '情节', '世界观'],
    type: 'novel',
    claudeMd: `# 小说知识库配置文件

## 基本信息
role: "小说作者"
genre: "待定"

## 文件夹结构
folders:
  作品:
    description: "正式发布的章节内容"
    classification:
      - 按部数分类
      - 按章节编号

  角色:
    description: "所有角色的详细设定"
    classification:
      - 主角/配角/反派
    metadata_required:
      - 姓名
      - 年龄
      - 性格
      - 外貌
      - 能力
      - 关键事件
      - 人际关系

  世界观:
    description: "世界设定、规则体系"
    subfolders:
      - 地理
      - 势力
      - 规则体系
      - 历史背景

  情节:
    description: "主线、支线、伏笔"

  大纲:
    description: "整体规划"

  时间线:
    description: "事件发生的时间顺序"

  道具物品:
    description: "重要的物品、武器"

  场景:
    description: "重要场景的详细描述"

  写作技巧:
    description: "写作经验和技巧"

  创作笔记:
    description: "创作过程中的心得体会"

## 提取规则
extract_from_conversations:
  - 角色设定讨论（新增/修改角色属性）
  - 情节推进（新章节大纲、剧情走向）
  - 世界观补充（新设定、规则）
  - 创作决策（版本选择、写法偏好）
  - 写作技巧讨论

## 一致性检查
consistency_check:
  - 角色设定前后是否一致
  - 时间线是否合理
  - 地理位置是否矛盾
  - 能力体系是否统一

## 使用场景
use_cases:
  - "查询角色设定"
  - "检查情节是否有矛盾"
  - "续写下一章"
  - "查看某个伏笔在哪里埋下的"`,
    rawFolders: ['草稿', '对话记录', '灵感碎片'],
    wikiFolders: [
      '作品',
      '角色/主角', '角色/配角', '角色/反派',
      '世界观/地理', '世界观/势力', '世界观/规则体系', '世界观/历史背景',
      '情节/主线',
      '大纲',
      '时间线',
      '道具物品',
      '场景',
      '写作技巧',
      '创作笔记',
    ],
  },
  {
    id: 'tpl_research',
    name: '研究笔记知识库',
    icon: 'science',
    oneLineDesc: '论文阅读、实验记录和研究进展管理',
    keywords: ['研究', '论文', '实验', '笔记', '学术'],
    type: 'project',
    claudeMd: `# 研究笔记知识库配置文件

## 基本信息
role: "研究者"

## 文件夹结构
folders:
  论文笔记:
    description: "阅读过的论文摘要和笔记"
  实验记录:
    description: "实验设计、结果和分析"
  研究进展:
    description: "里程碑和进度记录"
  方法论:
    description: "常用方法和工具"
  灵感和想法:
    description: "碎片化的研究灵感"

## 提取规则
extract_from_conversations:
  - 论文讨论要点和关键发现
  - 实验设计和参数
  - 研究方向和决策
  - 方法论讨论

## 使用场景
use_cases:
  - "找到相关论文笔记"
  - "回顾实验结果"
  - "整理研究进展"`,
    rawFolders: ['对话记录', '论文PDF', '参考资料'],
    wikiFolders: [
      '论文笔记',
      '实验记录',
      '研究进展',
      '方法论',
      '灵感和想法',
    ],
  },
]
