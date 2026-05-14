# Flow* 模块 v2 定位映射

更新时间：2026-05-12

本文档将每个 Flow* 模块映射到 [specs-v2.md](/F:/Download/GitHub/YiboVibe/docs/specs-v2.md) 定义的 v2 主线角色。

---

## 1. FlowDeck → v2 总控台

当前状态：`desktop/src/pages/FlowDeck.tsx`

v2 角色：

- 从独立页面升级为 v2 总控台入口
- 展示所有活跃 Agent 会话状态总览
- 链接到 Console、Agents、Sessions 子页面
- 提供全局状态一目了然的总览面板

变化：

- 保持现有功能不变
- 增加主导航路由
- 增加活跃会话和告警区域

---

## 2. FlowSnap → 命令模板化

当前状态：`core/` hook_manager 中

v2 角色：

- 从纯文本替换扩展为命令模板层
- 支持复杂模板（重复结构、多行输出）
- 支持会话注入：模板结果可直接输入当前 Session
- 保留本地字典和自定义规则

变化：

- 当前 bugfix 已完成，保持稳定
- 增加模板化能力（v2 第二阶段）

---

## 3. FlowHint → 候选增强层

当前状态：`desktop/src-tauri/src/lib.rs`（Hint 窗口 + 事件循环）

v2 角色：

- 从弹出提示扩展为 Agent 候选输出区域
- 候选项可: 预览 → 确认 → 发送到 Session
- 支持多候选切换
- 与 Action Bar 协议集成

变化：

- 保持 Hint 窗口共享能力
- 增加与 Session 的交互链路

---

## 4. FlowSync → 资产同步底座

当前状态：`desktop/src/pages/FlowSync.tsx` + `core/src/sync/`

v2 角色：

- 从 E2EE 同步工具升级为多端资产同步底座
- 服务端作为 Sync Hub 的一部分
- 同步会话产物、配置、加密资产
- 与 Resource Bridge 配合：资源跨端投递

变化：

- 保持现有 E2EE、vault、staging 功能
- 增加资产索引和跨端通知
- 继续使用 FlowSync 命名

---

## 5. FlowDrop → 资源投递能力

当前状态：`desktop/src-tauri/src/lib.rs` + `core/src/p2p.rs`

v2 角色：

- 从 P2P 文件传输升级为资源投递通道
- 支持本地 ↔ WSL ↔ 服务端 ↔ 移动端投递
- 与 Resource Bridge 对接
- 与 FlowSync staging 集成

变化：

- 保持 P2P 传输能力
- 增加 Resource Bridge 集成层

---

## 6. FlowRules → 会话策略层

当前状态：`desktop/src/pages/FlowRules.tsx` + `core/src/rules.rs`

v2 角色：

- 从按键规则管理升级为会话策略层
- 策略可绑定到特定 Agent 或 Session
- 支持远程策略下发
- 紧急操作的白名单/黑名单

变化：

- 保持 app 规则和默认规则
- 增加 session 级别作用域
- 增加远程策略同步

---

## 7. FlowKeys → 远程操作映射层

当前状态：`desktop/src/components/FlowKeys/` + `core/src/hook_manager.rs`

v2 角色：

- 从本地键位映射扩展为远程操作映射层
- 移动端发令 → FlowKeys 解析 → 本地执行
- 支持映射规则远程同步
- 紧急操作映射独立于常规映射

变化：

- 保持本地键位映射功能
- 增加远程命令到本地动作的映射层

---

## 8. FlowProbe → 模型与路由资产中心

当前状态：`desktop/src/pages/FlowProbeSources.tsx` + `FlowProbeRelay.tsx` + `desktop/src-tauri/src/probe.rs`

v2 角色：

- 从 AI API 测试工具升级为上游 AI 供给侧中心
- 管理 provider registry、model pool、routing target
- 为 Agent Host 提供稳定的接入配置
- 保持本机直连上游，不经过服务端

变化：

- 保持现有 UI 布局（已重新设计）
- 增加模型池和路由管理
- 增加 Agent Host 配置输出

---

## 总结

所有 Flow* 模块均保留，但调整了在 v2 主线中的位置：

| 模块 | v1 定位 | v2 角色 | 变化量 |
|------|---------|---------|--------|
| FlowDeck | 功能启动页 | v2 总控台 | 中 |
| FlowSnap | 文本替换 | 命令模板层 | 小 |
| FlowHint | 弹出提示 | 候选增强层 | 中 |
| FlowSync | E2EE 同步 | 资产同步底座 | 中 |
| FlowDrop | P2P 传文件 | 资源投递通道 | 中 |
| FlowRules | 按键规则 | 会话策略层 | 中 |
| FlowKeys | 键位映射 | 远程操作映射层 | 中 |
| FlowProbe | AI 测试工具 | 模型资产中心 | 中 |

核心原则：

- 保持现有功能不破坏
- 逐步增加 v2 集成层
- 遵循"不替代桌面端执行"的安全边界
