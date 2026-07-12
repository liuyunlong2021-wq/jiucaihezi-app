# SDD: 媒体产出直落项目文件夹

> **状态**: 方案评审 | **日期**: 2026-07-02 | **分支**: 0702-xiufu-3
>
> **审计结论 (2026-07-02)**: 方案可行，但需克服 Tauri fs 插件 scope 限制（详见 §7）。Web 端构建完全不受影响。

---

## 1. 动机

### 当前问题

1. 媒体产出藏在 `~/.jiucaihezi/output/creation/YYYY-MM/`，用户找不到文件
2. 需要 `media_assets` SQLite 表做索引层，今天出 `no such column: data` 的 bug 根源在此
3. 两套画廊（旧结果区 + 媒体资产库）重复且用户困惑
4. 备份、分享、在 Finder 里看生成结果都很困难

### 目标

- **桌面端**：创作面板生成的图片/视频/音频/文本，直接写入用户选的项目文件夹
- **Web 端**：行为不变（浏览器下载，不涉及文件系统）
- 用户在自己的项目文件夹里就能看到、管理、分享所有产出
- 消灭 `media_assets` 表的读取依赖（减少一类 bug）

---

## 2. 设计

### 2.1 文件夹结构

```
用户项目文件夹/
├── your-project-files...     ← 用户自己的文件
├── ...
└── jc-media/                 ← 韭菜盒子自动创建
    ├── images/
    │   ├── 2026-07-02_143021_高端陶瓷茶壶.png
    │   └── 2026-07-02_150512_赛博朋克机甲.png
    ├── videos/
    │   └── 2026-07-02_160000_猫跳舞.mp4
    ├── audio/
    │   └── 2026-07-02_170000_自定义歌曲.mp3
    └── text/
        └── 2026-07-02_180000_生成歌词.txt
```

**文件命名规则**：`{YYYY-MM-DD}_{HHmmss}_{提示词前30字（清理特殊字符）}_{随机3位}.{ext}`

- 特殊字符替换：中英文标点 → `_`，空格 → `_`，连续下划线 → 单个
- 随机后缀防同名冲突（同一秒生成两张同 prompt 图）

### 2.2 桌面端 vs Web 端边界

| | 桌面端 | Web 端 |
|---|---|---|
| 媒体保存位置 | `{projectDir}/jc-media/` | 不变（浏览器下载/blobs） |
| 画廊数据源 | 文件系统（Tauri `dev_list_files`） | 不变（内存 cpState.results） |
| 预览 | `convertFileSrc(filePath)` → asset protocol | 不变（CDN URL / data URL） |
| 下载 | 已在项目文件夹，按钮改为"在 Finder 中显示" | 不变（fetch → blob → a.download） |

**Web 端代码零改动**。所有变更用 `isTauriRuntime()` 守卫。

### 2.3 无项目文件夹时的兜底

如果用户没选项目文件夹（`projectStore.projectDir` 为空），桌面端回退到当前行为：
```
~/.jiucaihezi/output/creation/YYYY-MM/
```

---

## 3. 改动清单

### 3.1 新增文件

| 文件 | 作用 | 行数 |
|------|------|------|
| `src/utils/projectMediaWriter.ts` | 桌面端写媒体到 `{projectDir}/jc-media/{type}/` | ~50 |

### 3.2 修改文件

| 文件 | 改动 | 行数 |
|------|------|------|
| **`src-tauri/src/lib.rs`** | **新增 `dev_write_file_bytes` 命令（base64→二进制→项目文件夹）** | **~25** |
| `src/stores/mediaTaskStore.ts` | `downloadAndPersistMediaAsset` 桌面端走 `projectMediaWriter` | ~15 |
| `src/components/creation/CreationPanel.vue` | 手动下载桌面端走 `projectMediaWriter`；移除 `media_assets` 表读取 | ~20 |
| `src/utils/creationMediaCache.ts` | 桌面端缓存走 `projectMediaWriter` | ~10 |
| `src/utils/mediaFileWriter.ts` | 不变（Web/无项目兜底） | 0 |
| `src/components/filetree/ProjectFileTree.vue` | 底部加 `jc-media/` 快捷入口 | ~30 |

总计 ~150 行（含 Rust）。

### 3.3 Rust 新命令：`dev_write_file_bytes`

```rust
#[derive(Deserialize)]
struct DevWriteFileBytesInput {
    root: String,
    relative_path: String,
    data_base64: String,  // base64 编码的二进制数据
}

#[tauri::command]
fn dev_write_file_bytes(input: DevWriteFileBytesInput) -> Result<DevWriteFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_write_path(&root, &input.relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let bytes = general_purpose::STANDARD
        .decode(&input.data_base64)
        .map_err(|e| format!("base64 解码失败: {}", e))?;
    std::fs::write(&path, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(DevWriteFileOutput {
        path: display_relative(&root, &path),
        bytes_written: bytes.len(),
    })
}
```

**关键**：走 `canonical_root()` 通道，**不受 Tauri fs 插件 scope 限制**。项目文件夹在任意路径都能写入。

### 3.4 `projectMediaWriter.ts` 伪代码

```typescript
export async function writeProjectMedia(opts: {
  dataBase64: string   // 不含 data: 前缀的纯 base64
  mime: string
  projectDir: string
  kind: 'image' | 'video' | 'audio' | 'text'
  prompt?: string
}): Promise<{ filePath: string }> {
  // 1. 生成安全文件名
  const ext = mimeToExt(opts.mime)
  const promptPart = sanitizeFilename(opts.prompt?.slice(0, 30) || '')
  const rand = Math.random().toString(36).slice(2, 5)
  const now = new Date()
  const ts = `${formatDate(now)}_${formatTime(now)}`
  const filename = `${ts}_${promptPart}_${rand}${ext}`

  // 2. 写文件（走 dev_write_file_bytes，绕过 fs scope）
  const relativePath = `jc-media/${opts.kind}s/${filename}`
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('dev_write_file_bytes', {
    root: opts.projectDir,
    relativePath,
    dataBase64: opts.dataBase64,
  })

  // 3. 返回文件系统绝对路径（用于 convertFileSrc 显示）
  const { join } = await import('@tauri-apps/api/path')
  const filePath = await join(opts.projectDir, relativePath)
  return { filePath }
}
```

### 3.5 ProjectFileTree 增强

在文件树底部加一个固定条目：

```
📁 项目文件
  ├── src/
  ├── ...
📁 jc-media（创作产出）  ← 新增
  ├── 🖼 images/
  ├── 🎬 videos/
  ├── 🎵 audio/
  └── 📄 text/
```

- 点击 `jc-media` 展开子文件夹
- 文件夹不存在时显示灰色提示"生成内容后将出现在这里"
- 文件树本身每 5 秒自动刷新，新文件自然出现

### 3.6 画廊数据源切换

当前创作面板的媒体资产库数据来自：
```
combinedMediaLibraryAssets = 去重(
  creationResultMediaAssets  ← cpState.results 内存
  + creationTaskMediaAssets  ← mediaTaskStore.tasks 内存
  + mediaLibraryAssets        ← media_assets SQLite 表 / documents IndexedDB
)
```

改为桌面端：
```
combinedMediaLibraryAssets = 去重(
  creationResultMediaAssets  ← cpState.results（不变）
  + creationTaskMediaAssets  ← mediaTaskStore.tasks（不变）
  + projectMediaAssets        ← jc-media/ 文件列表（Tauri dev_list_files）
)
```

Web 端：`projectMediaAssets` 始终为空数组，等于没变。

---

## 4. 迁移策略

### 不迁移

已有 `~/.jiucaihezi/output/creation/` 里的旧文件**不动**。用户下次生成新内容时自动走新路径。

### 向后兼容

- `media_assets` 表**不删**（保留历史数据可查）
- `writeMediaAsset` 函数**不动**（Web 端和无项目时仍需）
- 旧画廊数据仍然能从 `cpState.results` 展示

---

## 5. 影响评估

| 项目 | 影响 |
|------|------|
| 现有用户 | 零影响，新生成的内容才会进项目文件夹 |
| Web 端 | 零影响，代码路径完全隔离 |
| Web 构建 | ✅ `vite build` 不依赖 Rust 代码 |
| 代码复杂度 | **降低** — 消灭 `media_assets` 表读取 |
| 文件数量 | +1 TS 文件，+1 Rust 命令，~150 行 |
| 权限 | 不需要改 Tauri capabilities（走 dev_* 通道） |

---

## 6. 不做的

- ❌ 不迁移已有 `~/.jiucaihezi/output/` 的旧文件
- ❌ 不改 Web 端任何行为
- ❌ 不改创作面板 UI 布局
- ❌ 不删 `media_assets` 表（只不再读它）
- ❌ 不做缩略图缓存（先用原图，ProjectFileTree 也不显示缩略图）

---

## 7. 关键技术风险与对策

### 7.1 Tauri fs 插件 scope 限制

**风险**：`src-tauri/capabilities/default.json` 的 fs scope 只允许 `$APPDATA/**`、`$DOWNLOAD/**`、`$HOME/.jiucaihezi/**` 等固定路径。用户项目文件夹可能在任意位置。

**对策**：不走 fs 插件，走 `dev_*` Rust 命令通道。`dev_list_files`、`dev_write_file` 等使用 `canonical_root()` 接受任意路径。新增 `dev_write_file_bytes` 同理。

### 7.2 二进制文件写入

**风险**：现有 `dev_write_file` 只接受 String，`.as_bytes()` 可能损坏二进制数据。

**对策**：新增 `dev_write_file_bytes`，接收 base64 编码的二进制数据，Rust 端 `general_purpose::STANDARD.decode()` 后 `std::fs::write(&path, &bytes)`。

### 7.3 文件名冲突

**风险**：同一秒生成两张同 prompt 图片，文件名完全相同。

**对策**：文件名末尾加 3 位随机后缀（`Math.random().toString(36).slice(2, 5)`），冲突概率 ~1/46656。

### 7.4 特殊字符文件名

**风险**：中文标点、emoji、换行符等可能导致文件名非法。

**对策**：`sanitizeFilename()` 替换所有非安全字符为 `_`，连续下划线合并为单个。

### 7.5 文件已存在于项目文件夹时

**风险**：用户可能手动删除或移动 jc-media 里的文件，画廊引用失效。

**对策**：画廊展示前先 `dev_list_files`，只显示实际存在的文件。不存在的自动跳过（不报错）。
