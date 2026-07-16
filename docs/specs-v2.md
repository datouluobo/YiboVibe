# YiboVibe v2 产品与工程规格

Updated: 2026-05-24

更新时间：2026-05-24

## English Executive Summary

This document defines the current YiboVibe v2 product direction, module boundary, and system responsibilities.

YiboVibe v2 is designed as a Vibe Coding infrastructure stack centered on three surfaces:

- Desktop as the headless execution host
- Server as the signal, session, and sync hub
- Mobile as the remote console

Current key points:

- Existing `Flow*` modules remain in scope, but their roles are reorganized around the Vibe Coding backbone.
- The server is not a third-party AI gateway and is not the main execution host.
- The desktop app remains the primary execution environment for sessions, shells, and local resources.
- The mobile app is a remote control surface rather than a standalone execution client.

Readers who need the current public-facing short version should start with:

- [features_summary.md](features_summary.md)
- [public-docs.md](public-docs.md)
- [../server/README.md](../server/README.md)

The detailed sections below remain the canonical product and engineering specification for the v2 line.

## 1. 文档目的

本文档定义 YiboVibe v2 的新版产品定位、模块边界、三端职责和实施优先级。

它用于替代当前仅把 YiboVibe 视为“本地优先桌面生产力工具”的旧叙事，但不否定现有模块的存在价值。v2 的核心变化不是删除旧功能，而是把整套系统重组为以 `Vibe Coding` 为主线的多端开发者基础设施。

当前结论：

- 现有模块全部保留
- 服务端继续保留并升级
- 不存在已发布用户和历史兼容负担
- 后续可以直接统一程序名、仓库名、镜像名和部署命名

## 2. 产品定义

YiboVibe v2 是一套面向独立开发者与 AI 辅助程序员的 `Vibe Coding Tools` 基础设施。

它的核心目标不是单独提供某个 AI 页面，而是让开发者在桌面端、移动端、WSL、NAS 与本地文件环境之间，持续持有同一个可控、可观测、可恢复的编码执行上下文。

v2 的产品主线是：

- 桌面端作为 `Headless Agent Host`
- 服务端作为 `Signal + Session + Memory Hub`
- 移动端作为 `Remote Console`
- 现有 `Flow*` 模块作为能力层，为主线提供同步、规则、资产、输入与文件桥接能力

## 3. 核心愿景

### 3.1 愿景

打造专属于独立开发者与 AI 辅助程序员的 `Vibe Coding` 终极基础设施，让用户离开电脑后仍可低摩擦地：

- 查看当前项目与终端上下文
- 向桌面端 Agent 继续发令
- 管理多 Agent 会话
- 投喂本地/NAS 私有资料
- 在异常时远程接管、自愈、重启

### 3.2 设计哲学

系统遵循两条主原则：

- `Headless Host First`
- `Context Before Text`

解释：

- 不把桌面端仅看成带 UI 的本地应用，而是看成长期驻留、可宿主化、可桥接、可观测的本机执行底座
- 不只同步文本结果，而是同步开发状态、会话上下文、代码片段、错误现场、运行态信号与待确认动作

## 4. v2 产品边界

### 4.1 系统提供什么

YiboVibe v2 提供：

- Windows 桌面无头宿主
- 多 Agent 会话与远程控制
- WSL / 本机终端进程托管
- 远程终端输入注入与输出流截获
- 本地文件/NAS 资源桥接
- 上游 AI API 资产与本机代理控制
- 端到端加密同步与跨端控制台
- 远程观察、告警、自愈与重启

### 4.2 系统不做什么

YiboVibe v2 当前不把服务端定义为：

- 第三方模型统一托管执行端
- 云端代码执行平台
- 公有多租户 AI 网关
- 自动替代桌面端进行主业务执行的远程主机

核心执行仍固定在桌面端本机。

## 5. 模块策略

v2 不删除原有模块，但调整它们在产品中的层级。

### 5.1 一级核心主线

新增一级核心主线：

- `Vibe Coding Console`
- `Shadow Mode`
- `WslAgentBridge`
- `Multi-Agent Sessions`
- `Resource Bridge`
- `Agent Vital Signs`

这些能力共同构成 v2 的产品叙事中心。

### 5.2 原有模块的新版定位

| 模块 | v1 定位 | v2 定位 |
|------|---------|---------|
| `FlowDeck` | 概览页 | 升级为总控制台入口与全局仪表盘 |
| `FlowSnap` | 缩略语展开 | 演进为意图模板、命令片段和高频操作加速层 |
| `FlowHint` | 词库补全 | 演进为 prompt/snippet 候选增强层 |
| `FlowSync` | E2EE 剪贴板同步 | 升级为跨端资产与指令结果同步底座 |
| `FlowDrop` | 文件传输 | 升级为对话附件与资源投递能力 |
| `FlowRules` | 应用规则层 | 升级为按应用、项目、会话控制能力策略层 |
| `FlowKeys` | 键位映射 | 升级为桌面快捷发令与远程操作映射层 |
| `FlowProbe` | 本机 API 管理与转发 | 升级为上游模型与代理资产中心 |
| `Settings` | 偏好设置 | 升级为宿主、会话、桥接、网络与安全配置中心 |

## 6. 三端架构定位

### 6.1 服务端

服务端继续保留，且从“同步后端”升级为“信令与会话中枢”。

服务端负责：

- 登录与鉴权
- 设备会话
- WebSocket 长连接
- 桌面端与移动端之间的命令路由
- 会话元数据与状态同步
- 加密资产的索引、暂存与通知
- 运行心跳与告警转发
- 知识沉淀与全局对话资产管理

服务端不负责：

- 替代桌面端执行 Agent 主流程
- 承担第三方模型主调用宿主
- 直接取代 `FlowProbe` 的本机代理职责

### 6.2 桌面端

桌面端是系统真正的执行主机。

桌面端负责：

- 无头常驻运行
- 宿主化启动 WSL 或本机 Agent 进程
- 管理多会话 ConPTY / 标准流桥接
- 实时分析终端输出
- 注入远程输入
- 捕获上下文快照
- 提取代码资产
- 输出 Vital Signs
- 对接本地文件系统与 YiboFile IPC

### 6.3 移动端

移动端是远程控制台，不是轻量查看页。

移动端负责：

- 多频道会话切换
- 气泡流消息交互
- 快捷动作发令
- 会话观测
- 远程确认/拒绝/终止
- 告警接收
- 自愈控制

补充定位：

- 移动端不是全能远程开发工具，而是桌面端执行过程的低摩擦接管面板
- 电脑持续承担真实执行与上下文持有，移动端负责在离桌期间不中断消息收发、命令确认与异常接管
- 用户回到电脑后，应能继续在原桌面上下文里无缝衔接，而不是在手机上形成一套独立工作流

## 7. 五大核心 Vibe 模块

### 7.1 Context Projection

目标：

- 把桌面当前活跃开发情境压缩为可远程消费的上下文包

输入可能包括：

- 当前活动项目路径
- 当前活动文件
- 末尾代码片段
- 最近终端输出
- 最近错误堆栈
- 当前 Agent 状态

输出：

- 结构化上下文快照
- 可直接投喂给远程 Agent 的会话上下文载荷

### 7.2 State-Aware Action Bar

目标：

- 降低移动端处理交互式终端确认的成本

典型识别场景：

- `[y/n]`
- `Press Enter to continue`
- `Enter path:`
- `Select file`
- `Retry?`

输出形式：

- 移动端动作卡片
- 一键确认/拒绝/终止
- 可选的自定义输入槽

### 7.3 Artifact Auto-Harvesting

目标：

- 自动从终端与消息流中提取可复用产物

候选资产包括：

- Markdown 代码块
- Patch 片段
- Shell 命令
- 错误报告
- 配置片段
- 路径与文件引用

提取后的资产可用于：

- 一键复制
- 存入 `FlowSync` 同步剪贴板
- 推送到其他 Agent 会话
- 进入知识沉淀区

### 7.4 Resource Bridge

目标：

- 把本地/NAS 私有资源安全送达正在后台运行的 Agent

桥接来源包括：

- 本地文件
- YiboFile 私有索引
- NAS 文件
- PDF / JSON / 日志 / 配置文件

原则：

- 优先复用桌面本地读取能力
- 不把移动端变成直接文件访问宿主

### 7.5 Agent Vital Signs

目标：

- 让远程用户对后台 Agent 保持可观测性

核心信号：

- CPU
- 内存
- 运行时长
- 最后输出时间
- Token 消耗速率
- 当前状态
- 心跳是否超时

## 8. WSL 与多 Agent 方向

### 8.1 WSL 宿主化

v2 需要把 WSL 视为首要执行环境之一。

要求：

- 可按需拉起
- 可注入标准输入
- 可异步读取标准输出/错误输出
- 可识别挂起、无响应和退出
- 可在需要时软重启或硬重置

### 8.2 多 Agent 并行

系统应支持多个并行会话，例如：

- `Hermes-Backend`
- `ClaudeCode-Frontend`
- `Docs-Writer`
- `Refactor-Lab`

要求：

- 每个会话拥有独立状态
- 支持频道式切换
- 支持跨会话转发上下文与资产
- 支持会话级别启停与诊断

## 9. FlowProbe 的新版职责

`FlowProbe` 不再只是“唯一 AI 能力”，而是升级为整个 v2 的模型与路由资产中心。

职责包括：

- 管理上游 API 端点
- 维护模型池
- 兼容协议识别
- 本机代理监听与鉴权
- 日志、Token、费用、延迟统计
- 为桌面端 Agent Host 提供稳定的上游连接配置

边界保持不变的部分：

- `FlowProbe` 请求仍由当前桌面设备直接发往上游
- 不经过 NAS
- 不经过服务端代理主调用

## 10. 信息架构建议

建议在 v2 控制台中按以下层级组织导航：

- `Console`
- `Agents`
- `Sessions`
- `Resources`
- `FlowProbe`
- `FlowSync`
- `FlowDrop`
- `Rules`
- `Keys`
- `Settings`

原则：

- `Vibe Coding` 相关入口前置
- 现有能力模块继续存在
- 原有模块从平行主业务调整为主线能力节点

## 11. 安全与控制原则

### 11.1 执行权原则

- 真正执行始终在桌面端
- 服务端不替代桌面端执行敏感操作
- 移动端只发起控制意图，不直接成为资源执行主机

### 11.2 远程控制原则

- 高危操作必须二次确认
- WSL 重置与进程强杀需要明确标识风险
- 自愈前优先保留现场快照

### 11.3 资产原则

- 跨端同步的敏感文本、代码、密钥与日志默认按加密资产处理
- 服务端只承担必要路由、存储和通知职责

## 12. 当前实施优先级

### 12.1 第一优先级

- `WslAgentBridge`
- `ConPTY / stdio bridge`
- `remote stdin injection`
- `stdout/stderr async capture`
- `session state detection`
- `artifact extraction`
- `heartbeat / vitality channel`

### 12.2 第二优先级

- `YiboFile IPC bridge`
- `Context Projection`
- `Resource Bridge`
- `Action Bar protocol`
- `mobile session console`

### 12.3 第三优先级

- `voice-to-intent`
- `prompt card library`
- `cross-session artifact push`
- `knowledge harvesting`

## 13. 与旧规格文档的关系

- 仓库内旧的 v1 相关说明只应视为历史背景材料，不再作为当前公开产品说明入口
- 本文档定义的是 v2 阶段的主线目标与正式重组方向
- 在程序名、仓库名与镜像名完成统一之前，仓库内仍可能同时存在 v1/v2 叙事

后续应以本文档和对应架构文档为准推进新功能设计。
