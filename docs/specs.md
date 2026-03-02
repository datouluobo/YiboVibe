# YiboFlow 项目开发规范文档 (v2.0)

> **文档性质**：项目技术契约，指导全平台开发实施。
> **版本历史**：v1.0 初稿 → v1.3 评审修订 → **v2.0 功能矩阵重构**（统一命名体系、新增 AI 引擎规范、FlowHint/FlowRules/导入导出体系）
> **适用范围**：当前为单文档综合规范。随项目推进，各章节可按需拆分为独立子文档。

---

## 1. 项目愿景与定义

**YiboFlow** 是一款以私有 NAS (Synology) 为底座的跨平台生产力增强套件。

* **核心功能**：自定义缩略语全局替换、词库智能补全、AI 文本润色与预测、端到端加密 (E2EE) 剪切板同步、多端定向文件互传。
* **生态定位**：作为 **Yibo 系列** 的底层通信与自动化引擎，需具备被 **YiboFile (C#)** 集成调用的能力。

### 1.1 非功能性需求 (NFR)

| 指标 | 目标值 | 备注 |
|------|--------|------|
| 缩略语替换延迟 | < 50ms | 从击键到替换完成，用户无感知延迟 |
| 智能补全候选延迟 | < 100ms | 从按键到候选窗弹出 |
| 剪切板同步端到端延迟 | < 3s (局域网) / < 8s (公网) | 含加密、传输、解密全链路 |
| 单文件最大传输体积 | ≥ 4GB | 需支持断点续传 |
| 并发设备数上限 | 每用户 ≤ 10 台 | 首版目标，后续可调 |
| 并发用户数 | ≤ 20 | 私有 NAS 家庭/小团队场景 |
| 系统资源占用 | 常驻内存 < 80MB, CPU 空闲 < 1% | Rust Core 托盘进程 |

### 1.2 目标平台

> 不预设最低版本硬限制。仅在开发过程中遇到特定 API 依赖时，按实际情况标注并记录。

* **Windows**：主力开发平台
* **iOS / Android**：移动端（iOS 暂无开发者账号，延后验证）
* **NAS**：Synology DSM，Docker 部署

---

## 2. 产品命名体系

YiboFlow 采用统一的 `Flow` 前缀英文命名 + 中国古典意象中文命名的双语命名体系。

### 2.1 功能模块命名表

| 功能 | 英文名 | 中文名 | 典故/意蕴 | 功能定义 | 开发状态 |
|------|--------|--------|----------|---------|---------|
| 仪表盘 | **FlowDeck** | **布告** | 衙门布告栏，一览全局 | 全局状态总览、设备监控、AI 引擎连通性 | ✅ 已实现 |
| 魔法短语 | **FlowSnap** | **锦囊** | 锦囊妙计 | 精确匹配 trigger → 整句替换 | ✅ 已实现 |
| 智能补全 | **FlowHint** | **灵犀** | 心有灵犀一点通 | 词库前缀补全 → 候选窗 → Tab 上屏 | 🔜 待开发 |
| AI 润色 | **FlowWriter** | **妙笔** | 妙笔生花 | 选中文本 → AI 重写润色 → 写回原位 | 🔜 待开发 |
| AI 预测 | **FlowPredict** | **先知** | 先知先觉 | AI 根据上下文预测下一段输入 | 🔜 待开发 |
| 云剪贴板 | **FlowSync** | **烽火** | 烽火连城，一端燃起全线响应 | E2EE 端到端加密剪贴板实时同步 | ✅ 已实现 |
| 文件互传 | **FlowDrop** | **走镖** | 镖局护送，安全押运 | P2P 加密跨设备文件投送 | ✅ 已实现 |
| 规则中心 | **FlowRules** | **中枢** | 神经中枢 | 按应用×功能的细粒度权限矩阵 | 🔜 待重构 |
| 偏好设定 | **Settings** | **偏好** | — | 主题/语言/AI 引擎/备份恢复 | ✅ 已实现 |

### 2.2 Desktop UI 侧栏布局

侧栏按功能逻辑分为四组，每个导航项悬停时显示 Tooltip 功能简介（中英文双语）：

```
┌──────────────────────┐
│  ◉ YiboFlow          │
│                      │
│  📊 FlowDeck · 布告   │  ← 全局状态总览与设备连接监控
│  ─────────────────── │     Tooltip: "全局状态总览与设备连接监控"
│  ⌨️ FlowSnap · 锦囊   │  ← 第一组：输入增强
│  ✨ FlowHint · 灵犀   │
│  🖊️ FlowWriter · 妙笔 │  ← AI 智能（与输入增强相邻）
│  🔮 FlowPredict · 先知│
│  ─────────────────── │
│  📋 FlowSync · 烽火   │  ← 第二组：数据传输
│  🚀 FlowDrop · 走镖   │
│  ─────────────────── │
│  🛡️ FlowRules · 中枢  │  ← 第三组：系统管理
│  ⚙️ Settings · 偏好   │
└──────────────────────┘
```

**分组逻辑**：
- **第一组**：输入增强全家桶（锦囊 → 灵犀 → 妙笔 → 先知，能力递进）
- **第二组**：数据传输（烽火 + 走镖）
- **第三组**：系统管理（中枢 + 偏好）

### 2.3 侧栏 Tooltip 文本

| 侧栏项 | 中文 Tooltip | 英文 Tooltip |
|--------|-------------|-------------|
| FlowDeck · 布告 | 全局状态总览与设备连接监控 | System status overview and device monitoring |
| FlowSnap · 锦囊 | 自定义缩略语，打出关键词即刻展开为完整文本 | Custom text expansion — type a keyword, get full text |
| FlowHint · 灵犀 | 智能词库补全，按 Tab 上屏候选词 | Dictionary-powered inline completion, Tab to accept |
| FlowWriter · 妙笔 | 选中文本，AI 一键润色重写 | Select text, AI rewrites with one hotkey |
| FlowPredict · 先知 | AI 根据上下文预测你接下来要输入的内容 | AI predicts your next input based on context |
| FlowSync · 烽火 | E2EE 端到端加密剪贴板实时同步 | E2EE real-time clipboard sync across all devices |
| FlowDrop · 走镖 | P2P 跨设备安全文件极速传输 | P2P encrypted cross-device file transfer |
| FlowRules · 中枢 | 按应用精细控制每个功能模块的生效范围 | Per-app fine-grained control over all modules |
| Settings · 偏好 | 主题、语言、AI 引擎与全局偏好配置 | Theme, language, AI engine and global preferences |

---

## 3. 系统架构

### 3.1 技术栈

| 组件 | 技术选型 | 关键职责 |
| --- | --- | --- |
| **Server (NAS)** | Go (Gin) + PostgreSQL + Redis | 多用户鉴权、WebSocket 信令中心、TTL 管理 |
| **Core (Win)** | **Rust 独立进程** | **系统托盘常驻**：键盘 Hook、剪切板监听、加密引擎、文件传输、IPC 服务、FlowHint 候选窗 |
| **Desktop UI** | **Tauri (Rust + React)** | 配置管理面板，与 Core 进程通过 IPC 通信 |
| **Mobile** | Flutter + 原生扩展 | App 处理大文件与同步；iOS Keyboard Extension 需用 **原生 Swift** 实现 |
| **Eco-Link** | IPC (Named Pipe) | YiboFile (C#) 调用 YiboFlow Core 的集成通道 |

### 3.2 进程架构（Windows）

```
┌──────────────────────────────────┐
│  yiboflow-core.exe (Rust)        │  ← 系统托盘常驻, 开机自启
│  ┌────────────────────────────┐  │
│  │ 键盘 Hook 模块              │  │
│  │ 剪切板监听模块              │  │
│  │ AES-256-GCM 加密引擎       │  │
│  │ 文件传输引擎 (TCP + 断点续传)│  │
│  │ FlowHint 候选悬浮窗引擎     │  │
│  │ AI 引擎适配层 (OpenAI 兼容) │  │
│  │ Named Pipe IPC Server      │  │
│  └────────────────────────────┘  │
└──────┬───────────────────┬───────┘
       │ IPC               │ IPC
┌──────▼────────┐   ┌──────▼────────┐
│ Tauri UI       │   │ YiboFile (C#) │
│ (配置/管理面板) │   │ (未来集成)     │
└───────────────┘   └───────────────┘
```

**设计要点**：
- Core 与 UI 进程分离，Core 可独立运行，UI 关闭不影响后台功能
- YiboFile 无需启动 Tauri，直接与 Core 进程 IPC 通信
- Core 进程负责全部业务逻辑，UI 仅为配置界面的薄壳
- FlowHint 候选悬浮窗由 Core 进程直接管理（需跨应用渲染）

### 3.3 服务端部署

| 项目 | 规格 |
|------|------|
| 部署方式 | Docker 容器 (docker-compose) |
| 宿主机 CPU | AMD EPYC 7272 (x86_64) |
| 容器编排 | Go Server + PostgreSQL 15+ + Redis 7+ |
| 数据持久化 | Docker Volume 挂载至 NAS 存储池 |

### 3.4 移动端架构说明

* **Flutter 主 App**：处理剪切板同步 UI、文件接收预览、缩略语配置管理
* **iOS Keyboard Extension**：
  - 必须使用 **原生 Swift** 开发（Flutter 不支持直接编写 Extension）
  - 通过 **App Group** 与主 App 共享数据
  - 内存上限约 70MB，需严格控制资源使用
  - **当前状态**：暂无 iOS 开发者账号，此部分延后至获取账号后再验证
* **Android 输入法**：可通过 Flutter Method Channel 桥接原生实现

---

## 4. 核心功能实现逻辑

### 4.1 FlowSnap 锦囊 — 缩略语智能替换

#### 触发与执行

* **触发机制**：监听用户输入的 `prefix` (如 `/`, `;`, 可自定义) + `keyword`
* **执行动作**：检测匹配后发送 `Backspace` × n → 读取解密内容 → 替换输出
* **性能要求**：端到端延迟 < 50ms

#### 替换策略（用户可配置）

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **模拟按键** (默认) | 逐字符发送键盘事件 | 通用文本编辑器 |
| **剪切板粘贴** | 写入剪切板后模拟 Ctrl+V | 富文本编辑器 (Word, Notion 等) |

> 用户可在设置中选择默认策略，也可通过 FlowRules 中枢按应用单独配置。

#### 安全机制

* **应用控制**：通过 FlowRules 中枢按应用控制启用/禁用（详见第 5 章）
* **撤销 (Undo)**：替换后保留最近一次替换的原始文本，`Ctrl+Z` 可还原，窗口期 5 秒
* **IME 兼容**：检测输入法组合窗口状态，IME 处于组合/候选状态时暂停匹配

### 4.2 FlowHint 灵犀 — 词库智能补全

#### 功能定义

基于词库的**前缀匹配**，在光标附近弹出候选窗，用户按 Tab 确认上屏。与 FlowSnap 锦囊的区别：

| 维度 | FlowSnap 锦囊 | FlowHint 灵犀 |
|------|--------------|--------------|
| 触发时机 | 精确匹配整个 trigger 后自动替换 | 持续前缀匹配，每次按键重新计算候选 |
| 视觉反馈 | 无（直接替换） | 光标旁候选悬浮窗 |
| 上屏方式 | 自动替换 | 用户主动按 Tab 确认 |
| 词库 | 全局统一 | **按应用分组绑定**（通过 FlowRules 中枢） |
| 默认状态 | 默认启用 | **默认关闭**（需先建词库） |

#### 候选窗交互规范

**渲染方式**：独立无边框、始终置顶、鼠标穿透的悬浮窗（第一阶段：纯候选窗；第二阶段：补充光标后虚影文字）。

**操作键位**：

| 操作 | 默认键 | 说明 |
|------|--------|------|
| 接受当前候选 | `Tab` | 可在 FlowRules 中枢按应用自定义 |
| 上移候选 | `↑` | 仅在候选窗可见时劫持，不可见时放行 |
| 下移候选 | `↓` | 同上 |
| 取消/关闭候选 | `Esc` | 关闭候选窗，继续正常输入 |
| 按序号选择 | **不使用** | 避免与输入法数字候选冲突 |

**关键原则**：候选窗不可见 = 完全透明，所有按键原样放行，用户感知不到 FlowHint 存在。

#### 可配置参数

| 参数 | 默认值 | 级别 | 说明 |
|------|--------|------|------|
| `min_trigger_chars` | `2` | 词库级 / 全局 | 输入满 N 个字符后才开始匹配 |
| `max_candidates` | `5` | 全局 | 候选窗最多显示条目数 |
| `debounce_ms` | `50` | 全局 | 每次按键后等待时间，防止高速打字时频繁刷新 |

#### 词库体系

**存储位置**：
- 内置词库：`%APPDATA%/YiboFlow/dictionaries/builtin/`
- 用户词库：`%APPDATA%/YiboFlow/dictionaries/custom/`

**标准词库格式** (JSON)：

```json
{
  "id": "cmd_commands",
  "name": "CMD 命令词库",
  "description": "Windows 命令提示符常用命令补全",
  "version": "1.0",
  "author": "YiboFlow Built-in",
  "min_trigger_chars": 2,
  "entries": [
    {
      "prefix": "pi",
      "candidates": ["ping", "ping 127.0.0.1", "pip install"]
    },
    {
      "prefix": "ipc",
      "candidates": ["ipconfig", "ipconfig /all", "ipconfig /flushdns"]
    }
  ]
}
```

**首批内置词库计划**：

| 词库文件 | 绑定场景 | 条目量（估） |
|---------|---------|------------|
| `cmd.json` | cmd.exe | ~80 |
| `git.json` | 通用（任何终端） | ~100 |
| `general_zh.json` | 通用 | ~200 |

> 更多词库（powershell, docker, ffmpeg, curl, kubectl 等）作为后续候选，由需求驱动逐步添加。

**词库管理功能**（灵犀页面内）：

| 操作 | 内置词库 | 自定义词库 |
|------|---------|----------|
| 查看词条 | ✅ | ✅ |
| 编辑词条 | ❌ | ✅ |
| 添加词条 | ❌ | ✅ |
| 删除词条 | ❌ | ✅ |
| 启用/禁用 | ✅ | ✅ |
| 删除整个词库 | ❌ | ✅ (二次确认) |
| 另存为自定义副本 | ✅ | — |

"另存为自定义"支持用户基于内置词库修改，不破坏原始数据。

### 4.3 FlowWriter 妙笔 — AI 文本润色（待开发）

**功能定义**：选中文本 → 按全局快捷键 → AI 润色重写 → 直接替换回原位置。

**技术流程**：`读取剪贴板选中内容 → 调用 AI 引擎 → 获得润色结果 → 模拟 Ctrl+V 写回`

**触发方式**：用户可自定义的全局快捷键（默认建议 `Ctrl+Shift+R`）。

**AI 引擎**：共享统一 AI 引擎配置（详见第 6 章）。

### 4.4 FlowPredict 先知 — AI 预测补全（待开发）

**功能定义**：AI 根据当前上下文预测用户接下来要输入的内容，类似 GitHub Copilot 的体验。

**触发方式**：用户可自定义的全局快捷键（默认建议 `Ctrl+Shift+P`），或持续被动预测模式。

**AI 引擎**：共享统一 AI 引擎配置（详见第 6 章）。

### 4.5 FlowSync 烽火 — 剪切板 E2EE 同步

#### 加密架构（MK/DK 分层密钥）

```
用户密码 ──Argon2id(salt)──▶ Master Key (MK)
                                │
                          ┌─────┴─────┐
                          ▼           ▼
                    Data Key (DK)  Wrapped DK
                    (每次随机生成)  (MK 加密后存储于服务端)
                          │
                    AES-256-GCM(DK, nonce)
                    加密剪切板内容
```

**关键设计**：
- **KDF**：Argon2id，参数 `m=64MB, t=3, p=4`
- **Data Key**：每条剪切板记录使用独立随机 DK，DK 用 MK 包裹后一并存储
- **密码修改**：仅需用新 MK 重新包裹所有 DK，**无需重加密历史数据**
- **Nonce 管理**：每次加密随机生成 12 字节 nonce，与密文一起存储
- **NAS 零知识**：服务端仅存储密文和 Wrapped DK，不触碰明文和 MK

#### 同步流程

* **文本**：加密后直传 NAS，各端拉取后解密
* **图片**：加密后存 NAS 文件系统，生成 UUID 引用，各端按需拉取解密
* **移动端唤醒**：NAS 发送静默推送 → App 后台唤醒拉取 → 失败则待用户打开 App 时补齐

### 4.6 FlowDrop 走镖 — 文件互传与 TTL

#### 传输协议

* **方案**：基于 **TCP 直连**（同一局域网 / VPN 可达场景）
  - NAS 作为设备发现与连接协调的信令中心
  - 设备不可直连时，NAS 作为临时中转
* **断点续传**：文件分块传输（默认 1MB），每块完成后记录偏移量
* **完整性校验**：SHA-256 全文校验和
* **传输加密**：文件传输通道不加密（私有局域网场景，信任网络环境）

#### TTL 自动销毁

* 文件传输记录和中转文件根据 TTL 设定自动过期
* 过期后：抹除 NAS 上的物理文件 + 删除数据库记录
* TTL 可由发送端设置，默认 24 小时

---

## 5. FlowRules 中枢 — 应用规则中心

### 5.1 设计理念

从简单的"应用黑名单"进化为**每个功能模块 × 每个应用**的细粒度权限矩阵。支持：
- 某个功能对某个程序不生效（黑名单）
- 某个功能仅对某个程序生效（白名单）
- FlowHint 灵犀可绑定特定词库到特定应用

### 5.2 矩阵 UI 设计

```
             FlowSnap  FlowHint  FlowWriter FlowPredict FlowSync
全选/反选      [☑]       [☐]       [☑]        [☑]        [☑]
────────────────────────────────────────────────────────────────
(默认)         ✅         ⊘         ✅         ✅          ✅
cmd.exe        ❌         ⚙️         ❌         ❌          ✅
code.exe       ✅         ⚙️         ✅         ✅          ✅
lol.exe        ❌         ❌         ❌         ❌          ❌
────────────────────────────────────────────────────────────────
                                                [+ 添加应用规则]
```

### 5.3 开关状态

| 状态 | 视觉 | 含义 | 交互 |
|------|------|------|------|
| 开 `✅` | 绿色实心 | 功能对此应用启用 | 单击切换 |
| 关 `❌` | 灰色空心 | 功能对此应用禁用 | 单击切换 |
| 半开 `⚙️` | 主题色齿轮 | FlowHint 专属：已启用并绑定特定词库 | 单击开关 + 齿轮图标进词库选择 |

**FlowHint 列交互**：单击切换开关，旁边小齿轮图标点击进入词库绑定面板。

### 5.4 "默认"行

`(默认)` 行代表全局默认策略。未被手动加入矩阵的应用都继承此行配置。`⊘` 表示默认关闭。

### 5.5 全选/反选

- **列头**：控制该功能对所有已添加应用的开关（不影响默认行）
- **行尾**：控制该应用的所有功能开关

### 5.6 数据结构

```json
{
  "rules": {
    "default": {
      "flowsnap": true,
      "flowhint": false,
      "flowwriter": true,
      "flowpredict": true,
      "flowsync": true
    },
    "app_overrides": [
      {
        "process": "cmd.exe",
        "display_name": "命令提示符",
        "flowsnap": false,
        "flowhint": true,
        "flowhint_dicts": ["cmd_commands"],
        "flowwriter": false,
        "flowpredict": false,
        "flowsync": true
      }
    ]
  }
}
```

---

## 6. AI 引擎配置规范

FlowWriter 妙笔与 FlowPredict 先知共享同一套 AI 引擎后端配置。

### 6.1 端点拓扑

支持三层部署场景：

| 层级 | 示例 | 说明 |
|------|------|------|
| ☁️ 云端 API | DeepSeek / OpenAI / Gemini / Anthropic | 公网调用 |
| 🏢 局域网自建 | NAS Ollama / vLLM / 工作站 GPU 服务器 | 内网低延迟，隐私可控 |
| 🏠 本机 | localhost Ollama | 完全离线，零泄露 |

### 6.2 Provider 预置列表

| Provider | 默认 Endpoint | 默认 Model | 协议 |
|---------|--------------|-----------|------|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | OpenAI 兼容 |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` | OpenAI 原生 |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.0-flash` | OpenAI 兼容 |
| Anthropic | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` | 薄转换层适配 |
| 本机 Ollama | `http://localhost:11434/v1` | 自动检测 | OpenAI 兼容 |
| 局域网自建 | 用户自定义 URL | 用户自定义 | OpenAI 兼容 |
| 完全自定义 | 用户填写 | 用户填写 | OpenAI 兼容 |

**统一协议**：底层全部走 OpenAI 兼容的 `/chat/completions` 格式。

### 6.3 自动模式 — 可排序优先级链

"自动"模式按用户自定义的优先级链依次探测端点，直到找到可用的。

- 优先级链**支持拖拽排序**
- 右侧实时显示各端点连通状态
- 底部显示当前实际激活的端点和模型

### 6.4 快捷键配置

| 功能 | 默认快捷键 |
|------|----------|
| FlowWriter 妙笔触发 | `Ctrl+Shift+R` |
| FlowPredict 先知触发 | `Ctrl+Shift+P` |

均支持用户在 Settings 偏好中自定义录入。

---

## 7. FlowDeck 布告 — 仪表盘规范

FlowDeck 布告页面展示四个状态区块：

| 区块 | 内容 |
|------|------|
| 引擎核心 | Core 引擎运行状态、E2EE 密钥就绪状态、键盘 Hook 激活状态 |
| 同步网络 | NAS Hub 连接状态、WebSocket 活跃状态、协议安全性 (HTTPS/HTTP) |
| 在线设备 | 已连接的设备列表及各设备状态 |
| AI 引擎 | 所有已配置端点的实时连通性、当前激活端点及模型、延迟指标 |

---

## 8. 导入导出与备份恢复

### 8.1 统一入口

导入导出功能**统一收口到 Settings 偏好页面**的"备份与恢复"面板，不在各功能模块页面分散入口。

### 8.2 导出流程

点击"导出配置" → 弹窗选择要导出的模块 → 生成 `.ybflow` 文件。

可选模块：
- ☑ FlowSnap 锦囊数据
- ☑ FlowHint 灵犀词库
- ☑ FlowRules 中枢规则
- ☑ Settings 偏好设定
- ☑ AI 引擎配置
- ☐ 包含 API Key（敏感数据，默认不勾选）

### 8.3 备份包结构

```
YiboFlow_Backup_20260302.ybflow    ← 实际为 .zip
├── manifest.json                  ← 版本信息、导出时间、模块清单
├── snippets.json                  ← FlowSnap 锦囊数据
├── rules.json                     ← FlowRules 中枢矩阵
├── settings.json                  ← 偏好设定
├── dictionaries/                  ← FlowHint 灵犀词库
│   ├── cmd.json
│   └── my_custom_dict.json
└── ai_prompts.json                ← FlowWriter/FlowPredict 自定义 Prompt 模板
```

### 8.4 导入流程

选择 `.ybflow` 文件 → 自动检测内容 → 弹出预览面板：

- **快捷操作**（覆盖 80% 场景）：`[全部合并]` `[全部覆盖]` `[全部忽略]`
- **精细控制**：逐模块下拉选择冲突策略

### 8.5 冲突处理策略

| 策略 | 行为 |
|------|------|
| **合并** | 新增不存在的条目，已存在的保留本地版本 |
| **覆盖** | 完全替换本地数据 |
| **重命名** | 冲突条目以 `_imported` 后缀保留两个版本 |
| **忽略** | 跳过此模块，不导入 |

---

## 9. 主题与国际化

### 9.1 主题引擎

支持 5 套视觉主题，通过 CSS 变量 + `data-theme` 属性切换：

| 主题 ID | 英文名 | 中文名 | 风格 |
|---------|--------|--------|------|
| `dark` | Dark Glass | 深渊毛玻璃 | 默认，暗色半透明质感 |
| `linear` | Linear Minimalist | 流线极简 | 纯黑底色，1px 极致切割线 |
| `macos` | macOS Native | 果味拟物 | 圆润卡片，柔软环境阴影 |
| `neon` | Midnight Neon | 午夜霓虹 | 深海蓝底，赛博朋克青色霓虹 |
| `light` | Light Mode | 明亮白炽 | 高光办公环境纯净质感 |

主题选择持久化到 `localStorage`，启动时自动恢复。

### 9.2 国际化

- 支持 **中文 / English** 双语无缝切换
- 翻译资源文件：`src/locales/zh.json`、`src/locales/en.json`
- 通过 `react-i18next` 实现运行时切换

---

## 10. 跨语言集成规划（YiboFile 预留接口）

> **当前阶段**：仅在架构层面预留集成空间，不做实际开发。

### 10.1 集成方式：IPC (Named Pipe)

管道名称：`\\.\pipe\YiboFlow`

消息协议（JSON）：

```json
{
  "action": "send_file",
  "payload": {
    "file_path": "C:\\Users\\xxx\\document.pdf",
    "target_device": "device_b",
    "ttl_hours": 24
  },
  "request_id": "uuid-v4"
}
```

### 10.2 后续扩展空间

| 阶段 | 能力 | 说明 |
|------|------|------|
| Phase 1 (预留) | `send_file` | 当前仅定义接口 |
| Phase 2 | `query_devices` | 查询在线设备列表 |
| Phase 3 | `sync_clipboard` | 触发剪切板同步 |
| Phase 4 | `get_transfer_status` | 查询传输进度 |

---

## 11. 认证与鉴权

### 11.1 JWT + Refresh Token

| 令牌 | 有效期 | 用途 |
|------|--------|------|
| Access Token | 15 分钟 | API 请求鉴权 |
| Refresh Token | 30 天 | 刷新 Access Token |

### 11.2 多设备登录

- 同一用户允许多设备同时在线
- 每台设备独立持有 Refresh Token
- 支持远程注销指定设备会话

---

## 12. API 契约规范

### 12.1 通用约定

| 项目 | 规范 |
|------|------|
| 基础路径 | `/api/v1` |
| 数据格式 | JSON (`Content-Type: application/json`) |
| 认证方式 | `Authorization: Bearer <access_token>` |
| 时间格式 | ISO 8601 |

### 12.2 核心接口

#### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/login` | 登录 |
| POST | `/api/v1/auth/refresh` | 刷新 Token |
| POST | `/api/v1/auth/logout` | 注销 |

#### 设备

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/devices` | 设备列表 |
| DELETE | `/api/v1/devices/:id` | 远程注销设备 |

#### 缩略语

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/snippets` | 拉取全量（含 `version` 乐观锁） |
| POST | `/api/v1/snippets` | 新增 |
| PUT | `/api/v1/snippets/:id` | 更新 |
| DELETE | `/api/v1/snippets/:id` | 删除 |

#### 剪切板

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/clipboard` | 推送加密内容 |
| GET | `/api/v1/clipboard/latest` | 拉取最新 |
| GET | `/api/v1/clipboard/history` | 分页拉取历史 |

#### WebSocket

| 路径 | 说明 |
|------|------|
| `ws://.../api/v1/ws` | 长连接：设备通知、剪切板推送、传输信令 |

### 12.3 错误响应格式

```json
{
  "error": {
    "code": "SNIPPET_NOT_FOUND",
    "message": "指定的缩略语不存在",
    "details": {}
  }
}
```

---

## 13. 数据库设计 (PostgreSQL ≥ 15)

```sql
-- 用户表
CREATE TABLE users (
    uid SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    kdf_salt TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 设备表
CREATE TABLE devices (
    id SERIAL PRIMARY KEY,
    uid INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    device_name VARCHAR(100) NOT NULL,
    device_type VARCHAR(20) NOT NULL,
    device_fingerprint TEXT UNIQUE NOT NULL,
    refresh_token_hash TEXT,
    last_seen_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_uid ON devices(uid);

-- 缩略语表
CREATE TABLE snippets (
    id SERIAL PRIMARY KEY,
    uid INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    prefix VARCHAR(5) NOT NULL DEFAULT '/',
    keyword VARCHAR(50) NOT NULL,
    content_enc TEXT NOT NULL,
    wrapped_dk TEXT NOT NULL,
    nonce TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_snippets_uid_prefix_keyword ON snippets(uid, prefix, keyword);

-- 剪切板历史
CREATE TABLE clipboard_history (
    id SERIAL PRIMARY KEY,
    uid INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    data_type VARCHAR(10) NOT NULL,
    payload_enc TEXT,
    file_ref UUID,
    wrapped_dk TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clipboard_uid ON clipboard_history(uid);
CREATE INDEX idx_clipboard_expires ON clipboard_history(expires_at);

-- 文件传输记录
CREATE TABLE file_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_uid INTEGER NOT NULL REFERENCES users(uid),
    sender_device_id INTEGER NOT NULL REFERENCES devices(id),
    receiver_device_id INTEGER NOT NULL REFERENCES devices(id),
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    file_hash TEXT,
    storage_path TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    bytes_transferred BIGINT DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transfers_status ON file_transfers(status);
CREATE INDEX idx_transfers_expires ON file_transfers(expires_at);
```

---

## 14. 项目目录结构

```
YiboFlow/
├── docs/                      # 文档
│   └── specs.md               # 本文档
├── server/                    # Go 服务端
│   ├── cmd/
│   ├── internal/
│   ├── migrations/
│   ├── Dockerfile
│   └── go.mod
├── core/                      # Rust 核心进程 (yiboflow-core)
│   ├── src/
│   │   ├── keyboard/          # 键盘 Hook + FlowSnap + FlowHint 匹配
│   │   ├── clipboard/         # 剪切板监听
│   │   ├── crypto/            # 加密引擎
│   │   ├── transfer/          # 文件传输
│   │   ├── ai/                # AI 引擎适配层
│   │   ├── hint_window/       # FlowHint 候选悬浮窗
│   │   ├── ipc/               # Named Pipe IPC Server
│   │   ├── tray/              # 系统托盘
│   │   └── main.rs
│   └── Cargo.toml
├── desktop/                   # Tauri UI (配置面板)
│   ├── src/
│   │   ├── pages/             # 各功能模块页面
│   │   ├── components/        # 通用组件
│   │   ├── locales/           # i18n 翻译资源
│   │   └── index.css          # 主题系统
│   ├── src-tauri/
│   └── package.json
├── mobile/                    # Flutter 移动端
│   ├── lib/
│   ├── ios/
│   └── android/
├── proto/                     # 共享协议定义
├── docker-compose.yml
└── README.md
```

---

## 15. CI/CD 与构建规范

### 15.1 构建矩阵

| 组件 | 构建工具 | 产物 |
|------|---------|------|
| Server | `go build` → Docker Image | `yiboflow-server:tag` |
| Core | `cargo build --release` | `yiboflow-core.exe` |
| Desktop | `npm run tauri build` | `YiboFlow-Setup.msi` |
| Mobile | `flutter build apk/ipa` | `.apk` / `.ipa` |

### 15.2 版本号规范

采用 **语义化版本 (SemVer)**：`MAJOR.MINOR.PATCH`

**关键约束**：Server、Core、Desktop、Mobile 各自独立版本号，通过 `/api/v1/version` 约束兼容范围。

### 15.3 提交规范 (Conventional Commits)

格式：`<type>(<scope>): <description>`
- **type**: `feat`, `fix`, `refactor`, `docs`, `chore`
- **scope**: `server`, `core`, `desktop`, `proto`, `deps`

---

## 16. 版本控制与代码管理

### 16.1 仓库架构

| 仓库 | 包含组件 | 说明 |
|------|---------|------|
| `YiboFlow` | Server, Core, Desktop, Docs, Proto | 主仓库，核心组件原子提交 |
| `YiboFlow-Mobile` | Flutter App, iOS Extension | 移动端独立仓库 |

### 16.2 分支模型

- **全局分支模型**：日常开发基于单一 `master` 分支，目前不采用复杂的多分支模型（如 Git Flow 等）。所有变更原子提交至 `master`。

### 16.3 兼容矩阵 (`compatibility.json`)

```json
{
  "platform_version": "v0.3.0",
  "server_api_version": "v1",
  "clients": {
    "core": ">=v0.3.0",
    "desktop": ">=v0.3.0",
    "mobile": ">=v0.2.0"
  }
}
```

---

## 17. 日志与可观测性

- 所有组件采用 JSON 格式结构化日志
- 日志级别：`error` / `warn` / `info` / `debug`
- Server 暴露 `/metrics` (Prometheus)，可选接入 Grafana

---

## 18. 错误处理约定

### 客户端

| 场景 | 策略 |
|------|------|
| 网络不可达 | 本地缓存待同步数据，恢复后自动重试 |
| Token 过期 | 自动刷新，失败则跳转登录 |
| 版本不兼容 | 弹窗提示升级 |
| 同步冲突 | 展示冲突内容，用户选择保留版本 |

### 服务端

| 场景 | 策略 |
|------|------|
| 数据库连接失败 | 重试 3 次后 503 |
| Redis 不可用 | 降级数据库直读 |
| TTL 清理失败 | 下次定时任务补偿 |

---

## 19. 隐私与数据安全声明

* **最小化存储**：仅存储用户主动同步的数据
* **TTL 强制过期**：所有临时数据必须有过期时间，到期自动物理删除
* **零知识架构**：NAS 服务端不存储、不处理任何明文内容
* **用户可控**：用户可随时导出/删除个人数据

---

## 20. 开发路线图 (Roadmap)

### Phase 0：安全基础设施与技术验证 ✅

| 任务 | 状态 |
|------|------|
| MK/DK 分层密钥方案 | ✅ 完成 |
| Rust 全局键盘 Hook | ✅ 完成 |
| Tauri 托盘模式 | ✅ 完成 |
| NAS Docker 部署基线 | ✅ 完成 |

### Phase 1：NAS 信令中台

| 任务 | 验收标准 |
|------|---------|
| 用户注册/登录 API | JWT 全流程 |
| 设备管理 API | CRUD + 远程注销 |
| WebSocket 长连接 | 心跳保活 |
| Redis TTL 回收 | 定时清理 + 补偿 |

### Phase 2：Rust 核心模块

| 任务 | 验收标准 |
|------|---------|
| FlowSnap 锦囊 | 双策略替换、IME 兼容、Undo |
| FlowSync 烽火 | MK/DK 加密全链路同步 |
| FlowDrop 走镖 | TCP + 断点续传 + SHA-256 |
| Named Pipe IPC | JSON 指令处理 |

### Phase 3：Desktop UI + FlowRules 中枢

| 任务 | 验收标准 |
|------|---------|
| Tauri 配置面板 | 全部功能模块页面 |
| FlowRules 中枢重构 | 矩阵 UI + 按应用权限控制 |
| 导入导出系统 | .ybflow 备份/恢复 |

### Phase 4：FlowHint 灵犀

| 任务 | 验收标准 |
|------|---------|
| 候选悬浮窗引擎 | ↑↓ 选择 + Tab 上屏 |
| 词库加载系统 | builtin + custom 目录热加载 |
| 词库管理 UI | 查看/编辑/创建/删除/另存为 |
| 首批内置词库 | cmd + git + general_zh |

### Phase 5：AI 引擎 + FlowWriter 妙笔 + FlowPredict 先知

| 任务 | 验收标准 |
|------|---------|
| AI 引擎适配层 | OpenAI 兼容协议，多 Provider 支持 |
| 自动模式优先级链 | 可拖拽排序 + 实时状态探测 |
| FlowWriter 妙笔 | 全局快捷键→选中润色→写回 |
| FlowPredict 先知 | 上下文预测 + 候选窗 |

### Phase 6：生态闭环

| 任务 | 验收标准 |
|------|---------|
| YiboFile 集成 | Named Pipe 桥接 |
| Flutter 移动端 | 剪切板同步 + 文件接收 |
| 全链路测试 | NFR 指标达标 |

### 未来展望

- **物理按键级重映射层**：硬件级按键拦截与置换
- **FlowSnap 增强**：文件夹嵌套管理，树状分类
- **FlowHint 社区词库市场**：在线仓库，一键安装
- **FlowHint 虚影渲染**：光标后半透明预测文字（Phase 4 第二阶段）
