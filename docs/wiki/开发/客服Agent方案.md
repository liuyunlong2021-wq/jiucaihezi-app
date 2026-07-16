# 韭菜盒子 · 客服 Agent 方案

> 状态：草案 · 2026-07-15

---

## 一、目标

用户触发 `JC-新手指导` Skill 后，对话自动存入云端数据库。每天凌晨自动消化成知识库，Agent 越用越聪明。

**核心设计：零改动现有聊天流程。** Skill 加一条铁律，LLM 每次回答后顺手 POST 数据到 VPS。

---

## 二、架构

```
用户聊天（触发 JC-新手指导 Skill）
     ↓
铁律第8条：curl GET /api/agent/search  ← 查历史知识库
     ↓
LLM 回答（融入知识库内容）
     ↓
铁律第9条：curl POST → /api/agent/store  ← 存问答
     ↓
┌─ VPS ───────────────────────┐
│                             │
│  Nginx                      │
│   /api/agent/ → :8800       │
│              ↓              │
│  agent-store (Docker)       │
│  ┌──────────────────────┐  │
│  │ FastAPI               │  │
│  │ POST /store  收数据    │  │
│  │ GET  /health  健康检查 │  │
│  │                       │  │
│  │ SQLite: /data/agent.db │  │
│  │   conversations        │  │
│  │   wiki_entries         │  │
│  └──────────────────────┘  │
│                             │
│  Cron (每天凌晨3点)          │
│  ┌──────────────────────┐  │
│  │ 读 conversations      │  │
│  │ → LLM 判断有效性      │  │
│  │ → 写 wiki_entries     │  │
│  └──────────────────────┘  │
└─────────────────────────────┘
```

**没有独立 LLM 调用链路。** VPS 只做两件事：收数据 + 定时消化。

---

## 三、API

```
POST /api/agent/store
  Body: { "q": "用户问题", "a": "AI回答" }
  Response: { "ok": true }

GET /api/agent/search?q=关键词
  Response: [{ "question": "...", "answer": "..." }, ...]

GET /api/agent/health
  Response: { "status": "ok" }
```

---

## 四、数据库

```sql
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    digest_status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE wiki_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    source_ids TEXT,
    verified INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 五、消化 Cron

每天凌晨 3 点跑 `digest.py`：

1. 读 `digest_status='pending'` 的对话
2. LLM 判断：有效问答 → 提取 → wiki_entries；无效 → 标记 skipped
3. 同一问题多次出现 → 合并

---

## 六、Skill 与 Wiki 的关系

**Skill 只管两件事：查 Wiki + 存问答。** 极简，不读本地文件。

```
Skill（轻量）
├── 人设：东北话 + 情绪价值
├── 启动闸门：GIF → 喊话 → 菜单
├── curl GET  /api/agent/search   ← 查 Wiki
└── curl POST /api/agent/store    → 存问答

服务器 Wiki（全量知识）
├── wiki_entries（种子数据 = 原 references/ 内容）
│   ├── 1-Wiki使用
│   ├── 2-漫剧制作
│   ├── 3-Skill科普
│   ├── 4-产品功能
│   ├── 5-模型科普
│   ├── 6-应用赛道
│   ├── 7-电商
│   ├── 8-办公
│   └── ...（随用户问答持续增长）
└── 每天凌晨消化新问答 → 自动扩充
```

**首次部署时**，把 8 个 reference 文件内容导入 wiki_entries 作为种子数据。之后全靠用户问答自动生长。

---

## 七、部署

### Step 1: agent-store 服务

`/opt/agent-store/`:

```
main.py           # FastAPI: POST /store, GET /search, GET /health
db.py             # SQLite 读写
digest.py         # Cron 消化
seed.py           # 首次导入 references/ 种子数据
requirements.txt  # fastapi, uvicorn
Dockerfile
data/
  agent.db        # 自动创建
```

### Step 2: Docker Compose

```yaml
agent-store:
  build: /opt/agent-store
  container_name: agent-store
  ports:
    - "127.0.0.1:8800:8000"
  volumes:
    - /opt/agent-store/data:/app/data
    - /opt/agent-store/skills:/app/skills:ro
  restart: unless-stopped
```

### Step 3: Nginx

```nginx
location /api/agent/ {
    proxy_pass http://127.0.0.1:8800/;
}
```

### Step 4: 导入种子数据

首次部署时，把 `JC-新手指导/references/` 下 8 个文件导入 wiki_entries：

```bash
# 在服务器上执行
docker exec agent-store python /app/seed.py
```

`seed.py` 读取 Skill 目录下的 references，逐条写入 wiki_entries。

### Step 5: Cron

```bash
0 3 * * * docker exec agent-store python /app/digest.py >> /var/log/agent-digest.log 2>&1
```

---

## 八、成本

| 项目 | 月成本 |
|------|--------|
| 容器（VPS 已有） | ¥0 |
| SQLite | ¥0 |
| 消化时 LLM 调用（每天几十条） | ~¥0.5 |

---

## 九、与主阵地的关系

```
主阵地聊天                    触发 JC-新手指导 时
     ↓                              ↓
正常聊天                         正常聊天（完全相同）
     ↓                              ↓
不留数据                         curl POST 到 /api/agent/store
                                   ↓
                                VPS SQLite
```

同一个聊天框、同一个 LLM、同一个模型选择——唯一区别是 Skill 铁律多了一行 `curl`。
