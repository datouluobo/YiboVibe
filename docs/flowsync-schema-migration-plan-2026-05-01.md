# FlowSync Schema Migration Plan

日期：2026-05-01  
状态：迁移草案  
对应文档：

- [flowsync-transfer-integration-plan-2026-05-01.md](./flowsync-transfer-integration-plan-2026-05-01.md)
- [flowsync-content-stream-technical-design-2026-05-01.md](./flowsync-content-stream-technical-design-2026-05-01.md)

## 1. 目标

本稿定义 `FlowSync` 从当前“clipboard history + text/image cache”结构迁移到“统一内容流条目 + 对象 + 传输会话”结构的具体策略。

重点解决：

- 旧数据如何保留
- 新旧 schema 如何并存
- 文本/图片如何无损进入新模型
- 文件/文件夹条目如何在不破坏现有功能的前提下落地

本稿默认遵守两个原则：

1. 先迁移模型，再迁移 UI
2. 迁移期间优先保留旧数据可读，不做破坏式改写

## 2. 当前本地存储现状

根据当前代码，现有本地结构主要是：

```text
{cache_dir}/
├── clipboard.db
├── text/
│   └── {hash}.txt
└── image/
    └── {hash}.png
```

当前 SQLite `history` 表字段：

- `id`
- `timestamp`
- `type` (`text` / `image`)
- `hash`
- `size`
- `preview`
- `pinned`
- `source`
- `created_at`

当前 FTS 表：

- `history_fts`

这个结构的局限很明确：

- 只适合 `text` / `image`
- 没有对象层
- 没有会话层
- 没有 chunk 层
- 没有文件/文件夹条目能力
- 没有内容可用性与状态机字段

## 3. 迁移目标结构

迁移后本地结构建议为：

```text
{app_data}/flowsync/
├── entries.db
├── objects/
│   ├── text/
│   ├── image/
│   ├── file/
│   └── bundle/
├── chunks/
│   └── {object_id}/
├── manifests/
│   └── {object_id}.json
├── staging/
└── temp/
```

迁移后的核心表：

- `flow_entries`
- `flow_objects`
- `flow_chunks`
- `flow_transfers`
- `share_links`

说明：

- `history` 不直接扩表到最终形态，而是迁移到新的 `flow_entries`
- 旧 `clipboard.db` 可以作为迁移来源，不建议长期继续作为主库

## 4. 迁移策略总览

建议采用“三阶段并存迁移”，而不是一步到位替换。

## 4.1 Phase A：引入新库，不删除旧库

目标：

- 新建 `entries.db`
- 新增 `flow_entries`、`flow_objects` 等表
- 旧 `clipboard.db` 保持只读/兼容使用

行为：

- 新功能写新库
- 旧功能仍可读旧库
- 文本/图片新事件同时写新库

## 4.2 Phase B：历史数据回填

目标：

- 把旧 `history` 里的 text/image 条目回填到新库

行为：

- 扫描旧 `history`
- 为每条 text/image 生成对应 `flow_entry + flow_object`
- 不生成 `flow_transfer`
- 不改动原始缓存文件路径，先以引用方式接入

## 4.3 Phase C：切换主读取路径

目标：

- Tauri query / search / detail 全部改为读 `flow_entries`
- UI 层不再直接依赖旧 `history`

行为：

- 老数据已经在新库可见
- 新数据只写新库
- 旧 `history` 仅保留兼容和回退价值

## 4.4 Phase D：收尾与清理

目标：

- 删除旧 `history` 专属写入路径
- 旧 `clipboard.db` 改为迁移备份或废弃

注意：

- 这一步只能在新查询、新入库、新复制回剪贴板路径都稳定后执行

## 5. 字段映射

## 5.1 `history` -> `flow_entries`

旧表到新表的首版映射建议如下：

| old history | new flow_entries | 说明 |
|---|---|---|
| `id` | 不直接复用 | 可保存在扩展字段或 migration map 中 |
| `timestamp` | `created_at` / `updated_at` | 首次迁移可两者同值 |
| `type` | `kind` | `text -> text`, `image -> image` |
| `hash` | `object_id` / `root_hash` | 首版建议 `object_id` 使用新规则生成，不直接复用 hash |
| `size` | `size_bytes` | 直接映射 |
| `preview` | `preview` | 直接映射 |
| `pinned` | `pinned` | 直接映射 |
| `source` | `entry_source` / `direction` / `source_device_name` | 需按规则拆分 |
| `created_at` | 可忽略 | 旧 `timestamp` 更稳定 |

## 5.2 `history.source` 拆分规则

当前 `source` 大致有：

- `local`
- `sync:{deviceName}`

建议映射：

- `local`
  - `entry_source = clipboard_text` 或 `clipboard_image`
  - `direction = local`
  - `source_device_name = current_device_name`

- `sync:{deviceName}`
  - `entry_source = remote_sync`
  - `direction = received`
  - `source_device_name = {deviceName}`

说明：

- 旧数据无法百分百还原远端设备 ID
- 首版迁移允许只保留设备名，不强求补全 `source_device_id`

## 5.3 `history` -> `flow_objects`

对 text/image，建议一条旧 history 生成一条 `flow_object`：

- `kind = text` 或 `image`
- `root_hash = old.hash`
- `chunk_count = 1`
- `checksum_algo = 'blake3'` 或与当前 hash 算法一致
- `local_storage_path` 指向旧 `text/{hash}.txt` 或 `image/{hash}.png`
- `manifest_json = NULL` 或最小 JSON

## 5.4 `flow_transfers` 初始策略

迁移旧 text/image 历史时：

- 不创建 `flow_transfers`
- `transfer_status` 直接置为 `completed`

原因：

- 旧 history 记录的是“内容已经存在于本地”的事实
- 它不是活跃传输会话

## 6. object_id 生成规则

不建议直接把旧 `hash` 当成 `object_id`，建议统一引入独立对象 ID。

推荐规则：

- 新对象：`UUIDv7` 或等价全局唯一 ID
- 迁移对象：首次迁移时也生成新 `object_id`

同时保留：

- `root_hash` = 原内容哈希

原因：

- 后续 file/bundle 与 chunk 体系都需要与“内容校验值”解耦
- `object_id` 应代表对象身份，不只代表内容摘要

## 7. 目录迁移策略

## 7.1 text/image 首阶段不搬文件

为了降低风险，首阶段迁移建议：

- 不立即把旧 `text/` 和 `image/` 文件物理搬迁到新目录
- 先在 `flow_objects.local_storage_path` 中记录旧路径

好处：

- 迁移快
- 风险低
- 可快速回退

后续再做物理搬迁任务：

- `text/{hash}.txt` -> `objects/text/{object_id}.txt`
- `image/{hash}.png` -> `objects/image/{object_id}.png`

## 7.2 file/bundle 从新目录开始

文件与文件夹条目从第一版开始就应写入新目录结构：

- `objects/file/`
- `objects/bundle/`
- `chunks/`
- `manifests/`

不要为 file/bundle 引入“旧目录兼容层”。

## 8. 数据库初始化策略

建议新建独立初始化器，而不是继续在 `HistoryManager::init_tables` 上叠加。

推荐新增：

- `FlowStoreManager`
- `FlowMigrationManager`

职责分离：

- `HistoryManager`
  - 旧 history 兼容读取

- `FlowStoreManager`
  - 新 schema 初始化
  - 新条目读写

- `FlowMigrationManager`
  - 检测迁移状态
  - 执行旧数据回填
  - 记录迁移版本

## 8.1 迁移版本表

建议新增：

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version       INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    applied_at    INTEGER NOT NULL
);
```

建议版本：

- `1`：初始化 `flow_entries` / `flow_objects` / `flow_chunks` / `flow_transfers`
- `2`：回填旧 history text/image
- `3`：新增 `share_links`

## 9. 回填算法

## 9.1 旧 history 扫描

回填时按 `history.timestamp ASC` 或 `id ASC` 扫描旧数据。

每条记录执行：

1. 读取旧 `type/hash/size/preview/pinned/source/timestamp`
2. 生成新 `object_id`
3. 构造 `flow_object`
4. 构造 `flow_entry`
5. 判断本地文件是否存在
6. 若存在则 `has_local_content = 1`
7. 写新库

## 9.2 幂等要求

回填任务必须幂等。

建议方式：

- 在 `flow_entries` 中增加可选字段 `legacy_history_id`
- 或在独立映射表中记录：

```sql
CREATE TABLE IF NOT EXISTS legacy_history_map (
    legacy_id    INTEGER PRIMARY KEY,
    object_id    TEXT NOT NULL UNIQUE
);
```

这样回填重复执行时不会重复生成对象。

## 10. 查询兼容策略

迁移期间，建议分三步切换查询：

## 10.1 Step 1

旧 UI 仍读 `history`

新功能：

- 文件/文件夹条目只读新库

不推荐停留太久，因为 UI 会割裂。

## 10.2 Step 2

新增统一 query path：

- 查询 `flow_entries`
- 若需要兼容旧数据，先跑 migration 再查询

这是建议尽快进入的状态。

## 10.3 Step 3

所有 `FlowSync` 活动流统一只读 `flow_entries`。

## 11. 搜索迁移

现有搜索基于 `history_fts`。

迁移建议：

- 为 `flow_entries` 新建 `flow_entries_fts`
- 首版只索引：
  - `title`
  - `preview`
  - `source_device_name`

建议 schema：

```sql
CREATE VIRTUAL TABLE flow_entries_fts USING fts5(
    title,
    preview,
    source_device_name,
    content='flow_entries',
    content_rowid='id'
);
```

同时建立 insert/update/delete trigger。

## 12. pinned 与清理迁移

旧 `pinned` 可以直接迁移。

但清理逻辑必须升级：

旧逻辑：

- 只按 text/image 文件大小与 LRU 清理

新逻辑：

- 先只清理 `has_local_content = 1` 的对象
- 不删除仅有条目无本地内容的记录
- `bundle` 清理必须按整个对象删除，不可只删部分文件
- NAS 暂存清理和本地清理分开

## 13. 文件/文件夹首版写入路径

在 Phase B 之后，新增 file/bundle 条目建议直接写：

- `flow_entries`
- `flow_objects`
- `flow_chunks`（如需要）

而不是先写旧 `history` 再转写。

也就是：

- `history` 是迁移来源
- 不是新 file/bundle 的过渡落点

## 14. 失败回退策略

迁移失败时应保证：

1. 旧 `clipboard.db` 与旧文件不被破坏
2. 新 `entries.db` 可删除后重建
3. 回填任务可重复执行

建议回退方式：

- 停止读取新库
- 保持旧 `history` 查询能力
- 删除损坏的新库
- 修复迁移逻辑后重新回填

## 15. 推荐实施顺序

建议具体实施顺序如下：

1. 新增 `FlowStoreManager` 与 `entries.db`
2. 初始化新 schema
3. 新增 `legacy_history_map`
4. 实现旧 history -> 新 entries/object 回填
5. 文本/图片新事件双写新库
6. 新查询命令改读 `flow_entries`
7. 新增 file/bundle 条目写入
8. 再考虑旧 `history` 写入路径下线

## 16. 需要改动的代码区域

高概率涉及：

- `core/src/history.rs`
  - 保留旧 manager，但不再承担未来主模型

- `core/src/cache.rs`
  - 升级目录结构
  - 兼容旧 text/image 读取

- `core/src/lib.rs`
  - 注册新模块

- `desktop/src-tauri/src/lib.rs`
  - 初始化新 store
  - 迁移旧 query/search/detail commands

建议新增：

- `core/src/flow_store.rs`
- `core/src/flow_migration.rs`
- `core/src/content_stream.rs`

## 17. 下一步建议

这份迁移稿之后，最合理的下一步有两个方向：

1. 写 `flowsync-api-contract-draft-2026-05-01.md`
   - 把 HTTP/WS 字段细化到请求/响应级别

2. 直接开始第一批实现
   - `entries.db`
   - `flow_entries` / `flow_objects`
   - 旧 history 回填

如果直接进代码，我建议先做：

- `FlowStoreManager`
- `schema_migrations`
- `legacy_history_map`
- text/image 迁移回填

因为这一步做完后，后面的 file/bundle 才有稳定落点。
