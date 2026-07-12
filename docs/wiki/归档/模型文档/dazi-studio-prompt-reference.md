# dazi-studio 提示词参考站

## 是什么

「搭子提示词库」— 独立的引流展示站，提供 GPT Image 2(JC 精选图库) / Nano Banana / Seedream / Seedance / Grok Imagine 的参考图和可复制提示词。不提供生成能力，仅展示 + 复制 + 引流到韭菜盒子创作。

## 线上地址

- **主域名**：`https://dazi.studio/`

## 源码仓库

```
/Users/by3/Documents/dazi-studio
https://github.com/liuyunlong2021-wq/my-gpt-image-2.git
```

## 技术栈

纯静态 HTML + CSS + 原生 JS，无框架/不需要构建工具。

## 项目结构

```
dazi-studio/
├── index.html           # 单页：模型 Tab + 分类栏 + 画廊(无Hero)
├── js/app.js            # 全部交互逻辑
├── css/style.css        # 暗色主题
├── data/
│   ├── index.json       # 模型索引
│   ├── nano-banana.json # 其他模型(YouMind 源)
│   ├── seedream.json
│   ├── seedance.json
│   ├── grok-imagine.json
│   ├── jc-gpt2-gallery.json  # ★ GPT Image 2 精选图库(177条, 34分类)
│   └── gpt-image-2.json      # (废弃)老数据,不再加载
└── scripts/
    ├── sync.py               # 从 YouMind 同步数据
    └── build-jc-gallery.py   # ★ 从 markdown 画廊生成精选图库 JSON
```

## 部署

- **平台**：Cloudflare Pages（项目名 `dazi`）
- **部署命令**：`cd /Users/by3/Documents/dazi-studio && npx wrangler pages deploy . --project-name dazi --commit-dirty=true`

## GPT Image 2 数据源（2026-07-07 重写）

| 旧 | 新 |
|----|---|
| YouMind 同步(1735条, 92.7%空提示词) | JC 精选图库(177条, 全部有提示词) |
| 无分类 | 34 分类(Anime & Manga, Character Design...) |
| 图片来自 cms-assets.youmind.com | 图片来自 GitHub raw |

**JC 精选图库数据来源**：`jiucaihezi-app/public/skills/JC-GPT-Image2-Skill/gpt-image/references/gallery-*.md`
**图片仓库**：`https://github.com/liuyunlong2021-wq/JC-GPTImage2-skill` → `JC-GPT-Image2-Skill/docs/`

### 同步步骤（新增分类或图片时）

```bash
# 1. 确保 JC-GPTImage2-skill 仓库的 docs/ 已更新
cd /Users/by3/Documents/JC-GPTImage2-skill
git add JC-GPT-Image2-Skill/docs/
git commit -m "docs: 补充参考图"
git push origin main

# 2. 重建 dazi-studio 数据
cd /Users/by3/Documents/dazi-studio
python3 scripts/build-jc-gallery.py

# 3. 部署
npx wrangler pages deploy . --project-name dazi --commit-dirty=true
```

## 2026-07-07 修复记录

- **搜索崩溃**: `tCat(null).toLowerCase()` 空指针 → 加 `(c.category || '')` 防护
- **复制提示词**: prompt 为空时 fallback 到 `c.title`
- **画廊 ID 重复**: 多文件分别从 0 编号 → 全局递增计数器(177个唯一ID)
- **Hero 删除**: 超大 Hero 区移除,页面直接展示模型/分类/画廊
- **图片路径**: 目录名和 markdown 文件名不一致导致 404 → 标题别名映射

## 维护 checklist

- [ ] 更新 JC 精选图库 → 跑 `build-jc-gallery.py` + `wrangler pages deploy`
- [ ] 同步 YouMind 数据 → 跑 `sync.py` + `wrangler pages deploy`
