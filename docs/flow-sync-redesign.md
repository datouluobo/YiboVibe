# FlowSync 烽火改造方案

> 版本：v1.0 | 日期：2026-04-26

## 一、定位

将 FlowSync 从"剪贴板同步日志"改造为**本地剪贴板历史工具**，自动记录所有复制的文本/图片，同时保留多端 E2EE 同步能力。

## 二、核心设计原则

| 原则 | 说明 |
|------|------|
| 各端历史独立 | 每台设备只记录"自己看到的剪贴板变化"，多端历史自然重叠但不完全相同 |
| 同步逻辑不变 | E2EE + WS + Hub 管道完全保留，仅在 ClipboardMonitor 回调中增加本地缓存步骤 |
| 服务端零改动 | 不增加服务端存储或逻辑，历史拉取通过在线设备 P2P 实现 |
| 完整文件存储 | 文本/图片原文件保存在本地磁盘，从历史复制回剪贴板无损失 |

## 三、数据流

```
ClipboardMonitor → 检测剪贴板变化 → 同时做两件事:
  ├→ ① 写入本地缓存目录 (text/{hash}.txt 或 image/{hash}.png)
  │      + 写 SQLite 元数据 (history 表)
  │      + 发 UI 事件通知前端刷新列表
  │
  └→ ② 原有 E2EE 加密 → WS 广播 → 对端写入系统剪贴板
           ↓
      对端 ClipboardMonitor 检测到变化 → 对端也记录到自己的本地历史
```

## 四、存储结构

```
{cache_dir}/
├── clipboard.db              # SQLite 元数据库
├── text/
│   └── {blake3_hash}.txt     # 文本原文件
└── image/
    └── {blake3_hash}.png     # 图片原文件
```

### SQLite Schema

```sql
CREATE TABLE history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('text', 'image')),
    hash        TEXT NOT NULL UNIQUE,
    size        INTEGER NOT NULL,
    preview     TEXT,
    pinned      INTEGER DEFAULT 0,
    source      TEXT DEFAULT 'local',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE history_fts USING fts5(
    content,
    content='history',
    content_rowid='id'
);

CREATE INDEX idx_history_time ON history(timestamp DESC);
CREATE INDEX idx_history_type ON history(type, timestamp DESC);
```

## 五、功能清单

### 5.1 核心功能

| 功能 | 说明 |
|------|------|
| 自动记录 | 剪贴板变化时自动保存文本/图片到本地缓存 |
| 去重 | blake3 哈希去重，相同内容只保留一份文件，重复时更新 timestamp 置顶 |
| 复制回剪贴板 | 从缓存文件直接读取原始字节写入系统剪贴板，该条目置顶 |
| 文本搜索 | SQLite FTS5 全文搜索 |
| 时间过滤 | 今天/昨天/本周/本月/全部 |
| 类型过滤 | 文本/图片/全部 |
| 单条删除 | 删除元数据 + 缓存文件 |
| 批量清理 | 按天数清理 / 全部清理（跳过 pinned） |

### 5.2 缓存管理

| 配置项 | 默认值 | 说明 |
|-------|--------|------|
| 缓存目录 | `{data_dir}/yiboflow/cache` | 可自定义路径，支持迁移 |
| 空间上限 | 200 MB | 超出时按 LRU 淘汰未 pinned 条目 |
| 自动清理天数 | 7 天 | 0 = 不自动清理 |
| 收藏保护 | pinned 条目不被自动清理 | 手动收藏/取消收藏 |

### 5.3 多端同步

| 功能 | 说明 |
|------|------|
| 实时同步 | 保留现有 E2EE + WS 同步，对端收到后写入系统剪贴板 → 对端自动记录 |
| 在线拉取 | "拉取今天历史"按钮，通过 WS 请求在线设备，P2P 传输 |
| 拉取合并 | hash 去重 + `INSERT OR IGNORE`，保留远端原始时间戳 |

### 5.4 在线拉取协议

```json
// 请求方 → 在线设备
{ "type": "history_request", "payload": { "date": "2026-04-26" } }

// 在线设备 → 请求方（可分多条）
{
  "type": "history_response",
  "payload": {
    "items": [
      { "timestamp": 1714000000000, "type": "text", "hash": "abc", "data": "..." },
      { "timestamp": 1714000001000, "type": "image", "hash": "def", "blob_uuid": "..." }
    ],
    "has_more": false
  }
}
```

## 六、改动范围

### 新增文件

| 文件 | 职责 |
|------|------|
| `core/src/cache.rs` | 缓存目录管理、文件读写、大小统计、LRU 淘汰、目录迁移 |
| `core/src/history.rs` | SQLite 元数据 CRUD、FTS5 搜索、去重、容量控制 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `core/src/clipboard.rs` | `on_clipboard_change` 中增加写入缓存步骤 |
| `core/src/config.rs` | 增加 `cache_dir`、`cache_max_size_mb` 配置项 |
| `core/src/lib.rs` | 声明新模块 `cache`, `history` |
| `core/Cargo.toml` | 增加 `rusqlite`（bundled）、`blake3` 依赖 |
| `desktop/src-tauri/src/lib.rs` | 新增 Tauri 命令：查询/搜索/删除/复制回/缓存配置 |
| `desktop/src/pages/FlowSync.tsx` | 重写：localStorage → invoke() 查询，加搜索栏 |
| `desktop/src/pages/Settings.tsx` | 缓存目录选择器、大小上限配置 |
| `desktop/src/locales/` | 新增/更新 i18n key |

### 不动文件

- `server/` 整个目录
- `core/src/ws.rs`、`core/src/crypto.rs`、`core/src/hook_manager.rs`
- Hub/presence 广播逻辑

## 七、Tauri 命令清单

```rust
#[tauri::command] fn query_history(filter: HistoryFilter) -> Result<Vec<HistoryEntry>, String>
#[tauri::command] fn search_history(query: String, limit: u32) -> Result<Vec<HistoryEntry>, String>
#[tauri::command] fn copy_history_to_clipboard(id: i64) -> Result<(), String>
#[tauri::command] fn delete_history(ids: Vec<i64>) -> Result<(), String>
#[tauri::command] fn clear_history(before_days: u32) -> Result<u32, String>       // 返回删除条数
#[tauri::command] fn toggle_pin(id: i64) -> Result<(), String>
#[tauri::command] fn get_cache_stats() -> Result<CacheStats, String>              // 大小/条数
#[tauri::command] fn set_cache_dir(path: String) -> Result<(), String>            // 迁移
#[tauri::command] fn set_cache_max_size(mb: u64) -> Result<(), String>
#[tauri::command] fn pull_today_history() -> Result<u32, String>                  // 在线拉取
```

## 八、实施计划

| 阶段 | 内容 | 预计 |
|------|------|------|
| P1 | `cache.rs` + `history.rs` 存储层 | 3-4 天 |
| P2 | `clipboard.rs` 改造 | 0.5 天 |
| P3 | Tauri 命令层 | 1-2 天 |
| P4 | `FlowSync.tsx` 重写 | 2-3 天 |
| P5 | Settings 缓存配置 | 0.5 天 |
| P6 | 在线拉取功能 | 1-2 天 |
| P7 | 测试 | 1-2 天 |
