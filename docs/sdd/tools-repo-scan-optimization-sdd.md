# SDD: 工具仓库批量扫描 & 缓存优化

> **状态**: 方案设计 | **日期**: 2026-07-06 | **分支**: 0706-cangkuyouhua
> **参考**: [vscode-project-manager](https://github.com/alefragnani/vscode-project-manager) `abstractLocator.ts` / `repositoryDetector.ts`
> **原则**: 抄袭为主，稳中求成。不新建 subsystem，不做过早抽象。

---

## 一、问题

### 卡顿

点击工具仓库 → 19 个 `GitHubSkillCard` 各自调 `invoke('check_tool_installed')` → 19 次 IPC + 19 次 PATH 查找 → 明显卡顿。

### 漏扫

`check_tool_installed` 只检测：
- `~/.jiucaihezi/tools/{id}/` 目录
- 硬编码 9 个二进制名 in PATH
- 1 个 npx 检测

brew/npm/pip 全局安装的完全不检测。

---

## 二、抄过来的模式

从 vscode-project-manager 抄三个东西：

### 模式一：alreadyLocated 缓存（`abstractLocator.ts:91-118`）

```ts
// vscode-project-manager 原文逻辑
initializeCfg() {
    if (fs.existsSync(cacheFile)) {
        this.projectList = JSON.parse(fs.readFileSync(cacheFile));
        if (valid) { this.alreadyLocated = true; return; }
        // 缓存无效 → 删除 → 重扫
    }
}
locateProjects() {
    if (this.alreadyLocated) return this.projectList; // ← 零开销
    // 扫描...
    this.updateCacheFile();
}
```

抄成：`check_all_tools` 读 `~/.jiucaihezi/tools/tools_cache.json`，缓存新鲜（< 5min）直接返回，否则重扫写缓存。

### 模式二：RepositoryDetector 策略派发（`repositoryDetector.ts`）

```ts
interface RepositoryDetector {
    isRepoDir(path): boolean;
    isRepoFile?(file): boolean;
}
// Git: 查 .git 目录, VSCode: 查 .vscode 目录, SVN: 查 .svn
```

抄成：每个 tool 在 `githubTools.json` 声明 `detection` 策略列表，Rust 侧按 `type` match 派发。

### 模式三：Locators 聚合一次返回（`locators.ts`）

```ts
class Locators {
    vscLocator = new CustomProjectLocator(...);
    gitLocator = new CustomProjectLocator(...);
    // 一次 refresh 全量扫描
}
```

抄成：`check_all_tools` 一次 IPC 返回所有工具的安装状态 Map，前端面板 provide 给卡片。卡片不再自己调 IPC。

---

## 三、设计

### 3.1 一条 IPC，全量返回 + 缓存

```
用户点击工具仓库
  → ToolWarehousePanel onMounted
    → invoke('check_all_tools', { force: false })   ← 唯一一次 IPC
      │
      ├─ [缓存新鲜] 读 tools_cache.json → 直接返回 (< 5ms)
      │
      └─ [缓存过期] 批量扫描 (~500ms)
            for tool in githubTools.json.tools:
              遍历 tool.detection[]
                match type:
                  "dir"     → fs::exists(path)
                  "which"   → resolve_local_binary(binary)
                  "brew"    → brew list --formula | grep name
                  "npm"     → npm ls -g | grep package
                  "pip"     → python3 -c "import name"
                  "npx"     → npx package --version
                  "command" → command -v binary
                任一命中 → break
            写缓存 → 返回 { toolId: { installed, path, method } }
      │
      └─ toolStatuses = result
         → provide → GitHubSkillCard 纯展示
```

### 3.2 缓存文件

```json
// ~/.jiucaihezi/tools/tools_cache.json
{
  "scanned_at": "2026-07-06T15:30:00Z",
  "ttl_seconds": 300,
  "tools": {
    "ffmpeg":    { "installed": true,  "path": "/opt/homebrew/bin/ffmpeg", "method": "which" },
    "gallery-dl":{ "installed": false },
    "yt-dlp":    { "installed": true,  "path": "/opt/homebrew/bin/yt-dlp", "method": "brew" }
  }
}
```

TTL 5 分钟。用户点刷新按钮 → `force=true` → 跳过缓存重扫。

### 3.3 detection 字段（`githubTools.json` 每工具新增）

```jsonc
{
  "id": "ffmpeg",
  "detection": [
    { "type": "which", "binary": "ffmpeg" },
    { "type": "dir",   "path": "~/.jiucaihezi/tools/ffmpeg" },
    { "type": "brew",  "name": "ffmpeg" }
  ]
}
```

7 种策略，每个独立线程 + 超时（3-5s），超时跳过该策略继续下一个：

| type | 检测方式 | 超时 |
|------|----------|------|
| `dir` | `fs::metadata(path)` | — |
| `which` | 复用现有 `resolve_local_binary()` | — |
| `brew` | `brew list --formula \| grep -Fx name` | 3s |
| `npm` | `npm ls -g --depth=0 \| grep package` | 5s |
| `pip` | `python3 -c "import name"` | 3s |
| `npx` | `npx package --version` | 5s |
| `command` | `command -v binary` | 3s |

---

## 四、Rust 实现（扩展现有 `tools.rs`）

**不新建文件，不新建目录。** 在现有 `src-tauri/src/commands/tools.rs` 末尾追加：

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use chrono::Utc;

// ── 缓存结构 ──
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolsCache {
    scanned_at: String,
    ttl_seconds: u64,
    tools: HashMap<String, ToolCacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolCacheEntry {
    installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<String>,
}

// ── 工具定义（从 githubTools.json 编译时嵌入） ──
#[derive(Debug, Deserialize)]
struct ToolDefinition {
    id: String,
    detection: Vec<DetectionStrategy>,
}

#[derive(Debug, Deserialize)]
struct DetectionStrategy {
    #[serde(rename = "type")]
    type_: String,
    #[serde(default)]
    binary: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    package: Option<String>,
}

// ── 缓存路径 ──
fn tools_cache_path() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("HOME")?)
        .join(".jiucaihezi")
        .join("tools")
        .join("tools_cache.json"))
}

fn read_cache() -> Option<ToolsCache> {
    let path = tools_cache_path()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    let cache: ToolsCache = serde_json::from_str(&raw).ok()?;
    let scanned: chrono::DateTime<chrono::Utc> = cache.scanned_at.parse().ok()?;
    let age = chrono::Utc::now().signed_duration_since(scanned);
    if age.num_seconds() < cache.ttl_seconds as i64 { Some(cache) } else { None }
}

fn write_cache(tools: &HashMap<String, ToolCacheEntry>) {
    if let Some(path) = tools_cache_path() {
        let _ = std::fs::create_dir_all(path.parent().unwrap());
        let cache = ToolsCache {
            scanned_at: chrono::Utc::now().to_rfc3339(),
            ttl_seconds: 300,
            tools: tools.clone(),
        };
        let _ = std::fs::write(&path, serde_json::to_string_pretty(&cache).unwrap_or_default());
    }
}

// ── 单策略检测 ──
fn try_detect(strategy: &DetectionStrategy) -> Option<(String, String)> {
    match strategy.type_.as_str() {
        "dir" => {
            // ponytail: ~ 展开用 std::env，不加 shellexpand 依赖
            let raw = strategy.path.as_ref()?;
            let p = if raw.starts_with('~') {
                std::env::var_os("HOME")
                    .map(|h| {
                        let mut pb = PathBuf::from(h);
                        if raw.len() > 2 { pb.push(&raw[2..]); }
                        pb.to_string_lossy().to_string()
                    })
                    .unwrap_or_else(|| raw.to_string())
            } else {
                raw.to_string()
            };
            std::fs::metadata(&p).ok().map(|_| (p, "dir".into()))
        }
        "which" => {
            let bin = strategy.binary.as_ref()?;
            resolve_local_binary_option(bin)
                .map(|p| (p.to_string_lossy().to_string(), "which".into()))
        }
        "brew" => {
            let name = strategy.name.as_ref()?;
            run_checked("brew", &["list", "--formula"], 3)
                .filter(|out| out.lines().any(|l| l.trim() == name))
                .map(|_| (format!("brew: {}", name), "brew".into()))
        }
        "npm" => {
            let pkg = strategy.package.as_ref()?;
            run_checked("npm", &["ls", "-g", "--depth=0"], 5)
                .filter(|out| out.contains(pkg))
                .map(|_| (format!("npm: {}", pkg), "npm".into()))
        }
        "pip" => {
            let name = strategy.name.as_ref()?;
            run_checked("python3", &["-c", &format!("import {}", name)], 3)
                .map(|_| (format!("pip: {}", name), "pip".into()))
        }
        "npx" => {
            let pkg = strategy.package.as_ref()?;
            run_checked("npx", &[pkg, "--version"], 5)
                .map(|_| (format!("npx: {}", pkg), "npx".into()))
        }
        "command" => {
            let bin = strategy.binary.as_ref()?;
            #[cfg(windows)]
            let (cmd, args) = ("where", vec![bin.as_str()]);
            #[cfg(not(windows))]
            let (cmd, args) = ("command", vec!["-v", bin.as_str()]);
            run_checked(cmd, &args, 3)
                .map(|out| (out.trim().to_string(), "command".into()))
        }
        _ => None,
    }
}

fn run_checked(cmd: &str, args: &[&str], timeout_secs: u64) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let cmd = cmd.to_string();
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    std::thread::spawn(move || {
        let out = std::process::Command::new(&cmd)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok());
        let _ = tx.send(out);
    });
    rx.recv_timeout(std::time::Duration::from_secs(timeout_secs))
        .unwrap_or(None)
        .filter(|s| !s.is_empty())
}

// ── 主命令 ──
#[tauri::command]
pub fn check_all_tools(force: bool) -> Result<HashMap<String, ToolCacheEntry>, String> {
    // 1. 缓存命中
    if !force {
        if let Some(cache) = read_cache() {
            return Ok(cache.tools);
        }
    }

    // 2. 加载工具定义（编译时嵌入 githubTools.json）
    let raw = include_str!("../../../src/data/githubTools.json");
    let defs: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let tools: Vec<ToolDefinition> = serde_json::from_value(defs["tools"].clone())
        .map_err(|e| e.to_string())?;

    // 3. 批量扫描（串行，每个工具检测策略按优先级顺序）
    let mut results = HashMap::new();
    for tool in &tools {
        let status = scan_one(tool);
        results.insert(tool.id.clone(), status);
    }

    // 4. 写缓存（best-effort，失败不阻塞返回）
    write_cache(&results);

    Ok(results)
}

fn scan_one(tool: &ToolDefinition) -> ToolCacheEntry {
    if tool.detection.is_empty() {
        return ToolCacheEntry { installed: false, path: None, method: None };
    }
    for strategy in &tool.detection {
        if let Some((path, method)) = try_detect(strategy) {
            return ToolCacheEntry { installed: true, path: Some(path), method: Some(method) };
        }
    }
    ToolCacheEntry { installed: false, path: None, method: None }
}
```

**不删不改**：`check_tool_installed`、`check_opencode_plugin`、`check_whisper_available`、`resolve_local_binary` 全部保留。

---

## 五、前端改动

### 5.1 ToolWarehousePanel

改动要点：
- `onMounted` 调 `check_all_tools` → 存 `toolStatuses`
- `refreshDetection()` 改调 `check_all_tools({ force: true })`（不再用 `refreshKey++`）
- 新增 `scanning` 状态，扫描时不渲染卡片网格（避免 `capStatus` 为 `undefined` 时卡片回退到旧 IPC）
- 两个卡片网格（`githubTools` + `pluginEntries`）都传 `:cap-status` prop
- 移除 `refreshKey`，key 改为 `:key="tool.id"`（状态由 prop 驱动，不需要强制重挂载）

```vue
<script setup>
import { onMounted, ref } from 'vue'

const toolStatuses = ref<Record<string, ToolCacheEntry>>({})
const scanning = ref(false)

onMounted(async () => {
  if (!isTauriRuntime()) return
  scanning.value = true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    toolStatuses.value = await invoke('check_all_tools', { force: false })
  } finally {
    scanning.value = false
  }
})

function refreshDetection() {
  scanning.value = true
  import('@tauri-apps/api/core').then(({ invoke }) => {
    invoke('check_all_tools', { force: true })
      .then(r => { toolStatuses.value = r as Record<string, ToolCacheEntry> })
      .finally(() => { scanning.value = false })
  })
}
</script>

<template>
  <!-- ... 搜索/标题区不变 ... -->

  <!-- 扫描中占位 -->
  <div v-if="scanning" class="tw-scanning">正在检测工具安装状态...</div>

  <template v-else>
    <!-- GitHub 推荐安装 -->
    <div class="tw-section">
      <GitHubSkillCard
        v-for="tool in githubTools"
        :key="tool.id"
        :skill="tool"
        :cap-status="toolStatuses[tool.id]"
      />
    </div>

    <!-- 插件（同样传 capStatus） -->
    <div v-if="pluginEntries.length > 0" class="tw-section">
      <GitHubSkillCard
        v-for="plugin in pluginEntries"
        :key="'p-' + plugin.id"
        :skill="plugin"
        :cap-status="toolStatuses[plugin.id]"
      />
    </div>
  </template>

  <!-- ... Obsidian 向导/高级扩展/知识库模板区不变 ... -->
</template>
```

### 5.2 GitHubSkillCard（新增可选 prop，兼容旧逻辑）

```vue
<script setup>
const props = defineProps<{
  skill: GitHubSkillEntry
  capStatus?: { installed: boolean; path?: string; method?: string }
}>()

// 兼容策略：capStatus 有值走新路径，无值走旧逻辑（其他面板仍用 GitHubSkillCard 不传此 prop）
const displayInstalled = computed(() => {
  if (props.capStatus !== undefined) return props.capStatus.installed
  return isInstalled.value    // ← 旧逻辑：卡片自己 checkInstalled() 的结果
})
const displayPath = computed(() => {
  if (props.capStatus?.path) return props.capStatus.path
  return installPath.value    // ← 旧逻辑：卡片自己 checkInstalled() 的结果
})
</script>
```

**渐进策略**：`capStatus` 可选。工具面板传 prop 走新路径；Skill 面板等不传 prop，自动走旧逻辑（卡片自己 `checkInstalled()` IPC）。工具面板全量切换后，下次 PR 删除旧 `checkInstalled` 逻辑。

---

## 六、改动文件清单（5 个文件）

| # | 文件 | 改动 | 行数 |
|---|------|------|------|
| 1 | `src-tauri/src/commands/tools.rs` | 追加 `check_all_tools` + 缓存读写 + 策略 match | ~120 行新增 |
| 2 | `src-tauri/src/lib.rs` | 注册 `check_all_tools` 命令 | +1 行 |
| 3 | `src/data/githubTools.json` | 每工具加 `detection` 字段（19 个） | ~100 行新增 |
| 4 | `src/components/tools/ToolWarehousePanel.vue` | onMounted 调 check_all_tools + provide | ~10 行改动 |
| 5 | `src/components/skills/GitHubSkillCard.vue` | 新增可选 prop `capStatus`，兼容旧路径 | ~10 行改动 |

**不改的文件**：`check_tool_installed` 命令、`scanner.rs`、`CentralSkillsPanel.vue`、`toolStore.ts`、`pluginStore.ts`。

---

## 七、抄袭对照

| 抄自 vscode-project-manager | 对应我们的实现 | 文件 |
|------------------------------|---------------|------|
| `initializeCfg()` 读缓存 → `alreadyLocated` | `read_cache()` → `force=false` 时直接返回 | `tools.rs` |
| `updateCacheFile()` 写缓存 | `write_cache()` | `tools.rs` |
| `RepositoryDetector.isRepoDir()` 策略派发 | `try_detect()` match `type_` | `tools.rs` |
| `Locators` 聚合 → `refreshProjects()` | `check_all_tools` 一次 IPC 全量返回 | `tools.rs` |
| `AutodetectProvider.showTreeView()` 懒加载 | `ToolWarehousePanel.onMounted` 调一次 IPC | `.vue` |

---

## 八、架构预留（Phase 2，本次不做）

当前 `tools_cache.json` 只存 tools。Phase 2 接入 Skill 时升级为 `capabilities_cache.json`：

```json
{
  "tools": { ... },
  "skills": { "JC-duanju-shijiemoxing": { "installed": true, ... } }
}
```

那时再抽 `CapabilityDetector` trait，但**现在不做**——只有一个 impl 的 trait 是过度设计。

---

## 九、风险

| 风险 | 缓解 |
|------|------|
| `brew list`/`npm ls` 慢盘超时 | 每策略 3-5s 独立线程超时，跳过继续下一个策略 |
| `tools_cache.json` 损坏 | 读缓存失败 → 自动走扫描路径重写，用户无感知 |
| `include_str!` 嵌入 JSON 增加二进制大小 | githubTools.json 约 15KB，可忽略 |
| 初始加载时卡片回退到旧 IPC | `scanning` 状态占位，卡片不渲染直到 `check_all_tools` 返回 |
| `command -v` POSIX-only | `#[cfg(windows)]` 用 `where` 替代 |
| `~` 路径展开跨平台 | 用 `std::env::var_os("HOME")` 手动展开，不加新依赖 |

---

## 十、验证计划

```bash
# Rust 编译检查
cargo check --manifest-path src-tauri/Cargo.toml

# TypeScript 检查
pnpm exec vue-tsc -b

# 手动验证
# 1. 打开工具仓库 → 面板秒开（缓存命中）
# 2. 点刷新 → 重新扫描 → 缓存更新
# 3. brew install ffmpeg → 刷新 → 工具仓库显示"已安装"
# 4. 关闭面板重开 → 仍显示"已安装"（缓存命中）
```
