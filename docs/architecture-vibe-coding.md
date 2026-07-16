# YiboVibe v2 Vibe Coding 架构设计

更新时间：2026-05-11

## 1. 文档目的

本文档描述 YiboVibe v2 面向 `Vibe Coding Tools` 主线的技术架构、运行边界、核心数据流和模块分层。

本文档关注：

- 三端协作结构
- Headless Host 实现边界
- 多 Agent 会话模型
- WSL/ConPTY 桥接
- 资源桥接
- 告警、自愈与控制链路

本文档不负责：

- 最终程序名决策
- 具体 UI 像素实现
- 具体数据库字段清单

## 2. 总体架构

系统采用：

- 去中心化执行
- 中心化信令路由
- 本机优先宿主
- 会话级可观测性

### 2.1 三端关系

1. 桌面端负责执行
2. 服务端负责路由、鉴权、状态汇聚
3. 移动端负责发令、观察、消息确认与异常接管

### 2.2 架构总图

```text
Mobile Console
  -> command / intent / confirm / observe
Server Hub
  -> auth / websocket / routing / state / encrypted asset index
Desktop Headless Host
  -> session host / WSL bridge / local IPC / context capture / artifact extraction
Upstream Tools
  -> WSL agents / local processes / FlowProbe providers / YiboFile / local files / NAS
```

## 3. 分层设计

### 3.1 Console Layer

面向用户的控制台层。

主要界面：

- 全局总览
- Agent 列表
- Session 频道
- 资源面板
- FlowProbe 管理页
- 运行状态页
- 高危控制面板

终端：

- `desktop/src/pages/`
- `mobile/`

### 3.2 Orchestration Layer

负责把 UI 意图转为系统内部标准动作。

职责：

- 会话创建/切换/关闭
- 指令路由
- 确认与异常处理路由
- 会话状态管理
- 自愈动作编排

建议放置：

- `desktop/src-tauri/src/`
- `server/internal/`

### 3.3 Capability Layer

保留并复用现有 `Flow*` 模块能力。

包括：

- `FlowProbe`
- `FlowSync`
- `FlowDrop`
- `FlowRules`
- `FlowKeys`
- `FlowHint`
- `FlowSnap`

这些模块不再是孤立页面，而应被上层编排层按场景调用。

### 3.4 Host Layer

系统最关键的一层。

职责：

- 托管进程
- 处理标准流
- 上下文采集
- IPC 桥接
- 心跳采样
- 终端状态识别

建议放置：

- `core/src/agent_host/`
- `desktop/src-tauri/src/agent_bridge/`

### 3.5 Infrastructure Layer

负责：

- 认证
- 数据库存储
- 缓存
- WebSocket
- 文件暂存元数据
- 任务通知

对应：

- `server/`
- `postgres`
- `redis`
- `caddy`

## 4. 桌面端 Headless Host

### 4.1 角色定义

桌面端不是 UI 附属进程，而是系统的主执行宿主。

它必须可以在无前台窗口的前提下持续完成：

- Agent 启动
- 会话维持
- 标准流读取
- 输入注入
- 状态上报
- 资源落盘
- 本地 IPC

### 4.2 Host 组成

建议拆为以下子模块：

- `session_manager`
- `wsl_launcher`
- `pty_bridge`
- `stdio_parser`
- `prompt_detector`
- `artifact_harvester`
- `context_snapshot`
- `vital_signs`
- `self_heal`
- `resource_bridge`

### 4.3 基本设计要求

- 不依赖页面生命周期
- 不依赖 React 状态
- 可通过 Tauri command 或内部 service 调用
- 同时支持单会话和多会话
- 对异常退出、读流阻塞、僵死无响应有统一判定模型
- 交互式终端固定基于 PTY，问题优先在既定 PTY 路线内修复，不在排障过程中临时切换终端方案

## 5. WslAgentBridge

### 5.1 目标

为 WSL 或本机终端进程提供统一的会话托管入口。

支持：

- 启动命令
- 工作目录
- 环境变量
- stdin 注入
- stdout/stderr 异步消费
- 停止、重启、强杀

### 5.2 抽象接口建议

建议内部抽象为：

- `SessionHost`
- `SessionProcess`
- `SessionTransport`
- `SessionTelemetry`

其中：

- `SessionHost` 负责生命周期
- `SessionProcess` 负责具体进程句柄
- `SessionTransport` 负责流读写
- `SessionTelemetry` 负责状态采样

当前约束：

- 交互式 shell / CLI / TUI 统一走 PTY
- WSL、PowerShell、cmd 共享同一条 PTY 会话托管路线
- 如果出现补全、回删、提示符、布局错乱等问题，默认视为 PTY 实现问题并在该层修复

### 5.3 关键能力

- 可按需拉起 `wsl -e <command>`
- 可选择 PowerShell / cmd / 本机可执行程序
- 可配置工作目录与 project root
- 可返回首屏启动结果
- 可识别退出码和最后一次输出

## 6. 终端桥接与输出解析

### 6.1 输入链路

远程输入流：

```text
Mobile action / desktop UI action
  -> server routing
  -> desktop session command receiver
  -> session transport stdin write
```

输入来源可包括：

- 普通文本
- Enter
- yes/no
- 中断信号
- 预设命令卡

### 6.2 输出链路

输出链路：

```text
Session stdout/stderr
  -> line/frame parser
  -> prompt detector
  -> artifact harvester
  -> state reducer
  -> local UI + server websocket fan-out
```

### 6.3 输出解析目标

至少识别以下类别：

- 普通日志
- 错误输出
- 交互提示
- 代码块
- patch 块
- 命令建议
- 文件路径
- URL
- 长时间静默

## 7. Context Projection

### 7.1 输入源

上下文快照的来源可包括：

- 当前项目根目录
- 当前活动文件路径
- 当前文件末尾片段
- 最近若干条终端输出
- 最近错误堆栈
- 当前会话配置
- 最近资源投喂记录

### 7.2 生成原则

- 快照要短但完整
- 结构化优先于大段原文
- 必须可直接用于重新唤醒 Agent
- 应标识来源时间和会话 id

### 7.3 输出模型建议

字段可包括：

- `session_id`
- `project_root`
- `active_file`
- `recent_output`
- `recent_error`
- `selected_resources`
- `last_user_intent`
- `generated_at`

## 8. Artifact Auto-Harvesting

### 8.1 目标

自动把会话输出中有复用价值的内容沉淀成结构化资产。

### 8.2 资产类型

- `code_block`
- `patch`
- `shell_command`
- `error_summary`
- `config_snippet`
- `path_reference`
- `model_response_summary`

### 8.3 消费方

- 本地桌面页
- 移动端
- `FlowSync` 同步剪贴板
- 跨会话转发器
- 后续知识沉淀层

## 9. Resource Bridge

### 9.1 角色

把开发者私有资源转为会话可消费输入。

### 9.2 输入源

- 本地文件系统
- YiboFile IPC
- NAS 映射目录
- FlowDrop 收到的文件
- 手工上传附件

### 9.3 处理流程

```text
User selects resource
  -> desktop resolver locates file
  -> metadata extract / preview
  -> optional text extraction
  -> attach to target session
  -> send structured note to agent
```

### 9.4 原则

- 文件真实读取尽量由桌面端完成
- 移动端负责发起意图，不承担私有文件系统访问实现
- 未来与 YiboFile 的整合以 IPC 为主，不做脆弱 UI 自动化替代

## 10. Agent Vital Signs

### 10.1 采样项

- cpu_percent
- memory_bytes
- uptime_ms
- last_output_at
- token_rate
- active_prompt_state
- process_state
- websocket_state

### 10.2 输出去向

- 桌面本地仪表盘
- 移动端会话头部状态区
- 服务端心跳/告警逻辑

### 10.3 价值

- 区分“正在思考”和“已经卡死”
- 区分“网络断开”和“模型无响应”
- 支撑哨兵模式与远程紧急自愈

## 11. 自愈与控制链路

### 11.1 软控制

- 发送 Enter
- 发送 yes/no
- 停止当前任务
- 重启当前 Agent 进程

### 11.2 硬控制

- 强杀子进程
- 关闭会话
- `wsl --shutdown`
- 重新拉起宿主

### 11.3 自愈前置动作

在高危动作前，优先执行：

- 记录最后输出
- 记录当前进程状态
- 保留最近上下文快照
- 如可行，尝试触发保存动作

## 12. 多 Agent 会话模型

### 12.1 核心实体

- `agent_profile`
- `session`
- `session_channel`
- `resource_attachment`
- `artifact`
- `vital_snapshot`
- `control_action`

### 12.2 关系

- 一个 `agent_profile` 可对应多个 `session`
- 一个 `session` 可绑定多个 `resource_attachment`
- 一个 `session` 可持续生成多个 `artifact`
- 一个 `session_channel` 对应一个主要交互视图

### 12.3 关键要求

- 会话切换不能串流
- 每个会话必须可独立暂停/重启/销毁
- 会话必须携带 project root 和运行环境元数据

## 13. 服务端职责重组

### 13.1 继续保留的旧职责

- 登录
- 认证
- 设备会话
- 配置保存
- 配置同步
- WebSocket 通知

### 13.2 新增职责

- session registry
- command routing
- desktop/mobile relay
- heartbeat state aggregation
- encrypted asset metadata index
- push notification trigger
- remote control audit trail

### 13.3 仍然不做的事

- 不替代桌面端执行主会话
- 不承担主要 Agent 运行容器
- 不把所有模型调用收口到服务端

## 14. FlowProbe 在 v2 中的位置

`FlowProbe` 现在属于 `Capability Layer` 中最关键的 AI 供给侧模块。

它要为上层提供：

- provider registry
- model pool
- routing target
- 本机兼容代理
- 调试与诊断结果
- token 与费用可视化

推荐关系：

- `WslAgentBridge` 与 `FlowProbe` 解耦
- Agent Host 只消费 `FlowProbe` 提供的稳定接入配置
- `FlowProbe` 保持桌面本机直连上游，不改成经服务端执行

## 15. 实施建议

### 15.1 第一阶段

- 建立新文档基线
- 新增 `agent_host` 目录
- 建立最小 `WslAgentBridge`
- 打通启动、读流、写流、停止

### 15.2 第二阶段

- 增加 prompt detector
- 增加 artifact harvester
- 增加 vital signs
- 增加桌面页会话管理入口

### 15.3 第三阶段

- 接入移动端远程控制
- 接入资源桥接
- 接入 YiboFile IPC
- 接入自愈动作

### 15.4 第四阶段

- 多 Agent 频道化
- 跨频道流转
- 语音意图
- 知识沉淀

## 16. 当前代码组织建议

建议新增以下目录：

```text
core/src/agent_host/
desktop/src-tauri/src/agent_bridge/
desktop/src/pages/Console/
desktop/src/pages/Agents/
desktop/src/pages/Sessions/
server/internal/session/
server/internal/ws/
server/internal/relay/
```

后续实现应优先遵循：

- Headless
- 解耦
- 会话优先
- 结构化事件优先
- 可观测优先
