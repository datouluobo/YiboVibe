# 移动端到桌面端 MVP 独立方案

> Archived engineering note:
> This document is kept for historical implementation context and is not the current public product or deployment guide.
>
> 历史工程记录：本文保留实现背景与演进过程，不作为当前对外产品或部署说明。

更新时间：2026-05-14

## 1. 文档目标

本文档用于把“移动端最快跑通到桌面端”的开发顺序单独落成一份可执行方案。

本方案优先级高于按模块平均推进的做法，目标不是同时完成 `FlowSync`、`FlowDrop`、`FlowKeys` 等全部能力，而是先把一条最短远程控制主链闭环跑通。

产品边界与总体定位以 [specs-v2.md](/F:/Download/GitHub/YiboVibe/docs/specs-v2.md) 为准。

## 2. MVP 目标

先跑通这一条链路：

`桌面端执行宿主` → `服务端 Signal/Session Hub` → `移动端 Remote Console`

MVP 完成标准：

- 用户可在移动端登录并连接同账号桌面设备
- 移动端可看到桌面端当前活跃 session 列表
- 移动端可对 session 发起 `start / stop / pause / resume`
- 移动端可向当前 session 发送文本输入
- 移动端可看到最近终端输出、连接状态和基础告警

## 3. 为什么先做这条

当前仓库内最接近可用的是这一组现成能力：

- 桌面端已有 `VibeConsole` 和终端会话管理基础
- 服务端已有 WebSocket Signal Hub 与 session 元数据路由
- 移动端已有连接页和基础 Console 壳，但仍是骨架

这意味着最短板不是“从零设计能力”，而是“把三段现有能力收成闭环”。

相比之下，以下模块都应暂时视为增强项，而不是 MVP 前置依赖：

- `FlowSync`
- `FlowDrop`
- `FlowKeys`
- `FlowRules`
- `FlowHint`
- `FlowSnap`
- `FlowProbe`

## 4. 当前代码落点

桌面端主入口：

- [desktop/src/pages/VibeConsole.tsx](/F:/Download/GitHub/YiboVibe/desktop/src/pages/VibeConsole.tsx)
- [desktop/src-tauri/src/lib.rs](/F:/Download/GitHub/YiboVibe/desktop/src-tauri/src/lib.rs)
- [desktop/src-tauri/src/terminal.rs](/F:/Download/GitHub/YiboVibe/desktop/src-tauri/src/terminal.rs)

服务端主入口：

- [server/cmd/yibovibe/main.go](/F:/Download/GitHub/YiboVibe/server/cmd/yibovibe/main.go)
- [server/internal/ws/client.go](/F:/Download/GitHub/YiboVibe/server/internal/ws/client.go)
- [server/internal/session/store.go](/F:/Download/GitHub/YiboVibe/server/internal/session/store.go)
- [server/internal/relay/relay.go](/F:/Download/GitHub/YiboVibe/server/internal/relay/relay.go)

移动端骨架：

- [YiboVibe-Mobile/lib/main.dart](/F:/Download/GitHub/YiboVibe/YiboVibe-Mobile/lib/main.dart)
- [YiboVibe-Mobile/lib/pages/login_page.dart](/F:/Download/GitHub/YiboVibe/YiboVibe-Mobile/lib/pages/login_page.dart)
- [YiboVibe-Mobile/lib/pages/console_page.dart](/F:/Download/GitHub/YiboVibe/YiboVibe-Mobile/lib/pages/console_page.dart)
- [YiboVibe-Mobile/lib/services/signal_client.dart](/F:/Download/GitHub/YiboVibe/YiboVibe-Mobile/lib/services/signal_client.dart)

安全基线：

- [remote-control-security-baseline-2026-05-12.md](/F:/Download/GitHub/YiboVibe/docs/remote-control-security-baseline-2026-05-12.md)

## 5. MVP 范围

### 5.1 必做

- 移动端完成真实登录或最小可用鉴权接入，不再使用硬编码 `uid/deviceId`
- 服务端返回在线桌面设备与 session 列表
- 桌面端可将本地 session 状态持续同步到 Signal Hub
- 移动端可操作 session 生命周期
- 移动端可向桌面终端发送一段输入
- 桌面端输出可实时或准实时回传到移动端
- 桌面端与移动端都能显示连接状态

### 5.2 可以推迟到 MVP 后

- 多 Agent 编排
- 资源投喂
- 文件或图片传输
- FlowSync 资产同步整合
- FlowKeys 远程动作映射
- FlowRules 策略矩阵
- FlowProbe 移动端控制面板
- NAS 资源桥接

### 5.3 暂不进入本期

- 服务端代替桌面端执行主流程
- 复杂自愈编排
- 完整审计后台
- 通用跨网文件投递体系

## 6. 推荐开发顺序

### Phase 1：桌面端先稳定为执行宿主

目标：

- 保证桌面端 session 生命周期稳定
- 明确 session 的创建、启动、写入、输出、停止的本地闭环

任务：

- 复核 `create_session / start_session / write_terminal / list_sessions / kill_terminal / remove_session`
- 为 session 输出事件补齐稳定的状态同步点
- 明确 session 元数据最小字段：`session_id`、`shell_kind`、`cwd`、`status`、`last_output_at`

完成标准：

- 不依赖移动端，桌面本地 `VibeConsole` 能稳定跑通多 session 基础操作

### Phase 2：服务端只做最小 Hub

目标：

- 让服务端承担“认证 + 在线状态 + 会话目录 + 指令转发”

任务：

- 收敛 WebSocket 消息类型，只保留 MVP 所需命令
- 打通移动端到桌面端的 session 指令路由
- 打通桌面端到移动端的 session 列表与输出广播
- 明确 session 所属 `uid / device_id / session_id`

完成标准：

- 服务端不处理业务执行，只可靠路由消息与会话元数据

### Phase 3：移动端从骨架变成可用遥控器

目标：

- 移动端能真正消费 session 能力，而不是仅显示日志

任务：

- 登录页接真实服务端登录和 token 保存
- Console 页展示在线设备与 session 列表
- 增加 session 操作按钮
- 增加最小输入框，可向当前 session 发送文本
- 增加最近输出面板和连接状态条

完成标准：

- 手机可以完成“看 session、发命令、看输出”

### Phase 4：补最小安全确认

目标：

- 高危操作遵循远程控制安全基线

任务：

- 至少对 `session:stop` 增加确认
- 预留 `control:confirm / control:reject` 消息流
- 在桌面端本地保留最小审计记录

完成标准：

- MVP 中已经存在一条真实可用的确认链，不再是纯裸命令

### Phase 5：MVP 验收与收口

目标：

- 明确这是一个“能演示、能真实自用”的第一版，而不是实验壳

验收场景：

1. 桌面端登录服务端并在线
2. 移动端登录同账号
3. 移动端看到桌面设备与活跃 session
4. 移动端启动或切换一个 session
5. 移动端发送一条命令
6. 桌面端执行该命令
7. 移动端收到输出结果
8. 移动端停止该 session，并完成确认

## 7. 这期明确不依赖哪些模块

为了缩短路径，本期不要把以下模块作为前置阻塞：

- `FlowSync` 不要求先升级成完整跨端资产层
- `FlowDrop` 不要求先做资源投递
- `FlowKeys` 不要求先做远程按键映射
- `FlowRules` 不要求先做策略矩阵
- `FlowHint / FlowSnap` 不要求先接入远程控制主链
- `FlowProbe` 不要求先暴露移动端操作页

这些能力后续可以逐步接到已跑通的远程控制主链上。

## 8. 当前已知缺口

从现状看，至少有这些问题应优先补：

- 移动端登录页默认仍是手填地址与 token
- 移动端 `uid` 和 `deviceId` 仍为硬编码占位
- 移动端没有真正的 session 输入面板
- 移动端没有消费桌面端标准化输出流
- 服务端 signal/session 类型已存在，但还未完整收敛为移动遥控闭环

## 9. 本方案后的下一步

MVP 跑通之后，再按增量顺序接入：

1. `FlowSync`：同步上下文快照、最近输出、小型产物
2. `FlowDrop`：把资源投喂并入远程会话
3. `FlowKeys`：补快捷动作与映射命令
4. `FlowRules`：补会话级安全策略
5. `FlowProbe`：补上游模型资产的远程查看与切换

在此之前，不建议把开发资源分散到多个 Flow 模块同时收口。
