# FlowSync Phase 6 收口报告

日期：2026-05-02

## 本阶段目标

按 [docs/flowsync-refactor-execution-plan-2026-05-01.md](/F:/Download/GitHub/YiboFlow/docs/flowsync-refactor-execution-plan-2026-05-01.md) 的 Phase 6 落地：

- 条目可上传到 NAS 暂存
- 其它设备可从 NAS 获取
- 管理员可控制暂存策略
- 用户可查看/删除自己的暂存对象，并设置默认 TTL

## 本阶段实现

### 1. 服务端新增 NAS 暂存模型与接口

新增文件：

- [server/internal/model/staging.go](/F:/Download/GitHub/YiboFlow/server/internal/model/staging.go)
- [server/internal/repo/staging_repo.go](/F:/Download/GitHub/YiboFlow/server/internal/repo/staging_repo.go)
- [server/internal/service/staging_service.go](/F:/Download/GitHub/YiboFlow/server/internal/service/staging_service.go)
- [server/internal/api/handler/staging_handler.go](/F:/Download/GitHub/YiboFlow/server/internal/api/handler/staging_handler.go)

服务端现在会持久化两类对象：

- `staging_policies`
- `staged_objects`

并在 [server/cmd/yiboflow/main.go](/F:/Download/GitHub/YiboFlow/server/cmd/yiboflow/main.go) 中自动迁移与注册路由。

新增的用户侧接口：

- `GET /api/v1/sync/staging/policy`
- `GET /api/v1/sync/staging/preferences`
- `PUT /api/v1/sync/staging/preferences`
- `POST /api/v1/sync/staging/objects`
- `PUT /api/v1/sync/staging/objects/:id/chunks`
- `POST /api/v1/sync/staging/objects/:id/complete`
- `GET /api/v1/sync/staging/lookup`
- `GET /api/v1/sync/staging/objects`
- `GET /api/v1/sync/staging/objects/:id/content`
- `DELETE /api/v1/sync/staging/objects/:id`

新增的管理员接口：

- `GET /api/v1/admin/staging/policy`
- `PUT /api/v1/admin/staging/policy`

### 2. 管理员策略实际生效

当前策略字段包括：

- `staging_enabled`
- `default_ttl_seconds`
- `max_ttl_seconds`
- `max_object_size_bytes`
- `user_quota_bytes`
- `external_links_enabled`
- `external_link_max_ttl_seconds`
- `gc_interval_seconds`

实际生效的约束：

- 暂存总开关关闭后，创建新暂存会被拒绝
- 请求 TTL 超过管理员最大值会被拒绝
- 单对象超过大小上限会被拒绝
- 单用户当前活动暂存超过配额会被拒绝
- 到期对象会在访问链路上被清理并且不可领取

### 3. Core/Tauri 接入 NAS 暂存链路

Rust API 客户端扩展在 [core/src/api.rs](/F:/Download/GitHub/YiboFlow/core/src/api.rs)。

本地 store 扩展在 [core/src/flow_store.rs](/F:/Download/GitHub/YiboFlow/core/src/flow_store.rs)：

- `flow_objects` 新增 `stage_object_id`
- `flow_objects` 新增 `stage_expires_at`
- `availability` 现在可切到 `nas_staged`
- 新增 `mark_entry_nas_staged`
- 新增 `clear_stage_object`

Tauri 命令扩展在 [desktop/src-tauri/src/lib.rs](/F:/Download/GitHub/YiboFlow/desktop/src-tauri/src/lib.rs)：

- `upload_flowsync_entry_to_nas`
- `list_my_flowsync_staged_objects`
- `delete_my_flowsync_staged_object`
- `get_flowsync_staging_preferences`
- `set_flowsync_staging_preferences`
- `admin_get_flowsync_staging_policy`
- `admin_update_flowsync_staging_policy`

同时，`download_flowsync_entry` 现在会优先查 `NAS staged object`：

- 若命中 `kind + root_hash` 的已完成暂存对象，则直接从 NAS 下载
- 若未命中，则回退到 Phase 5 的设备到设备下载链路

### 4. 前端接入

#### FlowSync

[desktop/src/pages/FlowSync.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/pages/FlowSync.tsx) 现在支持：

- 对本地 `file / bundle` 条目执行 `上传到 NAS`
- 查看当前条目的 `availability`
- 查看当前条目的 `stage_object_id / stage_expires_at`
- 查看自己的 NAS 暂存对象列表
- 删除自己的暂存对象
- 设置自己的默认 TTL

#### Admin

[desktop/src/pages/Admin.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/pages/Admin.tsx) 现在新增一块 `FlowSync NAS 暂存策略` 面板，可直接管理：

- 全局暂存开关
- 默认 TTL
- 最大 TTL
- 单对象大小上限
- 单用户配额
- 外链开关
- 外链最大 TTL
- GC 间隔

## 当前边界

这一步已经满足 Phase 6 主链路，但仍有几个明确边界：

- `chunk upload` 已有协议面和服务端入口，但桌面端当前仍按顺序整文件切块串行上传，不是并发块调度
- 传输 payload 当前是服务端受控暂存，不是端到端加密的 NAS 对象封装
- `external_links_enabled` 和 `external_link_max_ttl_seconds` 目前只作为 Phase 7 的前置策略字段，还没有真正的外链发放页
- GC 目前是访问链路触发式，而不是后台定时守护进程

## 验证结果

已通过：

- `cargo test -p yiboflow-core`
- `cargo check -p yiboflow-core`
- `cargo check -p tauri-app`
- `cd desktop && npm run build`
- `cd server && go build ./cmd/yiboflow`

前端构建仍有既有的 Vite warning：

- `@tauri-apps/api/event` 同时被静态与动态导入

这不是本阶段引入的阻断错误。
