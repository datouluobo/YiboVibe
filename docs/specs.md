# YiboFlow 项目开发规范文档 (v1.3)

> **文档性质**：项目技术契约，指导全平台开发实施。
> **版本历史**：v1.0 初稿 → v1.2 生态整合 → **v1.3 评审修订**（补充安全架构、数据库完善、路线图细化）
> **适用范围**：当前为单文档综合规范。随项目推进，各章节可按需拆分为独立子文档。

---

## 1. 项目愿景与定义

**YiboFlow** 是一款以私有 NAS (Synology) 为底座的跨平台生产力增强套件。

* **核心功能**：自定义缩略语全局替换、端到端加密 (E2EE) 剪切板同步、多端定向文件互传。
* **生态定位**：作为 **Yibo 系列** 的底层通信与自动化引擎，需具备被 **YiboFile (C#)** 集成调用的能力。

### 1.1 非功能性需求 (NFR)

| 指标 | 目标值 | 备注 |
|------|--------|------|
| 缩略语替换延迟 | < 50ms | 从击键到替换完成，用户无感知延迟 |
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

## 2. 系统架构

### 2.1 技术栈

| 组件 | 技术选型 | 关键职责 |
| --- | --- | --- |
| **Server (NAS)** | Go (Gin) + PostgreSQL + Redis | 多用户鉴权、WebSocket 信令中心、TTL 管理 |
| **Core (Win)** | **Rust 独立进程** | **系统托盘常驻**：键盘 Hook、剪切板监听、加密引擎、文件传输、IPC 服务 |
| **Desktop UI** | **Tauri (Rust + React)** | 配置管理面板，与 Core 进程通过 IPC 通信 |
| **Mobile** | Flutter + 原生扩展 | App 处理大文件与同步；iOS Keyboard Extension 需用 **原生 Swift** 实现 |
| **Eco-Link** | IPC (Named Pipe) | YiboFile (C#) 调用 YiboFlow Core 的集成通道 |

### 2.2 进程架构（Windows）

```
┌──────────────────────────────────┐
│  yiboflow-core.exe (Rust)        │  ← 系统托盘常驻, 开机自启
│  ┌────────────────────────────┐  │
│  │ 键盘 Hook 模块              │  │
│  │ 剪切板监听模块              │  │
│  │ AES-256-GCM 加密引擎       │  │
│  │ 文件传输引擎 (TCP + 断点续传)│  │
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

### 2.3 服务端部署

| 项目 | 规格 |
|------|------|
| 部署方式 | Docker 容器 (docker-compose) |
| 宿主机 CPU | AMD EPYC 7272 (x86_64) |
| 容器编排 | Go Server + PostgreSQL 15+ + Redis 7+ |
| 数据持久化 | Docker Volume 挂载至 NAS 存储池 |

### 2.4 移动端架构说明

* **Flutter 主 App**：处理剪切板同步 UI、文件接收预览、缩略语配置管理
* **iOS Keyboard Extension**：
  - 必须使用 **原生 Swift** 开发（Flutter 不支持直接编写 Extension）
  - 通过 **App Group** 与主 App 共享数据
  - 内存上限约 70MB，需严格控制资源使用
  - **当前状态**：暂无 iOS 开发者账号，此部分延后至获取账号后再验证
* **Android 输入法**：可通过 Flutter Method Channel 桥接原生实现

---

## 3. 核心功能实现逻辑

### 3.1 缩略语智能替换 (Windows)

#### 触发与执行

* **触发机制**：监听用户输入的 `prefix` (如 `/`, `;`, 可自定义) + `keyword`
* **执行动作**：检测匹配后发送 `Backspace` × n → 读取解密内容 → 替换输出
* **性能要求**：端到端延迟 < 50ms

#### 替换策略（用户可配置）

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **模拟按键** (默认) | 逐字符发送键盘事件 | 通用文本编辑器 |
| **剪切板粘贴** | 写入剪切板后模拟 Ctrl+V | 富文本编辑器 (Word, Notion 等) |

> 用户可在设置中选择默认策略，也可按应用单独配置。

#### 安全机制

* **应用黑名单/白名单**：
  - 默认全局启用
  - 支持用户手动添加"排除应用"列表（如游戏、IDE 调试模式）
  - 通过前台窗口进程名匹配

* **撤销 (Undo)**：
  - 替换后保留最近一次替换的原始文本
  - 用户按 `Ctrl+Z` 时还原为原始输入（prefix + keyword）
  - 撤销窗口期：替换后 5 秒内有效

* **IME 兼容**：
  - 检测输入法组合窗口（Composition Window）状态
  - IME 处于组合/候选状态时暂停匹配，确认输入后再恢复

### 3.2 剪切板 E2EE 同步

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
- **KDF**：Argon2id，参数 `m=64MB, t=3, p=4`（具体参数按目标设备性能调优）
- **Data Key**：每条剪切板记录使用独立随机 DK，DK 用 MK 包裹后一并存储
- **密码修改**：仅需用新 MK 重新包裹所有 DK，**无需重加密历史数据**
- **Nonce 管理**：每次加密随机生成 12 字节 nonce，与密文一起存储，绝不重复使用
- **NAS 零知识**：服务端仅存储密文和 Wrapped DK，不触碰明文和 MK

#### 同步流程

* **文本**：加密后直传 NAS，各端拉取后解密
* **图片**：加密后存 NAS 文件系统，生成 UUID 引用，各端按需拉取解密
* **移动端唤醒**：NAS 发送静默推送 (Silent Push) → App 后台唤醒拉取 → 失败则待用户打开 App 时补齐

### 3.3 文件互传与 TTL

#### 传输协议

* **方案**：基于 **TCP 直连**（同一局域网 / VPN 可达场景）
  - 私有 NAS 场景下无需 WebRTC/STUN/TURN 的复杂信令
  - NAS 作为设备发现与连接协调的信令中心
  - 设备不可直连时，NAS 作为临时中转

* **断点续传**：
  - 文件分块传输（默认块大小 1MB）
  - 每块传输完成后记录偏移量
  - 断线重连后从上次偏移量继续

* **完整性校验**：
  - 传输完成后计算 SHA-256 全文校验和
  - 与发送端校验和比对，不一致则重传

* **传输加密**：文件传输通道 **不加密**（私有局域网场景，信任网络环境）

#### TTL 自动销毁

* 文件传输记录和中转文件根据 TTL 设定自动过期
* 过期后：抹除 NAS 上的物理文件 + 删除数据库记录
* TTL 可由发送端设置，默认 24 小时

---

## 4. 跨语言集成规划（YiboFile 预留接口）

> **当前阶段**：仅在架构层面预留集成空间，不做实际开发。
> **集成范围**：YiboFile 可调用 YiboFlow 向指定设备发送文件。

### 4.1 集成方式：IPC (Named Pipe)

YiboFlow Core 作为系统托盘常驻进程，对外暴露 Named Pipe 接口。

**管道名称**：`\\.\pipe\YiboFlow`

**消息协议**（JSON，预定义）：

```json
// 请求：发送文件
{
  "action": "send_file",
  "payload": {
    "file_path": "C:\\Users\\xxx\\document.pdf",
    "target_device": "device_b",
    "ttl_hours": 24
  },
  "request_id": "uuid-v4"
}

// 响应
{
  "request_id": "uuid-v4",
  "status": "accepted",  // accepted / rejected / error
  "transfer_id": "uuid-v4",
  "message": ""
}
```

### 4.2 YiboFile 侧调用示例（C# 伪代码）

```csharp
// 未来集成时的参考实现
using var pipe = new NamedPipeClientStream(".", "YiboFlow", PipeDirection.InOut);
await pipe.ConnectAsync(timeout: 3000);

var request = JsonSerializer.Serialize(new {
    action = "send_file",
    payload = new { file_path = selectedFile, target_device = "phone_01", ttl_hours = 24 },
    request_id = Guid.NewGuid().ToString()
});

// 发送请求 & 读取响应
await pipe.WriteAsync(Encoding.UTF8.GetBytes(request));
// ...
```

### 4.3 后续扩展空间

| 阶段 | 能力 | 说明 |
|------|------|------|
| **Phase 1** (预留) | `send_file` | 当前仅定义接口，不实现 |
| **Phase 2** | `query_devices` | 查询在线设备列表 |
| **Phase 3** | `sync_clipboard` | 触发剪切板同步 |
| **Phase 4** | `get_transfer_status` | 查询传输进度 |

---

## 5. 认证与鉴权

### 5.1 方案选型：JWT + Refresh Token

| 令牌 | 有效期 | 用途 |
|------|--------|------|
| Access Token | 15 分钟 | API 请求鉴权，短期有效 |
| Refresh Token | 30 天 | 刷新 Access Token，存储于客户端安全区域 |

### 5.2 多设备登录策略

- 同一用户允许多设备同时在线（上限由 `devices` 表控制）
- 每台设备独立持有 Refresh Token
- 用户可在任意客户端查看并远程注销指定设备的会话

### 5.3 流程

```
客户端                              NAS Server
  │                                     │
  │── POST /api/auth/login ────────────▶│  验证 username + password_hash
  │◀── { access_token, refresh_token } ─│  注册 device, 下发令牌对
  │                                     │
  │── GET /api/xxx (Bearer token) ─────▶│  校验 Access Token
  │                                     │
  │── POST /api/auth/refresh ──────────▶│  Refresh Token 轮换
  │◀── { new_access, new_refresh } ─────│
```

---

## 6. API 契约规范

### 6.1 通用约定

| 项目 | 规范 |
|------|------|
| 基础路径 | `/api/v1` |
| 数据格式 | JSON (`Content-Type: application/json`) |
| 认证方式 | `Authorization: Bearer <access_token>` |
| 时间格式 | ISO 8601 (`2026-02-27T00:00:00Z`) |

### 6.2 错误响应格式

```json
{
  "error": {
    "code": "SNIPPET_NOT_FOUND",
    "message": "指定的缩略语不存在",
    "details": {}
  }
}
```

### 6.3 错误码体系

| HTTP 状态码 | 错误码前缀 | 说明 |
|------------|-----------|------|
| 400 | `INVALID_*` | 请求参数校验失败 |
| 401 | `AUTH_*` | 认证失败 / Token 过期 |
| 403 | `FORBIDDEN_*` | 无权访问 |
| 404 | `*_NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT_*` | 版本冲突（乐观锁） |
| 500 | `INTERNAL_*` | 服务端内部错误 |

### 6.4 核心接口概览

#### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/login` | 用户登录，返回令牌对 |
| POST | `/api/v1/auth/refresh` | 刷新 Access Token |
| POST | `/api/v1/auth/logout` | 注销当前设备会话 |

#### 设备

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/devices` | 获取当前用户的设备列表 |
| DELETE | `/api/v1/devices/:id` | 远程注销指定设备 |

#### 缩略语

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/snippets` | 拉取全量缩略语（含 `version`） |
| POST | `/api/v1/snippets` | 新增缩略语 |
| PUT | `/api/v1/snippets/:id` | 更新（需携带 `version` 乐观锁） |
| DELETE | `/api/v1/snippets/:id` | 删除缩略语 |

#### 剪切板

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/clipboard` | 推送加密剪切板内容 |
| GET | `/api/v1/clipboard/latest` | 拉取最新一条 |
| GET | `/api/v1/clipboard/history` | 分页拉取历史 |

#### WebSocket

| 路径 | 说明 |
|------|------|
| `ws://.../api/v1/ws` | 长连接通道：设备上下线通知、剪切板推送、传输信令 |

---

## 7. 数据库设计 (PostgreSQL ≥ 15)

### 7.1 DDL

```sql
-- ============================================
-- 用户表
-- ============================================
CREATE TABLE users (
    uid SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    kdf_salt TEXT NOT NULL,              -- Argon2id 盐值，用于客户端派生 MK
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- 设备表：多端同步依赖设备注册
-- ============================================
CREATE TABLE devices (
    id SERIAL PRIMARY KEY,
    uid INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    device_name VARCHAR(100) NOT NULL,
    device_type VARCHAR(20) NOT NULL,    -- 'windows', 'ios', 'android'
    device_fingerprint TEXT UNIQUE NOT NULL, -- 设备唯一标识
    refresh_token_hash TEXT,             -- 当前 Refresh Token 的哈希
    last_seen_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_uid ON devices(uid);

-- ============================================
-- 缩略语表
-- ============================================
CREATE TABLE snippets (
    id SERIAL PRIMARY KEY,
    uid INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    prefix VARCHAR(5) NOT NULL DEFAULT '/',
    keyword VARCHAR(50) NOT NULL,
    content_enc TEXT NOT NULL,            -- AES-256-GCM 加密内容
    wrapped_dk TEXT NOT NULL,             -- MK 包裹的 Data Key
    nonce TEXT NOT NULL,                  -- GCM nonce (Base64)
    version INTEGER NOT NULL DEFAULT 1,  -- 乐观锁版本号，多端同步冲突检测
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_snippets_uid_prefix_keyword ON snippets(uid, prefix, keyword);

-- ============================================
-- 剪切板历史
-- ============================================
CREATE TABLE clipboard_history (
    id SERIAL PRIMARY KEY,
    uid INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    data_type VARCHAR(10) NOT NULL,      -- 'text' / 'image'
    payload_enc TEXT,                     -- 文本：加密内容；图片：NULL
    file_ref UUID,                       -- 图片：NAS 文件系统中的 UUID 引用
    wrapped_dk TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,       -- TTL 过期时间
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clipboard_uid ON clipboard_history(uid);
CREATE INDEX idx_clipboard_expires ON clipboard_history(expires_at);

-- ============================================
-- 文件传输记录
-- ============================================
CREATE TABLE file_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_uid INTEGER NOT NULL REFERENCES users(uid),
    sender_device_id INTEGER NOT NULL REFERENCES devices(id),
    receiver_device_id INTEGER NOT NULL REFERENCES devices(id),
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    file_hash TEXT,                       -- SHA-256 校验和
    storage_path TEXT,                    -- NAS 中转时的临时路径
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
        -- pending / transferring / completed / expired / failed
    bytes_transferred BIGINT DEFAULT 0,  -- 断点续传进度
    expires_at TIMESTAMP NOT NULL,       -- TTL 过期时间
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transfers_status ON file_transfers(status);
CREATE INDEX idx_transfers_expires ON file_transfers(expires_at);
```

### 7.2 版本兼容性策略

| 项目 | 策略 |
|------|------|
| **数据库迁移** | 使用 `golang-migrate` 管理 SQL 迁移文件，每次变更生成带时间戳的 up/down 文件 |
| **API 版本** | URL 路径版本化 (`/api/v1`, `/api/v2`)，旧版本至少保留一个大版本的兼容期 |
| **客户端-服务端协商** | 客户端启动时请求 `/api/v1/version`，服务端返回最低兼容客户端版本号；低于此版本强制提示升级 |
| **Snippet 同步冲突** | 基于 `version` 字段的乐观锁；冲突时客户端提示用户手动选择 |

---

## 8. 项目目录结构

```
YiboFlow/
├── docs/                      # 文档
│   └── specs.md               # 本文档
├── server/                    # Go 服务端
│   ├── cmd/                   # 入口
│   ├── internal/              # 业务逻辑 (handler, service, repo)
│   ├── migrations/            # 数据库迁移文件
│   ├── Dockerfile
│   └── go.mod
├── core/                      # Rust 核心进程 (yiboflow-core)
│   ├── src/
│   │   ├── keyboard/          # 键盘 Hook
│   │   ├── clipboard/         # 剪切板监听
│   │   ├── crypto/            # 加密引擎
│   │   ├── transfer/          # 文件传输
│   │   ├── ipc/               # Named Pipe IPC Server
│   │   ├── tray/              # 系统托盘
│   │   └── main.rs
│   └── Cargo.toml
├── desktop/                   # Tauri UI (配置面板)
│   ├── src/                   # React 前端
│   ├── src-tauri/             # Tauri Rust 胶水层
│   └── package.json
├── mobile/                    # Flutter 移动端
│   ├── lib/                   # Dart 代码
│   ├── ios/                   # 含原生 Swift Keyboard Extension
│   └── android/
├── proto/                     # 共享协议定义 (IPC 消息格式等)
├── docker-compose.yml         # 服务端一键部署
└── README.md
```

---

## 9. CI/CD 与构建规范

### 9.1 构建矩阵

| 组件 | 构建工具 | 产物 |
|------|---------|------|
| Server | `go build` → Docker Image | `yiboflow-server:tag` |
| Core | `cargo build --release` | `yiboflow-core.exe` |
| Desktop | `npm run tauri build` | `YiboFlow-Setup.msi` |
| Mobile | `flutter build apk/ipa` | `.apk` / `.ipa` |

### 9.2 版本号规范

采用 **语义化版本 (SemVer)**：`MAJOR.MINOR.PATCH`

| 变更类型 | 版本递增 | 示例 |
|---------|---------|------|
| 不兼容的 API/协议变更 | MAJOR | 加密协议升级 |
| 向后兼容的功能新增 | MINOR | 新增缩略语分组功能 |
| Bug 修复 | PATCH | 修复剪切板同步延迟 |

**关键约束**：Server、Core、Desktop、Mobile 各自独立版本号，但通过 `/api/v1/version` 接口约束兼容范围。

### 9.3 发布流程

```
feature/* ──▶ develop ──▶ release/* ──▶ main (tag vX.Y.Z)
    │           │            │
    └── PR ─────┘     └── 集成测试 ──┘
```

---

## 10. 版本控制与代码管理方案

> 采用 **Hybrid（混合）方案**：主仓库 + 移动端独立仓库。

### 10.1 仓库架构设计

为平衡"核心组件强耦合需原子提交"和"移动端发布节奏独立"的冲突，项目拆分为 2 个代码仓库：

| 仓库名称 | 包含组件 | 说明 |
|---------|---------|------|
| `YiboFlow` | Server, Core, Desktop, Docs, Proto | **主仓库**。三端核心逻辑强耦合（如 API 变更需双端同改），在同一仓库可实现原子 PR。 |
| `YiboFlow-Mobile` | Flutter App, iOS Extension | **移动端独立仓库**。受应用商店审核约束及构建链限制，独立管理发布节奏。 |

### 10.2 分支模型与开发工作流

#### 主仓库 (`YiboFlow`) — 采用 GitHub Flow (简化版)

三端核心紧密联动，直接基于 `main` 分支迭代。
* **`main`**：受保护的默认分支，始终保持可部署/可编译状态。
* **`feat/*`, `fix/*`**：日常开发分支，完成后通过 PR 合并入 `main`。
* **`release/vX.Y.0`**：(可选) 仅在某个大版本需要长期维护打补丁时创建。

#### 移动端仓库 (`YiboFlow-Mobile`) — 采用 Git Flow

移动端需要维护线上版的稳定性，同时开发新功能。
* **`main`**：对应线上商店的最新发布可用版本。
* **`develop`**：日常集成开发分支。
* **`feature/*`**：从 `develop` 切出，开发新功能。
* **`release/*`**：发布前准备分支（改版本号、上架截图等），测试通过后合并至 `main` 和 `develop`。
* **`hotfix/*`**：处理线上紧急 Bug，从 `main` 切出，修复后合并回 `main` 和 `develop`。

### 10.3 版本号体系与兼容矩阵

#### 统一基准与独立发布

* **主仓库平台版本 (Platform Version)**：
  `YiboFlow` 仓库整体采用单一版本号（如 `v0.3.0`）。发布时，Server、Core 进程、Tauri 桌面端三者统一打相同的 Tag。
* **移动端独立版本 (Mobile Version)**：
  `YiboFlow-Mobile` 仓库拥有独立的版本号（如 `v0.2.0`）。

#### 跨端兼容性控制 (`compatibility.json`)

在主仓库的根目录维护一个跨端兼容矩阵文件，用于指导移动端编译、CI 拦截，以及服务端 API 握手校验：

```json
{
  "platform_version": "v0.3.0",
  "server_api_version": "v1",
  "clients": {
    "core": ">=v0.3.0",
    "desktop": ">=v0.3.0",
    "mobile": ">=v0.2.0"
  },
  "updated_at": "2026-02-27"
}
```

### 10.4 提交规范 (Conventional Commits)

所有仓库均需遵循 Angular 规范格式，以便跨模块归类变更：
`<type>(<scope>): <description>`

* **type**: `feat` (新功能), `fix` (修复), `refactor` (重构), `docs` (文档), `chore` (构建/杂项)
* **scope**:
  * 主仓库：`server`, `core`, `desktop`, `proto`, `deps`
  * 移动仓库：`ios`, `android`, `ui`, `sync`

*示例：* `feat(core): 实现 AES-256-GCM 剪切板加密模块`

---

## 11. 日志与可观测性

### 11.1 结构化日志

所有组件采用 JSON 格式结构化日志：

```json
{
  "ts": "2026-02-27T00:00:00.000Z",
  "level": "info",
  "module": "clipboard",
  "msg": "clipboard sync completed",
  "uid": 1,
  "device": "windows_pc",
  "latency_ms": 120
}
```

### 11.2 日志级别

| 级别 | 用途 |
|------|------|
| `error` | 影响功能的异常，需关注 |
| `warn` | 潜在问题，如重试、超时 |
| `info` | 关键业务事件（登录、同步、传输完成） |
| `debug` | 开发调试信息，生产环境关闭 |

### 11.3 NAS 端监控

- Server 暴露 `/metrics` 端点 (Prometheus 格式)
- 关键指标：WebSocket 连接数、API 延迟 P95、剪切板同步成功率
- 可选：接入 Grafana 仪表盘（需 NAS Docker 额外部署）

---

## 12. 错误处理约定

### 12.1 客户端错误处理原则

| 场景 | 策略 |
|------|------|
| 网络不可达 | 本地缓存待同步数据，恢复后自动重试 |
| Token 过期 | 自动使用 Refresh Token 刷新，失败则跳转登录 |
| 版本不兼容 | 弹窗提示用户升级，阻止继续操作 |
| 同步冲突 (乐观锁) | 展示冲突内容，让用户选择保留版本 |

### 12.2 服务端错误处理原则

| 场景 | 策略 |
|------|------|
| 数据库连接失败 | 重试 3 次后返回 503，记录 error 日志 |
| Redis 不可用 | 降级为数据库直读，warn 日志 |
| TTL 清理失败 | 记录失败记录，下次定时任务补偿清理 |

---

## 13. 开发路线图 (Roadmap)

### 第零阶段：安全基础设施与技术验证

**目标**：验证核心技术可行性，确立安全架构。

| 任务 | 验收标准 | 预估 |
|------|---------|------|
| MK/DK 分层密钥方案原型 | Rust 实现加密/解密/密码修改全流程，单元测试通过 | 2-3 天 |
| Rust 加密库选型基准测试 | `ring` vs `RustCrypto` 性能对比报告 | 1 天 |
| Rust 全局键盘 Hook 原型 | 能捕获全局按键，正确处理 IME 状态 | 2-3 天 |
| Tauri 无窗口托盘模式验证 | Core 进程独立运行 + 托盘图标 + 菜单 | 1 天 |
| NAS Docker 部署基线 | Go + PostgreSQL + Redis compose 启动成功 | 1 天 |

### 第一阶段：NAS 信令中台

**目标**：可用的多用户后端服务。

| 任务 | 验收标准 | 预估 |
|------|---------|------|
| 用户注册/登录 API | JWT 认证全流程，Refresh Token 轮换 | 3-4 天 |
| 设备注册/管理 API | CRUD + 远程注销 | 2 天 |
| WebSocket 长连接 | 设备上下线通知，心跳保活 | 2-3 天 |
| Redis TTL 自动回收 | 过期数据定时清理，含补偿机制 | 1-2 天 |
| 数据库迁移基础设施 | golang-migrate 集成，初始迁移文件 | 1 天 |

### 第二阶段：Rust 核心模块 (yiboflow-core)

**目标**：Windows 端核心功能可用。

| 任务 | 验收标准 | 预估 |
|------|---------|------|
| 键盘 Hook + 缩略语替换 | 支持双策略（模拟按键/剪切板）、黑名单、Undo、IME 兼容 | 5-7 天 |
| 剪切板监听 + E2EE 同步 | MK/DK 加密全链路，与 NAS 双向同步 | 4-5 天 |
| 文件传输引擎 | TCP 直连 + 断点续传 + SHA-256 校验 | 4-5 天 |
| Named Pipe IPC Server | 接收 JSON 指令，执行文件发送（为 YiboFile 预留） | 2 天 |
| 系统托盘 | 开机自启、托盘图标、右键菜单 | 1-2 天 |

### 第三阶段：客户端 UI

**目标**：桌面端配置界面 + 移动端基本功能。

| 任务 | 验收标准 | 预估 |
|------|---------|------|
| Tauri 配置面板 | 缩略语管理、设备管理、同步设置 | 5-7 天 |
| Flutter App (Android) | 剪切板查看/同步、文件接收、缩略语配置 | 7-10 天 |
| iOS 适配 | 待获取开发者账号后进行 | 待定 |

### 第四阶段：生态闭环与打磨

**目标**：YiboFile 集成 + 整体优化。

| 任务 | 验收标准 | 预估 |
|------|---------|------|
| YiboFile 集成桥接 | 右键菜单触发文件发送（通过 Named Pipe） | 3-4 天 |
| 全链路测试 | 多设备同步、断点续传、TTL 清理集成测试 | 3-5 天 |
| 性能优化 | NFR 指标全部达标 | 2-3 天 |

---

## 14. 隐私与数据安全声明

虽然 YiboFlow 为私有部署，仍需遵循以下数据处理原则：

* **最小化存储**：仅存储用户主动同步的数据，不采集额外信息
* **TTL 强制过期**：所有临时数据必须有过期时间，到期自动物理删除
* **零知识架构**：NAS 服务端不存储、不处理任何明文内容
* **用户可控**：用户可随时导出/删除个人数据和全部设备记录

---

## 15. 未来功能规划与愿景 (Future Outlook)

记录后续计划引入的体验增强与架构突破功能：

### 15.1 全局感知级智能补全与预测系统 (Auto-Complete & AI Prediction)
* **全局输入状态机与监控**：软件启动后即进入静默监控模式，嗅探用户的高频输入习惯。
* **规则级智能提示 (类似 AI IDE 补全)**：根据当前输入的上下文，提供半透明的悬浮代码或文本补全提示（类似于 Copilot 的 Ghost Text 体验）。支持用户自定义的程序语言库与词典库。
* **(远期) 接入大模型 (LLM) 的打字辅助预测推荐引擎**：
  * 利用大语言模型 "预测下一个概率最高的 Token (字词)" 的天然特性。
  * **混合部署架构 (Hybrid AI Architecture)**：
    * **Cloud API**：接入云端强大的大语言模型 API（如 DeepSeek, OpenAI 等）。
    * **NAS Local LLM**：充分利用 NAS 硬件算力，使用类似 Ollama 或 llama.cpp 等技术，在 NAS 端旁路部署一个十几亿参数的超轻量级本地模型（专精 Next-Token 预测）。实现绝对隐私的零延迟/内网低延迟的高性能文字补全引擎。
  * **形态体现**：在用户打字时，像一个“增强版输入法候选框”一样悬浮在屏幕光标附近，提供 AI 实时预测的下文内容。
  * 通过配置专门的热键（如 `Tab` 等）让用户以惊人的速度直接一键确认上屏输入。这与“缩略语”、“常规补全”属于一脉相承的效率增强进化。

### 15.2 物理按键级重映射层 (Hardware Key Remapping)
* **键位级功能替代 (Key Substitution)**：支持极其深度的硬件级按键拦截与置换。
  * **硬核刚需场景**：针对特殊尺寸/紧凑型键盘（如 Pad 键盘没有物理 F1 等功能键），允许用户将其他任意物理按键（如 `[` 或长按某功能键组合）**在系统底层直接映射替换** 为所需的物理按键功能（如 `F2` 重命名指令等）。

### 15.2 缩略语增强架构 (Snippets Advanced)
* **文件夹嵌套管理 (Folders & Categories)**：引入树状分类系统，支持将数百上千个缩略语分配进不同的多级文件夹中进行结构化收纳与快速定位。

### 15.3 国际化与视觉进化 (i18n & Theming)
* **多语言架构 (i18n)**：彻底抽离桌面端与移动端的硬编码文本，首期提供 **中文 / English** 双语无缝切换。
* **外观模式 (Light/Dark Mode)**：引入全局主题引擎，支持明亮模式 (Light) 和暗黑模式 (Dark)，并支持跟随跨系统 (Windows/macOS/iOS) 主题自动色板平滑切换。
