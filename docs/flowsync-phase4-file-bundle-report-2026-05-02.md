# FlowSync Phase 4 文件与文件夹条目落地报告

日期：2026-05-02

## 本阶段目标

根据 [flowsync-refactor-execution-plan-2026-05-01.md](/F:/Download/GitHub/YiboFlow/docs/flowsync-refactor-execution-plan-2026-05-01.md) 的 Phase 4，本阶段目标是让 `FlowSync` 先把 `file` / `bundle` 条目走通：

- 单文件可生成 `file` 条目
- 单文件夹可生成 `bundle` 条目
- `FlowSync` 页面提供手动“新建条目”入口
- 文件夹生成目录树 manifest
- 条目可同步到同账号其它设备
- 内容不自动下发

## 已落地内容

### 1. Core 数据层支持 `file` / `bundle`

文件：[core/src/flow_store.rs](/F:/Download/GitHub/YiboFlow/core/src/flow_store.rs)

- 新增本地路径建条目入口 `create_local_path_entry(...)`
- 单文件：
  - 计算文件内容 `blake3`
  - 生成 `kind = file`
  - `local_storage_path` 直接指向原文件
- 单文件夹：
  - 遍历目录树
  - 生成 `FlowBundleManifest`
  - 序列化写入 `flowsync/manifests/{root_hash}.json`
  - 生成 `kind = bundle`
- 新增远端元数据建条目入口 `upsert_remote_entry_offer(...)`
  - 只写元数据
  - `has_local_content = 0`
  - `transfer_status = metadata_only`
  - `availability = remote_device`

### 2. FlowSync 查询/预览兼容层扩展到四类条目

文件：

- [core/src/flow_store.rs](/F:/Download/GitHub/YiboFlow/core/src/flow_store.rs)
- [desktop/src-tauri/src/lib.rs](/F:/Download/GitHub/YiboFlow/desktop/src-tauri/src/lib.rs)

变更点：

- `query_history_compat`
- `search_history_compat`
- `get_history_record_compat`

现在会把以下字段一起带到兼容层：

- `title`
- `manifest_json`
- `local_storage_path`

预览行为：

- `text`：显示全文
- `image`：显示图片
- `file`：显示文件名、大小、root hash、本地路径
- `bundle`：显示文件夹名、大小、root hash、本地路径、目录树预览

### 3. FlowSync 页面新增“新建条目”入口

文件：[desktop/src/pages/FlowSync.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/pages/FlowSync.tsx)

- 底部工具栏新增“新建条目”
- 支持：
  - 手动选择单文件
  - 手动选择单文件夹
- 页面列表与右侧预览扩展到：
  - `text`
  - `image`
  - `file`
  - `bundle`
- `file` / `bundle` 当前不支持“回写到系统剪贴板”，UI 已显式禁用复制按钮

### 4. 本机剪贴板支持单文件 / 单文件夹识别

文件：

- [core/src/clipboard.rs](/F:/Download/GitHub/YiboFlow/core/src/clipboard.rs)
- [core/Cargo.toml](/F:/Download/GitHub/YiboFlow/core/Cargo.toml)

变更点：

- Windows 下通过 `clipboard-win` 读取 `CF_HDROP`
- 仅接受：
  - 单文件
  - 单文件夹
- 明确不接受：
  - 多个独立文件混合复制
  - 多个独立文件夹混合复制

检测到后会：

1. 落本地 `file` / `bundle` 条目
2. 刷新 `FlowSync` 活动流
3. 如已开启同步，则通过 WS 广播元数据条目

### 5. 文件 / 文件夹条目元数据同步

文件：

- [core/src/clipboard.rs](/F:/Download/GitHub/YiboFlow/core/src/clipboard.rs)
- [desktop/src-tauri/src/lib.rs](/F:/Download/GitHub/YiboFlow/desktop/src-tauri/src/lib.rs)

新增消息类型：

- `flow_entry_offer`

发送端：

- 剪贴板检测到单文件 / 单文件夹后发送
- 手动“新建条目”后发送

接收端：

- 仅持久化条目元数据
- 不拉取内容
- 不尝试自动下载文件

## 刻意保留的边界

本阶段仍然刻意不做：

- 大文件内容自动下发
- 文件 / 文件夹回写到系统剪贴板
- 文件夹内单文件局部领取
- 设备侧 chunk 传输
- NAS 暂存 / 外链

这些仍留在后续阶段。

## 风险与注意点

### 1. 删除条目不删除用户原始文件

手动新建或剪贴板识别的 `file` / `bundle` 条目，其 `local_storage_path` 指向用户原始路径。

因此当前已做保护：

- 删除历史条目时，不会删除 `file` / `bundle` 的原文件或原目录

### 2. 远端只看到元数据

远端设备当前只能先看到条目，不能直接自动拿到内容。这是 Phase 4 的刻意设计，不是缺陷。

## 验证结果

已通过：

- `cargo test -p yiboflow-core`
- `cargo check -p yiboflow-core`
- `cargo check -p tauri-app`
- `cd desktop && npm run build`

前端构建仍有既有 Vite warning：

- `@tauri-apps/api/event` 同时被静态和动态引用

该 warning 不是本阶段引入的阻断问题。
