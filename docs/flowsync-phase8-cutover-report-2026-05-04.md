# FlowSync Phase 8 收口报告

日期：2026-05-04

## 本阶段目标

按 [docs/flowsync-refactor-execution-plan-2026-05-01.md](/F:/Download/GitHub/YiboFlow/docs/flowsync-refactor-execution-plan-2026-05-01.md) 的 Phase 8 推进：

- 删除旧 `FlowDrop` 前端入口
- 删除旧 `send_file_p2p` 命令与旧快传可达路径
- 把文件/文件夹传输继续收束到 `FlowSync`
- 清掉旧 `p2p_file_offer` 事件名在主路径上的依赖

## 本阶段实现

### 1. 前端删除旧 FlowDrop 入口

本阶段删除或收口了以下内容：

- 删除 [desktop/src/pages/FlowDrop.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/pages/FlowDrop.tsx)
- 删除 [desktop/src/App.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/App.tsx) 中的 `flowdrop` route
- 删除 [desktop/src/components/Layout.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/components/Layout.tsx) 中的侧栏入口
- 删除 [desktop/src/pages/FlowDeck.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/pages/FlowDeck.tsx) 中的 `FlowDrop` 功能卡片和“可见传输目标”指标
- 删除 [desktop/src/locales/zh.json](/F:/Download/GitHub/YiboFlow/desktop/src/locales/zh.json) 与 [desktop/src/locales/en.json](/F:/Download/GitHub/YiboFlow/desktop/src/locales/en.json) 中的 `nav.flowdrop`、`tooltip_flowdrop`、`drop.*` 等旧文案

现在桌面端文件/文件夹相关操作统一从 [desktop/src/pages/FlowSync.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/pages/FlowSync.tsx) 进入：

- 推送到设备
- 下载到本机
- 上传到 NAS
- 创建 NAS 外链

### 2. 删除旧快传命令路径

[desktop/src-tauri/src/lib.rs](/F:/Download/GitHub/YiboFlow/desktop/src-tauri/src/lib.rs) 中已删除：

- `send_file_p2p`

这意味着旧 FlowDrop 页面那种“随便选一个文件直接发”的命令面不再保留。

### 3. FlowSync 传输事件切换

[core/src/p2p.rs](/F:/Download/GitHub/YiboFlow/core/src/p2p.rs) 中：

- 删除旧 `start_file_send`
- 删除旧 `handle_p2p_offer`
- 将 FlowSync 文件/文件夹按需传输的 offer 事件从 `p2p_file_offer` 改为 `flow_transfer_offer`

[core/src/clipboard.rs](/F:/Download/GitHub/YiboFlow/core/src/clipboard.rs) 中：

- 删除旧 `p2p_file_offer` 分支里对遗留快传的兜底处理
- 保留并改接 `flow_transfer_offer -> handle_flow_transfer_offer`

这样一来，当前仍保留在 `core/src/p2p.rs` 的内容已经主要是：

- `FlowSync` 文件/文件夹传输会话
- bundle zip 打包 / 解包辅助函数

而不再承担旧 FlowDrop 页面的快传入口职责。

## 当前边界

- `core/src/p2p.rs` 这个模块名仍然保留，原因是当前的文件/文件夹传输仍然通过点对点 TCP 会话完成；本阶段收掉的是旧产品入口和旧事件名，不是把所有传输辅助代码重命名
- `query_history/search_history/copy_history_to_clipboard` 在桌面端仍保留兼容命令名，但底层读取已经走 `flow_entries` 兼容层，而不是回到旧 `FlowDrop` 页面或旧独立快传模型
- `server/` 侧没有单独的 `FlowDrop` 专属路由需要删除；本阶段的主要删除面集中在桌面端和 Core 传输事件

## 验证结果

已通过：

- `cargo check -p yiboflow-core`
- `cargo check -p tauri-app`
- `cd desktop && npm run build`

本轮未重新执行：

- `cd server && go build ./cmd/yiboflow`

原因：

- 本阶段未改动 `server/` 代码路径

前端构建仍保留既有 Vite warning：

- `@tauri-apps/api/event` 同时被静态与动态导入

这不是本阶段引入的阻断错误。
