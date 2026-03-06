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
| AI 文本增强 | **FlowWriter** | **妙笔** | 妙笔生花 | 划词/复制/快捷键弹出工具栏 → AI 润色/扩写/缩写/总结/翻译/搜索/解释 → 浮窗预览 → 确认写回 | 🔜 待开发 |
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
| FlowWriter · 妙笔 | 划词即出工具栏，AI 润色/翻译/搜索/解释一站式文本增强 | Select text for AI polish, translate, search & explain |
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

### 4.3 FlowWriter 妙笔 — AI 文本增强套件（待开发）

#### 功能定义

FlowWriter 妙笔采用**“触发 → 工具栏 → 浮窗预览”**三段式交互范式，提供一站式文本增强能力。

#### 4.3.1 触发方式（三通道并存）

支持三种触发通道，用户可在 Settings 中逐一启用/禁用：

| 触发方式 | 行为 | 场景适配 | 默认状态 |
|---------|------|---------|:---------:|
| **划词选中** | 鼠标释放后，在选中文本附近弹出迷你工具栏 | 浏览、校对场景 | ✅ 启用 |
| **复制操作** | 检测到 Ctrl+C 后，在光标/选区附近弹出工具栏 | 跨应用取词 | ❌ 关闭 |
| **全局快捷键** | 先选中文本，再按快捷键（默认 `Ctrl+Shift+R`）弹出工具栏 | 键盘流用户 | ✅ 启用 |

**划词触发技术方案**：采用轻量级方案——监听鼠标释放事件 + 剪贴板变化检测，不主动探测选区（避免 UI Automation API 兼容性风险）。

**复制触发与 FlowSync 烽火的关系**：两者**并行不冲突**。FlowSync 烽火的剪贴板同步静默继续执行，FlowWriter 工具栏作为额外的 UI 层弹出，互不干扰。

#### 4.3.2 工具栏功能矩阵

工具栏弹出后显示以下功能按钮，分为两组：

```
┌──────────────────────────────────────────────────────┐
│  ✨ 润色  📐 扩写  ✂️ 缩写  📋 总结  🎨 风格        │  ← AI 文本处理组
│  🌐 翻译  🔍 搜索  💡 解释                           │  ← 辅助工具组
└──────────────────────────────────────────────────────┘
```

| 功能 | 说明 | 子菜单/交互 | 消耗 AI Token |
|------|------|------------|:------------:|
| **✨ 润色** | AI 提升文本质量，修正语法、优化措辞 | 直接执行 | ✅ |
| **📐 扩写** | AI 扩展为更详细的内容 | 子菜单：×1.5 / ×2 / ×3 倍率 | ✅ |
| **✂️ 缩写** | AI 精简压缩文本 | 子菜单：50% / 30% / 一句话 | ✅ |
| **📋 总结** | AI 提取核心要点 | 直接执行 | ✅ |
| **🎨 风格** | 切换文体风格 | 子菜单：正式 / 口语 / 学术 / 文学 / 商务 / 自定义… | ✅ |
| **🌐 翻译** | 多语言互译（纯 AI 翻译，复用现有引擎） | 子菜单：中 / 英 / 日 / 韩 / 法 / 德 / 自定义… | ✅ |
| **🔍 搜索** | 对选中文本发起搜索 | 子菜单：默认引擎 / Google / Bing / 自定义 | ❌ |
| **💡 解释** | AI 解释选中内容（术语、代码、公式等） | 直接执行 | ✅ |

> **搜索功能**不走 AI 引擎，直接调用系统默认浏览器打开搜索 URL，属于轻量辅助能力，不消耗 AI Token。

#### 4.3.3 浮窗预览式结果展示

用户点击工具栏中的任一 AI 功能后，弹出浮窗预览结果：

```
┌─────────────────────────────────────┐
│  🖊️ FlowWriter · 妙笔 — 润色       │
│  ─────────────────────────────────  │
│  原文：                             │
│  “这个功能非常好用”                  │
│  ─────────────────────────────────  │
│  结果：                             │
│  “该功能具有出色的易用性与实用价值，  │
│   深受用户好评。”                    │
│  ─────────────────────────────────  │
│  [✅ 替换] [📋 复制] [🔄 重新生成]   │
│  [❌ 放弃]                          │
└─────────────────────────────────────┘
```

**浮窗设计规范**：

| 维度 | 设计 |
|------|------|
| 位置 | 紧贴工具栏下方或选区附近，智能避让原文 |
| 尺寸 | 自适应内容长度，最大宽度 480px，超长内容可滚动 |
| 动画 | 淡入 + 微滑（150ms），AI 生成中显示流式打字机效果 |
| 操作按钮 | ✅ 替换（写回原位置）、📋 复制、🔄 重新生成、❌ 放弃 |
| 多轮迭代 | 用户可直接编辑浮窗中的结果文本，再点击“替换” |
| 拖拽 | 浮窗支持拖拽移动，防止遮挡关键内容 |
| 主题 | 继承 YiboFlow 当前活跃主题（Dark Glass / Neon 等） |
| 失焦行为 | 点击浮窗外部自动关闭（可在 Settings 中配置为保持） |

**结果写回机制**：`模拟 Ctrl+V 写回`（与 FlowSnap 剪贴板粘贴策略一致）。写回前备份原始剪贴板内容，写回后恢复。

#### 4.3.4 Prompt 模板体系（分层设计）

采用**预设 + 自定义**两层架构：

| 层级 | 说明 | 用户可编辑 |
|------|------|:----------:|
| **内置预设模板** | 润色/扩写/缩写/总结/解释等内置 Prompt | ❌ |
| **内置风格预设** | 正式/口语/学术/文学/商务 | ❌ |
| **自定义 Prompt 模板** | 用户在 Settings 中创建的自定义功能，出现在 🎨 风格子菜单末尾 | ✅ |
| **自定义翻译语言** | 用户可添加 🌐 翻译子菜单中的目标语言 | ✅ |

自定义 Prompt 模板支持通过导入导出系统（§8）备份恢复，存储在 `ai_prompts.json` 中。

#### 4.3.5 渲染架构

工具栏和浮窗均由 **Rust Core 进程渲染**（独立无边框、始终置顶悬浮窗），与 FlowHint 灵犀候选窗共享底层渲染引擎，保持跨应用一致性。

#### 4.3.6 AI 引擎

共享统一 AI 引擎配置（详见第 6 章），所有 AI 功能（润色/扩写/缩写/总结/风格/翻译/解释）复用同一套 Provider 优先级链，仅 Prompt 模板不同。

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
| FlowWriter 妙笔工具栏（快捷键触发） | `Ctrl+Shift+R` |
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

## 11. 账户、认证与多端 Vault 同步架构 (Phase 3 终极架构设计)

为保障**“本地优先、绝对隐私加密、配置与数据生而同死”**的设计理念，YiboFlow 放弃传统的 SaaS (建表散列存取) 模式，采用**基于增量日志流的分块 Vault（集装箱版数字抽屉）**，结合 **本地/边缘计算（Edge AI）** 的混合顶层架构。

### 11.1 数据隔离与本地账户沙盒

无论该设备是否连网，系统均强制采用“以账户为维度”的数据物理隔离机制。
- **本地总控设计**：全局应用配置 (`config.json`)、词库文件夹 (`dictionaries/`)、规则与个人 AI 习惯 (`ai_habits.json`) 均作为整体档案存入 `%APPDATA%/YiboFlow/users/<username>/` 的隔离沙盒下。
- **本地登录机制**：本地保存了用户名的盐，每次登录利用用户真实输入的主加盐密码（通过 Argon2id 算法计算），衍生出一个会话级极高强度的 **Data Key** 来解开（或写入）本地的私有缓存。所有业务层引擎仅在该安全上下文中执行。

### 11.2 "NAS 无感计算"与"Vault 透明包裹" 互补双网络架构

由于重度 AI 模型（例如用于润色的大致 5GB 空间的 Ollama 引擎）在多端分发会带来灾难级体验，我们通过将**“计算”与“存储”环境解耦**解决：

1. **计算层 (NAS作为“打字机”)**：
   - 用户只须在私人 NAS（或常开机）上部署一次 Ollama 大模型（如 Qwen2.5 7B）放出 `/chat/completions` Endpoint。
   - 所有 PC 客户端发起 AI 润色时，由**本地环境生成完整描述 Prompt**（包含从 Vault 解出的用户习惯和要求），发给 NAS 计算获取返回上屏。NAS 只干活，对您的上下文毫不记忆存储。
   
2. **存储层 (NAS作为“聋哑公文包转运站”)**：
   - 所有的配置、规则、AI 习惯上下文，通过 YiboFlow 的**【分布式 Vault（安全包裹）】**机制传递，并在各端完成同步互补。

### 11.3 核心基建：增量日志流 (Log-Structured Delta Sync) 分块 Vault

为克服通常单体加密文件（例如 50MB 习惯文件）修改 1 字节必须重传全量包导致带宽浪费的绝症，引入“时光机式增量补偿日志”：

- **远端集装箱目录映射**：远端不建立 SQL 数据库，只提供对应用户名的一个专属目录。远端存储（如 NAS）上的文件如下：
  ```
  /vault/<username>/
   ├── manifest.enc        <-- 存储最新清单、哈希校验集、切片索引 (约 1KB)
   ├── config.enc          <-- 基础配置包裹 (体积小，全量置换)
   ├── dictionaries/       <-- 按词库分离各自分布式加密小匣
   └── ai_habits/          <-- (体积极大，不频繁置换基底)
        ├── base_v1.enc           <-- 压实的底层核心数据包 (例 40MB)
        ├── delta_1729110.enc     <-- 新增习惯的补丁切片 (例 300 Bytes)
        └── delta_1729111.enc     <-- 又一句话的新增补丁 (例 1KB)
  ```
- **亚秒级增量 (Delta Push)**：当电脑由于打了一行新代码生成习惯，系统**绝不重绑底包**，仅抽出那增加的 300B，生成一条独立的切片 `delta.enc` 补丁传输。上传全程仅耗时几十毫秒且绝对零知识保密。
- **异地重现 (Replay)**：其他电脑拉取最新的 `manifest.enc`（微小），仅比对得出存在云端新补充的 `delta`，便下载那 1KB，与本地解密的 `base` 合并供推理使用。没有任何配置割裂外键危机，环境始终一分不差。

### 11.4 解决碎片化：手动/自动 Compaction (压实大扫除)

因为永远叠加小切片日志会拖垮未来 IO 性能并拉长时间，特引入本地终端聚合清理引擎与防呆机制：

- **Compaction (压实打底)**：电脑客户端若通过 Manifest 监测到当前切片数目超过 30 甚至更多，便会在后台空闲时刻，取来所有切片，在十六核本地运存里化水，聚合成一个单纯的全新 JSON 巨包。将此作为 `base_v2.enc` 推送，并命令服务器清除之前的脏垃圾 Delta，使文件库立刻回归最净空状态。
- **手动控制中心**：**在设置界面新增专区【同步与空间管理】**。使用户不依靠全自动，也可视化地随时点击：
  - `[🔄 强制全局本地压实 (打底重置)]`
  - `[♻️ 测算并拉取当前增量集]`
  - `[⬆️ 强制重传所选 Vault 重载服务器]`

### 11.5 手机端的架构让步

- 此 Vault 架构不仅为电脑增量提速，还提供了**“可选拉取列表”能力**。针对算力极弱的移动端，其在连网解密 `manifest.enc` 之后，内部写死过滤判断，**强制屏蔽一切关于 `ai_habits.enc` / `ai_habits/` 相关的大型包裹拉取记录**。
- 手机仅拉取薄薄一本 `config` 和轻量级快捷词库匣，保持绝对的零打扰和干净。

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
| FlowWriter 妙笔 | 三通道触发（划词/复制/快捷键）→ 工具栏 → 浮窗预览 → 确认写回；含润色/扩写/缩写/总结/风格/翻译/搜索/解释；分层 Prompt 模板体系 |
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

---

## 21. 实施演进计划（账户/同步系统攻坚）

针对“本地优先账户机制”与“多端冲突解决体系”的改造，制定以下三阶段实施线路，作为当前开发优先级最高的核心攻坚任务。

### 阶段 1：本地目录隔离基础设施（Rust 后端改造）
- **目标**：彻底改造单体配置文件路径，全面拥抱以 `username` 为维度的用户物理隔离。
- **关键操作**：
  1. 重构全局路径获取策略：废弃写死的 `%APPDATA%/YiboFlow/`，建立带有生命周期的全局会话上下文，响应并挂载对应的登录 `username` 子目录。
  2. 实现本地轻量账户系统 `users.json`，提供账户读写访问并支持密码加盐哈希的保存与离线校验。
  3. 引入 `last_session.json` 持久化最后的登录身份，供引擎重启时实现静默热加载。

### 阶段 2：UI 业务流闭环与前端适配（Tauri 界面集成）
- **目标**：打通 UI 交互与后端隔离系统的通信握手。
- **关键操作**：
  1. 页面重构 (`Login.tsx`)：注册/登录时固定新增下拉首项 `[本地脱机模式 (Local)]`。
  2. 离线/在线分轨请求：若入参为 `local`，发送特定指令交由 Rust 执行本地校验与目录搭建；若为 `http`，则执行原版远端核验与本地凭据映射。
  3. 账户冲突前台接管：在远端返回 409 (Conflict) 触发拦截时，实现弹窗面板，承接用户做出的“合并验证 / 账号本地重命名 / 强制云端覆盖”决策。

### 阶段 3：底层结构完善与同步 Diff 预研（向 FlowSync 铺垫）
- **目标**：在数据结构层面留好同步引擎的钩子，保障未来实现多端数据上云时的无缝感。
- **关键操作**：
  1. 数据实体规范化（ORM 改造）：遍历目前全部的 `SmartDictionary` 和 `FlowSnap` 本地结构声明，强制补充 `uuid` (主键追踪) 与 `updated_at` (最后修改时间戳) 的全自动维护逻辑。
  2. 数据包版本合并策略：在后端新增简单的 JSON Diff 判断树（对比上行 UUID 与 远端 UUID 最后修改时间），预先输出冲突集合抛给前端渲染界面。
