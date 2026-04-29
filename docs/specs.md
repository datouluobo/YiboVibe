# YiboFlow 产品与工程规格

更新时间：2026-04-28

## 1. 文档目的

本文档定义 YiboFlow 当前版本的产品边界、模块职责、运行架构、配置策略和近期实施路线。它只描述当前项目真实存在的能力和已经确认的演进方向，不再保留已取消功能的实现承诺。

## 2. 产品定义

YiboFlow 是一套以本地优先和私有同步为核心的桌面生产力工具。当前主形态是：

- Windows 桌面端
- Rust 核心引擎
- Tauri 配置与管理界面
- Go 服务端，用于登录、认证、配置保存与同步

当前保留的核心能力：

- `FlowSnap`：缩略语展开
- `FlowHint`：词库补全
- `FlowSync`：端到端加密剪贴板同步
- `FlowDrop`：跨设备文件传输
- `FlowRules`：按应用控制功能开关
- `FlowKeys`：键位映射与快捷键配置
- `FlowProbe`：本机直连 AI 服务 API 测试工具

当前不在产品范围内的能力：

- AI 润写
- AI 改写
- AI 总结
- AI 对话生成
- AI 自动写回
- AI 预测输入

说明：

- `FlowWriter`、`FlowPredict` 仅作为已取消模块在文档中留档，不属于当前实现范围。
- AI 相关运行时能力已收束为 `FlowProbe`，且仅用于测试第三方 API，不参与主业务链路。

## 3. 当前模块矩阵

| 模块 | 作用 | 当前状态 |
|------|------|----------|
| `FlowDeck` | 仪表盘与全局概览 | 已实现 |
| `FlowSnap` | 缩略语触发后自动替换文本 | 已实现 |
| `FlowHint` | 基于词库的候选补全 | 部分实现，继续完善 |
| `FlowSync` | E2EE 剪贴板同步 | 已实现 |
| `FlowDrop` | 文件发送与接收 | 已实现 |
| `FlowRules` | 按应用控制模块启停 | 已实现，仍可继续迭代 |
| `FlowKeys` | 键盘映射配置 | 已实现 |
| `FlowProbe` | 本机直连 API 测试 | 已实现并已收口 |
| `Settings` | 主题、语言、导入导出、全局偏好 | 已实现 |

## 4. 架构边界

### 4.1 客户端边界

客户端由两层组成：

- `core/`
  - Rust 常驻核心
  - 负责 Hook、剪贴板、规则、加密、P2P、本地账户、同步客户端等
- `desktop/` + `desktop/src-tauri/`
  - Tauri UI 与桥接命令层
  - 负责管理页面、配置交互、FlowProbe 本机测试

### 4.2 服务端边界

服务端只负责：

- 登录
- 认证
- 设备会话
- Vault / 配置保存
- Vault / 配置同步
- WebSocket 通知与信令

服务端不负责：

- 第三方 AI API 转发
- 模型调用路由
- 任何 AI 文本生成、润写、补全业务

### 4.3 FlowProbe 边界

`FlowProbe` 是唯一保留的 AI 相关能力，但它不是系统运行链路的一部分。其职责固定为：

- 测试目标地址连通性
- 校验认证信息
- 拉取模型列表
- 识别兼容协议
- 输出标准化诊断结果

`FlowProbe` 的请求发起方式固定为：

- 当前桌面设备直接请求目标地址
- 不经过 NAS
- 不经过 YiboFlow 服务端

NAS 在 `FlowProbe` 里只是一类可测试地址，不是中转节点。

## 5. 关键模块说明

### 5.1 FlowSnap

目标：

- 在全局输入环境中识别触发词
- 将触发词替换为目标文本

当前实现原则：

- 低延迟
- 允许按应用启停
- 支持与输入法状态共存

### 5.2 FlowHint

目标：

- 基于词库做前缀补全
- 候选窗跟随输入场景
- 允许按应用绑定启用策略

当前定位：

- 这是保留能力
- 但仍处于继续打磨的阶段
- 不与 AI 生成能力绑定

### 5.3 FlowSync

目标：

- 在多设备之间同步剪贴板内容
- 传输前先加密
- 服务端只持有密文和必要元数据

当前安全基线：

- 主密码派生密钥
- 端到端加密
- 服务端不处理明文内容

### 5.4 FlowDrop

目标：

- 在设备之间进行文件发送与接收
- 支持状态管理、历史记录和清理策略

当前原则：

- 服务端负责协调与记录
- 数据路径与同步能力解耦

### 5.5 FlowRules

目标：

- 按应用决定某项功能是否生效
- 作为 FlowSnap / FlowHint / FlowSync / FlowKeys 的统一规则层

当前原则：

- 默认规则 + 应用覆盖
- UI 层面以矩阵式管理为目标

### 5.6 FlowKeys

目标：

- 配置源键和目标键映射
- 管理多套键位方案

这是当前独立保留的输入增强模块，不依赖 AI 能力。

### 5.7 FlowProbe

目标：

- 作为本机直连 API 测试工具，验证第三方 AI 服务接口

支持的协议类型：

- `OpenAI Compatible`
- `Ollama`
- `Gemini OpenAI Compatible`
- `Anthropic`
- `Custom`

支持的目标类型：

- 本机地址
- 局域网地址
- 公网地址

标准输出字段：

- `code`
- `summary`
- `detail`
- `latency_ms`
- `detected_protocol`
- `auth_status`
- `model_count`

建议结果码集合：

- `OK_CONNECTED`
- `OK_MODELS_FOUND`
- `ERR_TIMEOUT`
- `ERR_UNAUTHORIZED`
- `ERR_NOT_FOUND`
- `ERR_PROTOCOL_MISMATCH`
- `ERR_EMPTY_MODELS`
- `ERR_NETWORK`
- `ERR_INVALID_URL`

## 6. 配置与密钥策略

### 6.1 普通配置

普通配置包括但不限于：

- 通用应用设置
- 主题和语言
- FlowSnap 数据
- FlowRules 数据
- FlowHint 词库与启用状态
- FlowKeys 配置
- FlowProbe 测试目标列表

这些数据可以进入配置保存与同步范围。

### 6.2 本机私有数据

以下数据默认只保存在本机：

- 主密码派生出的本地敏感数据
- 登录态缓存
- `FlowProbe` 的 API Key / Secret

`FlowProbe` 的本机密钥文件使用独立存储，不随普通配置同步。

## 7. 服务端规格

### 7.1 当前职责

服务端当前应提供：

- 用户注册、登录、认证
- Token 刷新
- 设备管理
- Vault / 配置读写
- 文件与同步相关 API
- WebSocket 通知

### 7.2 当前网关要求

当前 `Caddyfile` 的职责应该是：

- 将 `/api/*` 转发到 Go 后端
- 对其他路径做简单响应或保留给后续静态站点

当前网关不应再包含：

- `/v1/*` AI 代理
- Ollama 反向代理
- 第三方模型 API 转发入口

### 7.3 当前部署形态

服务端目录下当前包含：

- Go 服务
- PostgreSQL
- Redis
- Caddy 网关配置
- Docker Compose 部署文件

默认部署方式仍以 Docker Compose 为主。

## 8. 当前目录结构

下面只描述当前仓库中真实存在且需要维护的关键目录。

```text
YiboFlow/
├── core/
│   ├── src/
│   │   ├── api.rs
│   │   ├── backup.rs
│   │   ├── clipboard.rs
│   │   ├── config.rs
│   │   ├── crypto.rs
│   │   ├── dictionary.rs
│   │   ├── hook_manager.rs
│   │   ├── local_auth.rs
│   │   ├── p2p.rs
│   │   ├── rules.rs
│   │   ├── ws.rs
│   │   └── sync/
├── desktop/
│   ├── src/
│   │   ├── components/
│   │   ├── locales/
│   │   ├── pages/
│   │   └── App.tsx
│   └── src-tauri/
│       └── src/
│           ├── lib.rs
│           └── probe.rs
├── server/
│   ├── cmd/
│   ├── internal/
│   ├── Caddyfile
│   ├── docker-compose.yml
│   └── Dockerfile
└── docs/
```

说明：

- `core/src/ai/` 已不再承载运行时代码能力，不应重新扩展为通用 AI 客户端层。
- 新的 Probe 逻辑位于 Tauri 侧，而不是回到 `core`。

## 9. 导入导出

系统保留导入导出能力。

导出对象应包括：

- 配置
- 词库
- 规则
- FlowProbe 测试目标列表

默认不导出的内容：

- `FlowProbe` API Key / Secret
- 本地登录敏感缓存

## 10. 可验证的构建基线

当前变更和后续迭代应至少满足：

- `cargo check -p yiboflow-core`
- `cargo check -p tauri-app`
- `desktop` 目录下 `npm run build`

服务端变更应至少满足：

- Go 服务可构建
- Docker 镜像可构建
- Compose 可正常拉起
- `/api/*` 代理可用

## 11. 已取消模块留档

### 11.1 FlowWriter

`FlowWriter` 已取消，不再规划为产品模块，不再承担任何润写或生成能力。

### 11.2 FlowPredict

`FlowPredict` 已取消，不再规划为产品模块，不再承担任何预测式 AI 输入能力。

## 12. 近期路线

### 已完成收口

- 移除通用 AI 运行时能力
- 移除服务端 AI 网关职责
- 将 AI 相关能力收束为 `FlowProbe`
- 增加 Anthropic 协议支持
- 明确测试目标同步与本机密钥分离策略

### 下一阶段重点

1. 继续完善 `FlowHint` 的词库和交互体验。
2. 继续完善 `FlowRules` 的矩阵化配置体验。
3. 统一客户端与服务端的配置同步语义。
4. 保持 `FlowProbe` 只做测试工具，不回流为业务 AI 能力。

## 13. 文档约束

后续所有新增文档、页面文案、部署说明必须遵守以下规则：

1. 不得把服务端描述为 AI 网关。
2. 不得把 `FlowProbe` 描述为业务 AI 引擎。
3. 不得重新引入 FlowWriter / FlowPredict 的产品承诺，除非先更新本规格。
4. 任何新增协议支持，先补 `FlowProbe` 规格，再补实现。
