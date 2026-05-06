# FlowSync 内容流技术设计草案

日期：2026-05-01  
状态：技术草案  
对应方案：[flowsync-transfer-integration-plan-2026-05-01.md](./flowsync-transfer-integration-plan-2026-05-01.md)

## 1. 文档目标

本稿用于把已确认的 `FlowSync` 传输整合方案落到可实现层，重点定义：

- 模块拆分
- 数据模型
- 状态机与状态流转
- 客户端、服务端、NAS 的职责边界
- 首阶段接口草案
- `FlowDrop` 删除与迁移清单

本稿不解决：

- 具体 UI 视觉细节
- 最终 API 命名定稿
- 最终数据库迁移脚本
- 最终加密算法细节调优

## 2. 当前代码现状与约束

基于当前仓库，可确认的现状有：

- 文本/图片同步主体集中在 `core/src/clipboard.rs`
- 本地历史与缓存集中在 `core/src/cache.rs`、相关 history 模块与 Tauri commands
- 远端同步与密文文件上传已有 `vault` 与 `blob` 路径
- 服务端已有：
  - `/api/v1/sync/ws`
  - `/api/v1/sync/blob`
  - `/api/v1/sync/online`
  - `/api/v1/vault/:filename`
- 旧 `FlowDrop` 占位实现仍存在：
  - `core/src/p2p.rs`
  - `desktop/src/pages/FlowDrop.tsx`
  - `send_file_p2p`
  - `p2p_file_offer`

这意味着新设计应遵守两个约束：

1. 不要把新能力继续堆进旧 `FlowDrop` 路径
2. 不要把现有 `clipboard` 监听逻辑直接演化成“万能文件传输核心”

## 3. 推荐模块边界

建议将实现拆成以下模块。

## 3.1 Rust Core

### `clipboard_sync`

职责：

- 监听系统剪贴板
- 识别文本、图片、文件、文件夹对象
- 根据用户配置决定是否自动同步文本/图片
- 对文件/文件夹只创建条目，不直接自动推送内容

建议来源：

- 从 `core/src/clipboard.rs` 中保留剪贴板监听能力
- 把“内容对象识别”和“条目创建”抽离出去

### `content_stream`

职责：

- `FlowObject` 与条目模型
- 内容对象生命周期
- 会话状态机
- 内容来源选择
- chunk 规划
- 校验与恢复
- NAS 暂存元信息

建议为全新模块，不复用旧 `p2p.rs` 结构。

### `history_store`

职责：

- 统一活动流条目查询
- 文本/图片/文件/文件夹条目统一入库
- pinned、筛选、分页、搜索

说明：

- 现有 clipboard history 可以作为迁移基础
- 但 schema 必须升级，不再只适合 text/image

### `content_crypto`

职责：

- 生成 `object_key`
- 内容加密/解密
- chunk 校验
- 文件级校验
- NAS 外链下载时的受控解封装流程支持

## 3.2 Tauri Commands

建议将桌面命令从“剪贴板命令 + 零散 FlowDrop 命令”调整为：

- `flowsync_query_entries`
- `flowsync_get_entry_detail`
- `flowsync_create_entry_from_clipboard`
- `flowsync_create_entry_from_paths`
- `flowsync_download_entry`
- `flowsync_push_entry_to_device`
- `flowsync_stage_entry_to_nas`
- `flowsync_create_share_link`
- `flowsync_delete_local_copy`
- `flowsync_set_auto_sync`
- `flowsync_get_transfer_status`

## 3.3 Server

建议新增一个逻辑层，例如：

- `server/internal/contentstream/`

职责：

- 条目元数据同步
- 领取授权
- 在线设备目标协商
- NAS 暂存策略
- 外链令牌
- 管理员控制项

服务端仍不处理：

- 明文文件内容
- 明文业务语义

## 3.4 NAS 暂存层

NAS 层职责应保持最小：

- 保存密文对象
- 保存最小必要索引信息
- 提供受控下载入口
- 支持 TTL / GC

NAS 不应承载：

- 复杂业务状态机
- 明文目录树理解
- 多租户业务逻辑推断

## 4. 数据模型草案

## 4.1 条目表 `flow_entries`

建议替代或扩展现有 history 表。

```sql
CREATE TABLE flow_entries (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id          TEXT NOT NULL UNIQUE,
    owner_uid          INTEGER,
    source_device_id   TEXT,
    source_device_name TEXT,
    kind               TEXT NOT NULL CHECK(kind IN ('text', 'image', 'file', 'bundle')),
    title              TEXT,
    preview            TEXT,
    mime               TEXT,
    size_bytes         INTEGER NOT NULL DEFAULT 0,
    item_count         INTEGER NOT NULL DEFAULT 1,
    root_hash          TEXT NOT NULL,
    entry_source       TEXT NOT NULL CHECK(entry_source IN ('clipboard_text', 'clipboard_image', 'clipboard_file', 'clipboard_folder', 'manual_pick', 'drag_drop', 'remote_sync')),
    direction          TEXT NOT NULL CHECK(direction IN ('local', 'sent', 'received')),
    delivery_mode      TEXT NOT NULL CHECK(delivery_mode IN ('auto_sync', 'on_demand', 'push_to_device', 'nas_staged')),
    availability       TEXT NOT NULL CHECK(availability IN ('local_only', 'remote_device', 'nas_staged', 'expired')),
    transfer_status    TEXT NOT NULL CHECK(transfer_status IN ('created', 'offered', 'accepted', 'transferring', 'paused', 'verifying', 'completed', 'failed', 'expired')),
    auto_deliver       INTEGER NOT NULL DEFAULT 0,
    pinned             INTEGER NOT NULL DEFAULT 0,
    has_local_content  INTEGER NOT NULL DEFAULT 0,
    expires_at         INTEGER,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
);

CREATE INDEX idx_flow_entries_created_at ON flow_entries(created_at DESC);
CREATE INDEX idx_flow_entries_kind ON flow_entries(kind, created_at DESC);
CREATE INDEX idx_flow_entries_status ON flow_entries.transfer_status, created_at DESC;
CREATE INDEX idx_flow_entries_availability ON flow_entries(availability, created_at DESC);
```

说明：

- `direction` 保留当前 `FlowSync` 用户心智
- `auto_deliver` 用于文本/图片自动同步策略
- `has_local_content` 用于区分“条目在本地可见”和“内容已在本地”

## 4.2 对象表 `flow_objects`

```sql
CREATE TABLE flow_objects (
    object_id            TEXT PRIMARY KEY,
    kind                 TEXT NOT NULL CHECK(kind IN ('text', 'image', 'file', 'bundle')),
    object_key_wrap      BLOB NOT NULL,
    root_hash            TEXT NOT NULL,
    chunk_count          INTEGER NOT NULL DEFAULT 0,
    manifest_json        TEXT,
    local_storage_path   TEXT,
    local_manifest_path  TEXT,
    nas_object_prefix    TEXT,
    encryption_version   INTEGER NOT NULL DEFAULT 1,
    checksum_algo        TEXT NOT NULL DEFAULT 'blake3',
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL
);
```

说明：

- `manifest_json` 用于 text/image/file 的轻量对象或 bundle 引导信息
- 文件夹对象的完整目录树建议另存 manifest 文件，不只塞入 DB

## 4.3 chunk 表 `flow_chunks`

```sql
CREATE TABLE flow_chunks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id        TEXT NOT NULL,
    chunk_index      INTEGER NOT NULL,
    chunk_hash       TEXT NOT NULL,
    cipher_size      INTEGER NOT NULL,
    plain_size       INTEGER NOT NULL,
    local_path       TEXT,
    nas_key          TEXT,
    is_present_local INTEGER NOT NULL DEFAULT 0,
    is_present_nas   INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL,
    UNIQUE(object_id, chunk_index)
);
```

用途：

- 续传
- 缺块恢复
- 切换来源

## 4.4 传输会话表 `flow_transfers`

```sql
CREATE TABLE flow_transfers (
    transfer_id         TEXT PRIMARY KEY,
    object_id           TEXT NOT NULL,
    target_device_id    TEXT,
    source_kind         TEXT NOT NULL CHECK(source_kind IN ('device', 'nas')),
    source_ref          TEXT NOT NULL,
    status              TEXT NOT NULL CHECK(status IN ('created', 'offered', 'accepted', 'transferring', 'paused', 'verifying', 'completed', 'failed', 'expired')),
    bytes_total         INTEGER NOT NULL DEFAULT 0,
    bytes_done          INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    started_at          INTEGER,
    finished_at         INTEGER,
    created_at          INTEGER NOT NULL
);
```

## 4.5 外链表 `share_links`

建议只服务 NAS 暂存外链。

```sql
CREATE TABLE share_links (
    share_id            TEXT PRIMARY KEY,
    object_id           TEXT NOT NULL,
    owner_uid           INTEGER NOT NULL,
    token_hash          TEXT NOT NULL UNIQUE,
    max_downloads       INTEGER,
    used_downloads      INTEGER NOT NULL DEFAULT 0,
    expires_at          INTEGER NOT NULL,
    status              TEXT NOT NULL CHECK(status IN ('active', 'expired', 'disabled')),
    created_at          INTEGER NOT NULL
);
```

## 5. 对象模型草案

## 5.1 `text`

- 轻对象
- 默认 `auto_deliver = 1`
- 内容可直接作为单对象密文保存

## 5.2 `image`

- 轻对象
- 默认 `auto_deliver = 1`
- 建议统一使用图片原始格式或标准转码格式
- 不再继续沿用只面向剪贴板预览的思路来设计长期存储

## 5.3 `file`

- 单文件对象
- 必须有文件级 root hash
- 使用 chunk 切分

## 5.4 `bundle`

- 文件夹对象
- 一个条目对应一个完整目录树
- 使用 bundle manifest 描述：
  - 目录结构
  - 相对路径
  - 文件大小
  - 文件 hash
  - chunk 映射

领取规则：

- 必须整体领取
- 不支持局部领取

## 6. 状态机设计

## 6.1 状态定义

- `created`
- `offered`
- `accepted`
- `transferring`
- `paused`
- `verifying`
- `completed`
- `failed`
- `expired`

## 6.2 状态流转

```text
created -> offered
offered -> accepted
offered -> expired
accepted -> transferring
transferring -> paused
transferring -> verifying
transferring -> failed
paused -> transferring
paused -> failed
verifying -> completed
verifying -> failed
failed -> offered
failed -> transferring
completed -> expired
```

## 6.3 关键约束

- 未通过校验不得进入 `completed`
- `expired` 为终态
- `failed` 不是终态，允许重试
- `paused` 可以由用户操作或网络恢复流程触发

## 6.4 状态与 UI 的关系

建议页面只呈现有限状态文案，不直接暴露全部底层技术态：

- 待领取
- 已接受
- 传输中
- 已暂停
- 校验中
- 已完成
- 失败
- 已过期

## 7. 自动同步开关

建议新增 `flowsync_prefs` 或配置项：

```json
{
  "auto_sync_text": true,
  "auto_sync_image": true,
  "receive_only_mode": false,
  "auto_stage_large_objects": false,
  "default_stage_ttl_hours": 24
}
```

规则：

- `auto_sync_text = true` 时，文本复制后自动创建条目并自动同步内容
- `auto_sync_image = true` 时，图片复制后自动创建条目并自动同步内容
- 文件/文件夹不受这两个开关控制，只自动同步条目

## 8. 客户端流程细化

## 8.1 剪贴板触发

### 文本

1. 监听到文本变更
2. 计算 hash
3. 创建 `text` 对象与条目
4. 写本地历史
5. 若 `auto_sync_text = true`，推送内容到在线设备

### 图片

1. 监听到图片变更
2. 标准化编码
3. 创建 `image` 对象与条目
4. 写本地历史
5. 若 `auto_sync_image = true`，推送内容到在线设备

### 文件/文件夹

1. 监听到系统剪贴板中的文件对象列表
2. 识别是单文件还是单文件夹
3. 创建 `file` 或 `bundle` 条目
4. 不自动下发内容
5. 仅同步条目元数据到在线设备

说明：

- 若系统一次复制多个独立文件，建议首版先不支持，或提示用户先放入文件夹再处理
- 首版优先支持：
  - 单文件
  - 单文件夹

## 8.2 手动新建条目

入口：

- `FlowSync` 页面按钮 `新建条目`

行为：

- 选择文件 -> 创建 `file`
- 选择文件夹 -> 创建 `bundle`

这个入口应复用与剪贴板入口相同的对象创建与入库逻辑。

## 8.3 下载到本机

来源优先级建议：

1. 本地已存在
2. 在线源设备
3. NAS 暂存

下载流程：

1. 确认本地是否已有完整内容
2. 无则创建 transfer session
3. 尝试从在线源设备拉取
4. 不可用时回退到 NAS
5. 完成 chunk 校验
6. 完成 root hash 校验
7. 写入目标路径
8. 更新条目状态

## 8.4 推送到在线设备

需要服务端协助做：

- 目标设备在线检查
- 目标设备接受消息
- 目标设备授权确认

建议消息流：

- `flow_entry_offer`
- `flow_entry_accept`
- `flow_transfer_progress`
- `flow_transfer_complete`
- `flow_transfer_failed`

## 8.5 NAS 暂存

客户端负责：

- 本地切 chunk
- 加密
- 上传密文 chunk
- 上传对象 manifest

服务端负责：

- 授权
- 记录对象暂存索引
- TTL 策略
- 清理调度

## 8.6 NAS 外链

仅支持：

- 已完成 NAS 暂存的对象

流程：

1. 用户请求生成外链
2. 服务端检查用户权限与管理员策略
3. 创建 `share_links`
4. 返回一次性或受限分享 URL
5. 外部用户通过浏览器下载

安全要求：

- token 必须高熵
- 服务端仅允许命中单个对象
- 默认短 TTL
- 支持下载次数上限
- 管理员可全局关闭

## 9. 服务端接口草案

以下为建议草案，不要求与最终命名完全一致。

## 9.1 条目元数据

- `POST /api/v1/flowsync/entries`
  - 创建或上报条目元数据

- `GET /api/v1/flowsync/entries`
  - 拉取条目列表

- `GET /api/v1/flowsync/entries/:objectId`
  - 拉取条目详情

## 9.2 设备投递会话

- `POST /api/v1/flowsync/transfers/device-offer`
  - 向目标设备发起投递

- `POST /api/v1/flowsync/transfers/:transferId/accept`
  - 目标设备接受

- `POST /api/v1/flowsync/transfers/:transferId/pause`

- `POST /api/v1/flowsync/transfers/:transferId/resume`

- `POST /api/v1/flowsync/transfers/:transferId/fail`

## 9.3 NAS 暂存

- `POST /api/v1/flowsync/staging`
  - 申请暂存会话

- `PUT /api/v1/flowsync/staging/:objectId/manifest`

- `PUT /api/v1/flowsync/staging/:objectId/chunks/:chunkIndex`

- `POST /api/v1/flowsync/staging/:objectId/complete`

- `GET /api/v1/flowsync/staging/:objectId`
  - 查看暂存状态

## 9.4 外链

- `POST /api/v1/flowsync/shares`

- `GET /share/:token`
  - 浏览器领取页

- `GET /share/:token/download`
  - 受控下载

## 9.5 管理员控制

- `GET /api/v1/admin/flowsync/staging/config`
- `PUT /api/v1/admin/flowsync/staging/config`
- `GET /api/v1/admin/flowsync/staging/objects`
- `POST /api/v1/admin/flowsync/staging/gc`
- `GET /api/v1/admin/flowsync/shares`
- `POST /api/v1/admin/flowsync/shares/:shareId/disable`

## 10. WebSocket 事件草案

建议不要继续沿用只为 clipboard 设计的消息语义，新增一组内容流事件：

- `flow_entry_created`
- `flow_entry_updated`
- `flow_entry_offer`
- `flow_entry_accept`
- `flow_transfer_progress`
- `flow_transfer_paused`
- `flow_transfer_completed`
- `flow_transfer_failed`
- `flow_share_created`
- `flow_share_expired`

现有 `clipboard_update` 保留给文本/图片同步链路，但逐步收敛到新条目模型。

## 11. 本地存储布局建议

建议从单纯 clipboard cache 升级为：

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

说明：

- 文本/图片仍可保留快速读写路径
- 文件/文件夹统一走对象目录

## 12. 迁移与删除计划

## 12.1 需要删除的旧 FlowDrop 项

前端：

- `desktop/src/pages/FlowDrop.tsx`
- `App.tsx` 中的 `FlowDrop` route
- `Layout` 中的 `flowdrop` 导航项
- `FlowDeck` 中涉及 `FlowDrop` 的卡片逻辑
- 文案资源中的 `flowdrop` 专项文案

后端/核心：

- `core/src/p2p.rs`
- `send_file_p2p`
- `p2p_file_offer` 消息处理
- 与旧 `FlowDrop` 绑定的 UI 调用链

## 12.2 需要保留并解耦的旧能力

- 设备在线列表查询
- WebSocket 路由能力
- 剪贴板监听
- 本地历史/缓存
- 现有 blob/vault 上传下载经验

这些能力要先抽离，再接新模块，不能直接连旧 `FlowDrop` 代码。

## 12.3 迁移顺序建议

1. 先引入新 schema 与新 `content_stream` 内核
2. 让文本/图片条目先跑进新条目表
3. 加入文件/文件夹条目创建
4. 加入按需领取会话
5. 加入 NAS 暂存
6. 加入 NAS 外链
7. 最后删除旧 `FlowDrop`

如果旧 `FlowDrop` 代码对编译路径有干扰，也可以在第 3 步前就删除其 UI 和 Tauri 暴露，但要先确认没有其它模块引用。

## 13. 首阶段实现建议

建议按以下顺序推进：

## Phase A

- 新增 `flow_entries` / `flow_objects`
- 文本/图片进入新条目模型
- 新增自动同步开关

## Phase B

- 文件/文件夹条目创建
- 新建条目按钮
- 文件夹 manifest

## Phase C

- 在线设备按需领取
- chunk 与校验
- 状态机

## Phase D

- NAS 暂存
- 管理员控制项

## Phase E

- NAS 外链
- 风险提示
- 下载审计

## 14. 风险点

主要风险包括：

1. 旧 history schema 对 file/bundle 不够用
2. 当前 clipboard 监听对文件/文件夹对象的跨平台兼容性未知
3. 现有 `blob` 路径是临时图片上传逻辑，不应直接当作长期对象存储协议复用
4. NAS 外链若直接暴露明文对象，会破坏整体安全边界
5. 文件夹 manifest 设计若不稳定，后续恢复与校验会很痛苦

## 15. 建议的下一步产物

这份技术稿之后，建议继续补两份更细的文档：

1. `flowsync-schema-migration-plan-2026-05-01.md`
   - SQLite schema 迁移
   - 旧 history 数据兼容策略

2. `flowsync-api-contract-draft-2026-05-01.md`
   - HTTP / WS 具体字段
   - 错误码
   - 管理员配置项字段

如果接下来直接进入实现，建议第一步先做：

- 新条目 schema
- 自动同步开关
- 文件/文件夹新建条目

因为这三项能最早验证新模型是否站得住。
