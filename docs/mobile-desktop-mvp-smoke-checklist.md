# Mobile Desktop MVP Smoke Checklist

> Archived engineering note:
> This document is kept for historical implementation context and is not the current public product or deployment guide.
>
> 历史工程记录：本文保留实现背景与演进过程，不作为当前对外产品或部署说明。

更新时间：2026-05-15

## 目标

把 [mobile-desktop-mvp-plan-2026-05-14.md](/F:/Download/GitHub/YiboVibe/docs/mobile-desktop-mvp-plan-2026-05-14.md) 里的 8 步验收场景固化成每次改动后都可复用的 smoke checklist。

适用范围：

- `desktop/src/pages/VibeConsole.tsx`
- `desktop/src-tauri/src/terminal.rs`
- `desktop/src-tauri/src/lib.rs`
- `YiboVibe-Mobile/lib/pages/login_page.dart`
- `YiboVibe-Mobile/lib/pages/console_page.dart`
- `YiboVibe-Mobile/lib/services/signal_client.dart`

## 前置条件

- 服务端已启动，移动端与桌面端指向同一服务端
- 桌面端与移动端使用同一账号
- 桌面端已进入可操作 `VibeConsole` 的页面
- 若要覆盖 WSL 场景，桌面设备需已安装并可正常调用 `wsl.exe`

## Smoke Checklist

1. 桌面端登录服务端并确认在线

- 预期：
  桌面端无登录错误，服务端可看到该桌面设备在线。

2. 桌面端本地创建第一个 session

- 操作：
  在 `VibeConsole` 新建一个 `cmd` 或 `pwsh` session。
- 预期：
  本地 tab 立即出现，session 状态进入可运行态，底部能看到 `cwd`。

3. 桌面端本地创建第二个 session，并切换多 session

- 操作：
  再新建一个不同 shell 的 session，在两个 session 间切换。
- 预期：
  两个 tab 都可见，切换后终端焦点正确，互不串流输出。

4. 移动端登录同账号并进入 Console

- 预期：
  登录成功，顶部连接状态显示为已连接，Console 页面能拉到 session 列表。

5. 移动端看到桌面设备与活跃 session

- 操作：
  在移动端刷新 session 列表。
- 预期：
  至少能看到桌面端当前已有 session，`shell_kind / state / started_at` 不为空，当前选中 session 可切换。

6. 移动端向选中 session 发送输入

- 操作：
  在移动端输入一条简单命令并发送。
  Windows shell 可用：`echo YBV_SMOKE_OK`
  WSL 可用：`printf 'YBV_SMOKE_OK\n'`
- 预期：
  桌面端对应 session 收到输入并执行，移动端在当前输出面板中看到 `YBV_SMOKE_OK`。

7. 验证 session 输出与状态同步

- 操作：
  在桌面端和移动端分别观察同一 session 的输出与状态。
- 预期：
  桌面端本地输出持续刷新，移动端能收到新增输出。
  若 session 自然退出或被停止，移动端状态会更新为 `stopped`，不会残留为假在线。

8. 移动端停止并移除 session

- 操作：
  在移动端对一个运行中的 session 发送 `Stop`，确认弹窗后执行；必要时再执行移除。
- 预期：
  桌面端对应 session 停止。
  session 状态与列表同步刷新。
  已移除的 session 不再出现在移动端列表中。

## 额外回归点

- 对已停止 session 再次执行 `Start` 或 `Resume`，确认能重新启动
- 连续创建并关闭多个 session，确认不会出现重复 tab、错误选中或输入写错 session
- 切换移动端选中 session 后再发送输入，确认输出归属正确
- 断开移动端网络后，连接状态能变为断开；恢复连接后可重新进入 Console

## 通过标准

- 上述 8 步全部通过
- “额外回归点”至少抽查前 3 项
- 本地桌面多 session 闭环与移动端遥控闭环都不依赖手工修状态
