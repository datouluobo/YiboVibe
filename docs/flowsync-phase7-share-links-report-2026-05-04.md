# FlowSync Phase 7 收口报告

日期：2026-05-04

## 本阶段目标

按 [docs/flowsync-refactor-execution-plan-2026-05-01.md](/F:/Download/GitHub/YiboFlow/docs/flowsync-refactor-execution-plan-2026-05-01.md) 的 Phase 7 落地：

- 只基于 NAS 暂存对象提供受控外链
- 支持 TTL、下载次数限制、失效与禁用
- 在桌面端明确提示外链风险
- 保留基本审计信息

## 本阶段实现

### 1. 服务端新增 `share_links`

本阶段在现有 NAS 暂存能力之上新增 `share_links` 持久化模型：

- [server/internal/model/staging.go](/F:/Download/GitHub/YiboFlow/server/internal/model/staging.go)
- [server/internal/repo/staging_repo.go](/F:/Download/GitHub/YiboFlow/server/internal/repo/staging_repo.go)
- [server/internal/service/staging_service.go](/F:/Download/GitHub/YiboFlow/server/internal/service/staging_service.go)
- [server/internal/api/handler/staging_handler.go](/F:/Download/GitHub/YiboFlow/server/internal/api/handler/staging_handler.go)

关键字段包括：

- `stage_object_id`
- `status`
- `ttl_seconds`
- `max_downloads`
- `download_count`
- `last_downloaded_at`
- `disabled_at`
- `expires_at`

服务端当前会：

- 生成高熵 token 作为公开下载凭据
- 受 `external_links_enabled` 控制是否允许创建外链
- 受 `external_link_max_ttl_seconds` 控制外链 TTL 上限
- 在公开下载时校验外链是否过期、禁用或达到下载次数上限
- 在下载成功后更新 `download_count` 与 `last_downloaded_at`
- 在删除 NAS 暂存对象时同步禁用关联外链

### 2. 新增外链接口与公开下载路由

服务端新增用户侧接口：

- `GET /api/v1/sync/share-links`
- `POST /api/v1/sync/share-links`
- `POST /api/v1/sync/share-links/:id/disable`

同时新增公开下载路由：

- `GET /share/:token`

该公开路由不依赖登录态，浏览器直接访问即可下载对应 NAS 暂存对象。

### 3. Core/Tauri 接入

[core/src/api.rs](/F:/Download/GitHub/YiboFlow/core/src/api.rs) 新增：

- `FlowSyncShareLinkInfo`
- `FlowSyncCreateShareLinkRequest`
- `list_flowsync_share_links`
- `create_flowsync_share_link`
- `disable_flowsync_share_link`

[desktop/src-tauri/src/lib.rs](/F:/Download/GitHub/YiboFlow/desktop/src-tauri/src/lib.rs) 新增命令：

- `list_my_flowsync_share_links`
- `create_flowsync_share_link`
- `disable_my_flowsync_share_link`

### 4. FlowSync 前端接入

[desktop/src/pages/FlowSync.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/pages/FlowSync.tsx) 的 NAS 暂存面板现在支持：

- 配置外链 TTL
- 配置最大下载次数
- 为某个暂存对象创建外链
- 复制外链
- 禁用外链
- 查看下载次数、到期时间和当前状态

同时补上了明确风险提示：

- 任何拿到链接的人都可以直接下载对象
- 不建议把外链用于敏感文件

## 当前边界

- 外链当前直接命中二进制下载，不包含单独的下载落地页或视觉包装
- 外链审计目前保留在 `share_links` 表内，记录创建结果、下载次数、最后下载时间、禁用时间和过期时间；还没有拆独立审计日志表
- 外链对象来源仍然只支持已完成的 NAS 暂存对象，不支持设备直连对象直接发外链
- 公开下载当前按对象原始 payload 返回；如果 bundle 在 Phase 6 里以 zip 暂存，则外链下载也会得到该 zip

## 验证结果

已通过：

- `cargo check -p yiboflow-core`
- `cargo check -p tauri-app`
- `cd server && go build ./cmd/yiboflow`
- `cd desktop && npm run build`

前端构建仍保留既有 Vite warning：

- `@tauri-apps/api/event` 同时被静态与动态导入

这不是本阶段新增的阻断错误。
