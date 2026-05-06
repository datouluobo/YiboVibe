# FlowSync Phase 5 Report

日期：2026-05-02

## 本阶段目标

- 让 `file / bundle` 条目可以从在线设备按需下载到本机
- 让本机已有 `file / bundle` 条目可以推送到指定在线设备
- 把传输会话落到 `flow_transfers`
- 为传输过程补上 `flow_entry_accept / flow_transfer_progress / flow_transfer_completed / flow_transfer_failed`

## 已完成

### 1. 传输会话状态落库

`core/src/flow_store.rs`

- 新增 `FlowTransferRecord` / `FlowEntryTransferState`
- 新增 `upsert_transfer_session`
- 新增 `get_entry_transfer_state`
- 新增 `mark_transfer_completed`
- 新增 `mark_transfer_failed`
- 新增 `finalize_downloaded_entry`
- `flow_entry_offer` 现在会同时持久化 `source_device_id`

当前会话状态至少覆盖：

- `offered`
- `accepted`
- `transferring`
- `verifying`
- `completed`
- `failed`
- 远端仅元数据保留为 `metadata_only`

### 2. 设备侧按需下载

`desktop/src-tauri/src/lib.rs`

- 新增 `download_flowsync_entry`
- 新增 `get_flowsync_entry_transfer_state`

`core/src/clipboard.rs`

- 接收端对远端 `flow_entry_offer` 点击下载后，会发送 `flow_entry_accept`
- 发送端收到 `flow_entry_accept` 后，定位本地对象并启动实际传输

### 3. 定向推送到在线设备

`desktop/src-tauri/src/lib.rs`

- 新增 `list_flowsync_online_devices`
- 新增 `push_flowsync_entry_to_device`

`core/src/clipboard.rs`

- `flow_entry_offer` 新增定向发送能力
- 推送场景使用 `auto_accept=true`
- 目标设备收到后会自动回发 `flow_entry_accept`，不需要再手点一次下载

### 4. P2P 传输内核扩展

`core/src/p2p.rs`

- 在原有 TCP 直传基础上补了 FlowSync 传输元数据：
  - `transfer_id`
  - `kind`
  - `root_hash`
  - `unpack_bundle`
  - `title`
  - `source_device_name`
- 文件条目直接发送原文件
- 文件夹条目发送前打成 zip，接收端自动解包
- 传输中按块写入并回报进度
- 完成后做校验：
  - 文件：`blake3(file) == root_hash`
  - 文件夹：重建 manifest，再校验 `blake3(manifest_json) == root_hash`

### 5. FlowSync 前端动作面

`desktop/src/pages/FlowSync.tsx`

- 选中 `file / bundle` 条目时：
  - 若本机没有内容，显示 `下载到本机`
  - 若本机已有内容，显示 `推送到设备`
- 新增在线设备下拉
- 新增传输状态与进度显示
- 轮询当前选中条目的 transfer state

## 当前行为边界

这一步已经可以支持：

- 设备 A 生成 `file / bundle` 条目
- 设备 B 收到元数据条目
- 设备 B 点击下载，设备 A 在线时完成实际传输
- 设备 A 主动把条目推送到指定在线设备
- 校验失败时不会误标记为成功
- 失败后可以重新发起一次完整重试

## 本阶段未做

以下能力没有在本阶段展开：

- 断点续传
- chunk 索引持久化与按 offset 恢复
- 多来源择优下载
- 后台队列管理、暂停/继续
- NAS 暂存与外链

也就是说，当前“重试”是整次重新开始，不是中断点恢复。

## 验证

已通过：

- `cargo test -p yiboflow-core`
- `cargo check -p yiboflow-core`
- `cargo check -p tauri-app`
- `cd desktop && npm run build`

前端构建仍保留已有的 Vite warning：

- `@tauri-apps/api/event` 同时被静态和动态导入

这不是本阶段新增阻断。
