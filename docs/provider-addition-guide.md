# 新增 AI IDE Provider 接入指南

> 目标：将接入一个新 AI IDE Provider 的成本从改 4-6 个文件降至 1-2 个文件  
> 适用范围：Cursor、Claude Code、Windsurf、GitHub Copilot 等  
> 关联文档：[specs-v2.md](specs-v2.md)、[refactoring-analysis-plan.md](refactoring-analysis-plan.md)

---

## 目录

1. [架构总览](#一架构总览)
2. [桌面端：新增一个 Provider](#二桌面端新增一个-provider)
3. [移动端：对应适配](#三移动端对应适配)
4. [Rust 后端：新增 AgentRuntime（可选）](#四rust-后端新增-agentruntime可选)
5. [验证清单](#五验证清单)
6. [参考案例：Codex Adapter 实现](#六参考案例codex-adapter-实现)
7. [常见问题](#七常见问题)

---

## 一、架构总览

新增 provider 的核心抽象是 **`AiWorkbenchAdapter`** 接口，定义在 `desktop/src/services/aiWorkbench.ts`：

```typescript
export interface AiWorkbenchAdapter {
  provider: AiWorkbenchProvider;              // 元信息
  listConversations(params?): Promise<AiWorkbenchConversation[]>;
  readConversation(id): Promise<AiWorkbenchConversation>;
  createConversation(params): Promise<AiWorkbenchConversation>;
  renameConversation(id, name): Promise<void>;
  archiveConversation(id): Promise<void>;
  sendMessage(conversationId, text, options?): Promise<void>;
  cancelTurn(conversationId, turnId): Promise<void>;
  listModels(params?): Promise<AiWorkbenchModel[]>;
  readConfig(params?): Promise<AiWorkbenchConfig>;
  updateConfig(config): Promise<void>;
}
```

### 文件层级

```
desktop/src/services/aiWorkbench/
  adapter.ts              ← AiWorkbenchAdapter 接口定义（已有，不要改）
  registry.ts             ← ProviderRegistry（已有，不要改）
  types.ts                ← 类型导出（已有）
  index.ts                ← barrel 导出（已有）
  codex/
    adapter.ts            ← Codex 实现（参考）
    transport.ts          ← Codex 的 IPC 封装
    transcript.ts         ← Codex 的数据转换
  cursor/                 ← 【你要创建的目录】
    adapter.ts            ← Cursor 适配器实现
    transport.ts          ← Cursor 的 IPC/通信封装
    transcript.ts         ← Cursor 的数据转换（可选）
  claude-code/            ← 【你要创建的目录】
    adapter.ts            ← Claude Code 适配器实现
    transport.ts          ← stdio 通信封装
    transcript.ts         ← 数据转换（可选）
```

---

## 二、桌面端：新增一个 Provider

### Step 1：创建 provider 目录

```
desktop/src/services/aiWorkbench/cursor/
```

### Step 2：实现 transport.ts（通信层）

封装与目标 IDE 的具体通信方式。三种典型场景：

#### 场景 A：App Server IPC（类似 Codex）

```typescript
// transport.ts — 通过 Tauri IPC + persistent app-server 通信
import { invoke } from "@tauri-apps/api/core";

export interface CursorRpcRequest {
  method: string;
  params: Record<string, unknown>;
}

export async function requestCursorRpc<T>(
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  // 方式1：如果 Cursor 有自己的 app-server
  const response = await invoke<{ result?: T; error?: { message: string } }>(
    "cursor_rpc_request", { request: { method, params } }
  );
  if (response.error) throw new Error(response.error.message);
  return response.result!;

  // 方式2：或者直接通过 stdio 调用 cursor CLI
  // const proc = Deno.run({ cmd: ["cursor", "--rpc", JSON.stringify({method, params})] });
}
```

#### 场景 B：CLI stdio（适合 Claude Code、Copilot）

```typescript
// transport.ts — 通过 stdio 子进程通信
import { invoke } from "@tauri-apps/api/core";

export interface StdioRequest {
  command: string;
  args: string[];
  input?: string;
}

export async function requestStdio<T>(
  cmd: string,
  args: string[],
  input?: string
): Promise<T> {
  // 方式1：通过 Tauri shell command（推荐）
  // 需要在 Rust 端注册一个 shell 命令
  return invoke<T>("run_stdio_command", {
    command: cmd,
    args,
    input: input ?? null,
  });

  // 方式2：或者用 Tauri shell plugin
  // import { Command } from "@tauri-apps/plugin-shell";
  // const output = await Command.create(cmd, args).execute();
  // return JSON.parse(output.stdout);
}
```

#### 场景 C：HTTP/REST API（适合远程服务）

```typescript
// transport.ts — 通过 HTTP 请求通信
export async function requestHttp<T>(
  url: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}
```

### Step 3：实现 transcript.ts（数据转换）

将 provider 的原生数据模型转换为统一的 `AiWorkbenchConversation` / `AiWorkbenchMessage` 等类型。

```typescript
// transcript.ts — Cursor 数据 → AiWorkbench 数据
import type {
  AiWorkbenchConversation,
  AiWorkbenchModel,
  AiWorkbenchConfig,
  AiWorkbenchStatus,
} from "../../aiWorkbench";

// 定义 Cursor 的原生类型
export interface CursorConversation {
  id: string;
  title: string;
  // ... 其他 Cursor 特有字段
}

export function toWorkbenchConversation(cursor: CursorConversation): AiWorkbenchConversation {
  return {
    id: cursor.id,
    providerId: "cursor",
    title: cursor.title,
    status: "idle",
    // ... 映射其他字段
  };
}

export function toWorkbenchModel(cursorModel: unknown): AiWorkbenchModel {
  // 模型映射
}

export function toWorkbenchConfig(cursorConfig: unknown): AiWorkbenchConfig {
  // 配置映射
}
```

### Step 4：实现 adapter.ts（核心适配器）

实现 `AiWorkbenchAdapter` 接口。必须实现 **全部 11 个方法**（2 个属性 + 9 个 async 方法）。

```typescript
// adapter.ts — Cursor AiWorkbenchAdapter 实现
import type {
  AiWorkbenchAdapter,
  AiWorkbenchProvider,
  AiWorkbenchConversation,
  AiWorkbenchConfig,
  AiWorkbenchModel,
  AiWorkbenchSendOptions,
  AiWorkbenchCapability,
} from "../../aiWorkbench";

import { requestCursorRpc } from "./transport";
import { toWorkbenchConversation, toWorkbenchModel, toWorkbenchConfig } from "./transcript";

// 1. 定义 provider 元信息
const CURSOR_PROVIDER: AiWorkbenchProvider = {
  id: "cursor",
  name: "Cursor IDE",
  transport: "app-server",       // 根据实际情况选: "app-server" | "desktop-ipc" | "stdio" | "http" | "custom"
  capabilities: [
    "conversation-list",
    "conversation-read",
    "conversation-create",
    "message-send",
    "turn-cancel",
    "model-list",
    "config-read",
    "config-write",
  ] as AiWorkbenchCapability[],
};

// 2. 实现适配器
export function createCursorWorkbenchAdapter(): AiWorkbenchAdapter {
  return {
    provider: CURSOR_PROVIDER,

    async listConversations(params) {
      // 调用 transport 层获取数据
      const data = await requestCursorRpc<{ conversations: CursorConversation[] }>(
        "conversation/list", { limit: params?.limit ?? 50 }
      );
      return data.conversations.map(toWorkbenchConversation);
    },

    async readConversation(id) {
      const data = await requestCursorRpc<{ conversation: CursorConversation }>(
        "conversation/read", { conversationId: id }
      );
      return toWorkbenchConversation(data.conversation);
    },

    async createConversation(params) {
      const data = await requestCursorRpc<{ conversation: CursorConversation }>(
        "conversation/create", { cwd: params?.cwd }
      );
      return toWorkbenchConversation(data.conversation);
    },

    async renameConversation(id, name) {
      await requestCursorRpc("conversation/rename", { conversationId: id, name });
    },

    async archiveConversation(id) {
      await requestCursorRpc("conversation/archive", { conversationId: id });
    },

    async sendMessage(conversationId, text, options) {
      await requestCursorRpc("conversation/send", {
        conversationId,
        text,
        model: options?.model,
      });
    },

    async cancelTurn(conversationId, turnId) {
      await requestCursorRpc("turn/cancel", { conversationId, turnId });
    },

    async listModels(params) {
      const data = await requestCursorRpc<{ models: CursorModel[] }>("model/list", {
        includeHidden: params?.includeHidden,
      });
      return data.models.map(toWorkbenchModel);
    },

    async readConfig(params) {
      const data = await requestCursorRpc<{ config: CursorConfig }>("config/read", {
        cwd: params?.cwd,
      });
      return toWorkbenchConfig(data.config);
    },

    async updateConfig(config) {
      await requestCursorRpc("config/write", { config });
    },
  };
}
```

### Step 5：注册到 Registry

在应用启动时注册新 provider，**这就是"1-2 个文件"的核心**：

```typescript
// desktop/src/services/aiWorkbench/cursor/adapter.ts（文件底部）
import { AiWorkbenchRegistry } from "../registry";

// 自动注册（模块加载时执行）
AiWorkbenchRegistry.getInstance().register("cursor", createCursorWorkbenchAdapter);
```

或在应用入口处注册：

```typescript
// desktop/src/main.tsx 或 App.tsx
import { AiWorkbenchRegistry } from "./services/aiWorkbench";
import { createCursorWorkbenchAdapter } from "./services/aiWorkbench/cursor/adapter";

// 注册
AiWorkbenchRegistry.getInstance().register("cursor", createCursorWorkbenchAdapter);

// 切换到新 provider
AiWorkbenchRegistry.getInstance().setActive("cursor");
```

### Step 6（可选）：更新 barrel export

```typescript
// desktop/src/services/aiWorkbench/index.ts
export * from "./types";
export { AiWorkbenchRegistry } from "./registry";
export { createCodexWorkbenchAdapter } from "./codex/adapter";
export { createCursorWorkbenchAdapter } from "./cursor/adapter";        // ← 新增
```

---

## 三、移动端：对应适配

如果移动端需要支持新 provider，只需同步更新模型文件：

```dart
// mobile/android/lib/models/ai_workbench.dart
// 在现有 AiWorkbenchProvider 类中，确保 id 字段支持新 provider
// provider 的 id 是 String 类型，已支持任意值

// 示例：创建一个 Cursor 适配器
final cursorProvider = AiWorkbenchProvider(
  id: 'cursor',
  name: 'Cursor IDE',
  transport: 'app-server',
  capabilities: ['conversation-list', 'message-send'],
);
```

移动端本身不直接与 provider 通信，而是通过桌面端中转（Signal Hub）。移动端只需要能够显示 provider 的名称和状态即可。

---

## 四、Rust 后端：新增 AgentRuntime（可选）

如果新 provider 需要桌面端原生支持（如后台进程管理、生命周期控制），可以实现 `AgentRuntime` trait：

```rust
// core/src/agent_host/runtime.rs 定义了 trait:
pub trait AgentRuntime: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn probe(&self) -> RuntimeProbeResult;
    fn capabilities(&self) -> HashSet<RuntimeCapability>;
}
```

```rust
// 示例：CursorRuntime
pub struct CursorRuntime {
    endpoint: String,
}

impl AgentRuntime for CursorRuntime {
    fn id(&self) -> &'static str { "cursor" }
    fn display_name(&self) -> &'static str { "Cursor IDE" }
    
    fn probe(&self) -> RuntimeProbeResult {
        // 检测本机是否安装了 Cursor
        let installed = std::path::Path::new("C:/Users/.../AppData/Local/Programs/Cursor/Cursor.exe").exists();
        RuntimeProbeResult {
            available: installed,
            version: None,
            display_name: "Cursor IDE".to_string(),
            transport: "app-server".to_string(),
        }
    }
    
    fn capabilities(&self) -> HashSet<RuntimeCapability> {
        use RuntimeCapability::*;
        [SessionManagement, EventStream, ModelDiscovery].into()
    }
}

// 注册
use std::sync::OnceLock;
static REGISTRY: OnceLock<RuntimeRegistry> = OnceLock::new();
REGISTRY.get_or_init(|| {
    let reg = RuntimeRegistry::new();
    reg.register(Box::new(CursorRuntime { endpoint: "http://localhost:12345".into() }));
    reg
});
```

---

## 五、验证清单

| 步骤 | 命令 | 预期结果 |
|------|------|---------|
| TypeScript 编译 | `npm --prefix desktop run build` | ✅ 无错误 |
| Rust 编译（如有 AgentRuntime） | `cargo check -p yibovibe-core` | ✅ 无错误 |
| Tauri 编译（如有 Tauri 命令） | `cargo check -p tauri-app` | ✅ 无错误 |
| 注册生效 | 打开桌面端 Agents 页，查看 provider 列表 | 新 provider 出现 |
| 功能回归 | 创建/发送/取消对话 | 功能正常 |

---

## 六、参考案例：Codex Adapter 实现

完整的 Codex adapter 实现位于：

```
desktop/src/services/aiWorkbench/codex/
├── adapter.ts              ← AiWorkbenchAdapter 实现
├── transport.ts            ← Tauri IPC 封装
└── transcript.ts           ← 数据转换
```

作为参考模板，直接复制 `codex/` 目录后修改即可：

1. 复制 `codex/` → 重命名为 `cursor/`
2. 修改 `transport.ts` 中的 IPC 调用方式
3. 修改 `transcript.ts` 中的数据类型映射
4. 修改 `adapter.ts` 中的 provider 元信息和方法实现

---

## 七、常见问题

### Q: 需要改 Rust 后端吗？

**大多数情况不需要。** 如果新 provider 通过 stdio 或 HTTP 通信，TypeScript 层可以直接完成。只有在需要桌面端原生进程管理时才需要 Rust 端的 `AgentRuntime`。

### Q: 新增 provider 需要重启应用吗？

Registry 是运行时注册的，**不需要重启**。调用 `setActive("cursor")` 即可动态切换。

### Q: 支持多个 provider 同时激活吗？

当前架构设计为**单一活跃 provider**。前端 Agents 页面一次只连接一个 provider。可以通过 `setActive()` 切换。

### Q: 如何自动探测本地是否安装了某 provider？

```typescript
// 在 adapter.ts 中实现探测逻辑
export async function probeCursorInstalled(): Promise<boolean> {
  try {
    // 方式1: 尝试连接已知端口
    const response = await fetch("http://localhost:31245/health");
    return response.ok;
  } catch {
    // 方式2: 检查文件是否存在
    // ... 通过 invoke 调用 Rust 端的 path 检查
    return false;
  }
}

// 注册时结合 probe
if (await probeCursorInstalled()) {
  AiWorkbenchRegistry.getInstance().register("cursor", createCursorWorkbenchAdapter);
}
```

### Q: 测试新 provider 的最快方式？

```typescript
// 在浏览器控制台（开发模式）
import { AiWorkbenchRegistry, createCursorWorkbenchAdapter } from "./services/aiWorkbench";

const registry = AiWorkbenchRegistry.getInstance();
registry.register("cursor", createCursorWorkbenchAdapter);
registry.setActive("cursor");

const adapter = registry.getActive();
const conversations = await adapter.listConversations();
console.log(conversations);
```
