# 多 IDE 并列接入指南

> 目标：后续接入新的 IDE 或 Agent 工具时，保持“并列入口、分层复用、专用实现隔离”，避免重新退化为一个不断膨胀的“总代理页”。  
> 当前基线：桌面端已按 `Codex` 专页模式完成第一轮拆分。  
> 关联文档：[provider-addition-guide.md](provider-addition-guide.md)、[refactoring-analysis-plan.md](refactoring-analysis-plan.md)、[specs-v2.md](specs-v2.md)

---

## 1. 当前结论

后续新增 IDE 时，不要继续把所有逻辑塞进一个统一的“代理 / Agents”页面。

正确方向是：

- 导航层并列：`Codex`、未来的 `Cursor`、`Claude Code`、`Windsurf` 等各自作为并列入口
- 公共层复用：只抽共享壳子、共享样式、共享协议抽象
- 专用层隔离：每个 IDE 各自维护自己的页面、分区组件、桥接逻辑、文案和特殊交互

这不是纯 UI 偏好，而是工程边界要求。

原因：

- 不同 IDE 的会话模型、配置项、审批机制、事件流和连接方式并不一致
- 如果全部揉进一个页面，条件分支会快速膨胀
- 后续修某个 IDE 的同步问题时，容易误伤别的 IDE
- 移动端和桌面端都需要同样的“公用层 / 专用层”边界，否则后面会越来越乱

---

## 2. 当前代码落点

桌面端目前已经形成下面这层结构：

```text
desktop/src/
  config/
    ideWorkbenches.ts                 # IDE 并列导航注册
  pages/
    workbench/
      WorkbenchPageShell.tsx          # 公共页面壳
      primitives.tsx                  # 公共 UI 原语
    codex/
      index.tsx
      CodexWorkbenchPage.tsx          # Codex 页主控：状态、同步、RPC、拼装
      CodexWorkbenchSections.tsx      # Codex 分区组件
    Agents.tsx                        # 旧入口兼容壳，不再承载真实实现
  services/
    codexBridge.ts                    # Codex 专用桥接与数据整形
```

其中职责已经明确：

- `pages/workbench/`：跨 IDE 复用的页面骨架与基础 UI
- `pages/codex/`：Codex 专用页面与专用区块
- `config/ideWorkbenches.ts`：并列入口注册表
- `pages/Agents.tsx`：历史兼容，不允许再继续堆业务

---

## 3. 新增一个 IDE 的正确方式

以未来新增 `Cursor` 为例，建议按下面顺序推进。

### 3.1 新建独立入口

先创建独立目录，而不是改现有 `codex/`：

```text
desktop/src/pages/cursor/
  index.tsx
  CursorWorkbenchPage.tsx
  CursorWorkbenchSections.tsx
```

要求：

- `CursorWorkbenchPage.tsx` 只负责状态、同步、RPC、拼装
- `CursorWorkbenchSections.tsx` 负责 `sidebar / conversation / composer / config` 等 UI 分区
- 不要把 Cursor 的特殊逻辑写回 `CodexWorkbenchPage.tsx`

### 3.2 注册并列导航

在 [desktop/src/config/ideWorkbenches.ts](/F:/Download/GitHub/YiboVibe/desktop/src/config/ideWorkbenches.ts) 里追加一个新入口。

建议结构：

```ts
export type IdeWorkbenchId = "codex" | "cursor";

export const IDE_WORKBENCH_NAV = [
  {
    id: "codex",
    path: "/app/codex",
    labelKey: "nav.codex",
    tooltipKey: "nav.tooltip_codex",
  },
  {
    id: "cursor",
    path: "/app/cursor",
    labelKey: "nav.cursor",
    tooltipKey: "nav.tooltip_cursor",
  },
];
```

注意：

- 新 IDE 必须作为并列项追加
- 不要把新 IDE 做成 `Codex` 页内的 tab
- 不要恢复“统一 Agents 页面切 provider”的方案

### 3.3 在 App 路由中独立挂载

在 [desktop/src/App.tsx](/F:/Download/GitHub/YiboVibe/desktop/src/App.tsx) 中按独立页面挂载：

```tsx
const CursorPage = lazy(() => import("./pages/cursor/CursorWorkbenchPage"));
```

并增加独立路由：

```tsx
<Route path="cursor" element={<Suspense fallback={<PageFallback />}><CursorPage /></Suspense>} />
```

原则：

- 每个 IDE 一个单独页面组件
- 旧路径只允许做 redirect，不允许继续承载真实实现

---

## 4. 公用层和专用层怎么分

### 4.1 应该抽到公用层的内容

以下内容适合进入 `pages/workbench/` 或通用服务层：

- 页面标题区骨架
- 页面错误提示骨架
- 通用面板头
- 通用空状态
- 通用小图标按钮样式
- 与具体 IDE 无关的基础布局原语
- 通用 provider 接口、注册表、错误模型

判断标准：

- 这个能力是否不关心“底层到底是 Codex 还是 Cursor”
- 这个组件是否只是容器、壳子、样式原语
- 这个逻辑是否没有 IDE 特有字段和特殊分支

### 4.2 应该留在 IDE 专用层的内容

以下内容应保留在 `pages/<ide>/` 或 `services/<ide>/`：

- 会话列表整形方式
- 项目分组策略
- 模型、审批、权限、沙箱等专用配置
- 特定 IDE 的消息类型解析
- 特定 IDE 的事件流、同步策略、轮询策略
- 特定 IDE 的 fallback 通道
- 特定 IDE 的文案和动作按钮

判断标准：

- 是否依赖某个 IDE 的协议字段
- 是否存在这个 IDE 特有的配置项或行为
- 是否未来大概率只会在这个 IDE 内变化

---

## 5. 桥接层的推荐做法

UI 只是表层，真正决定可扩展性的还是桥接层。

建议保持下面的结构：

```text
desktop/src/services/
  aiWorkbench/                       # 通用抽象层
  codexBridge.ts                     # 现有 Codex 专用桥接
  cursorBridge.ts                    # 未来 Cursor 专用桥接
```

更理想的长期形态：

```text
desktop/src/services/aiWorkbench/
  codex/
  cursor/
  claude-code/
```

每个 IDE 的桥接层至少要自己负责：

- 连接方式
- 线程 / 会话读取
- 消息发送
- 配置读写
- 消息整形
- 审批 / 权限事件提取
- 同步事件合并

不要做的事：

- 在一个 `bridge.ts` 里写多个 IDE 的 if/else
- 把 UI 组件内部变成桥接协议解释器
- 把不同 IDE 的字段强行压成一套脆弱的硬编码映射

---

## 6. 推荐的新增步骤清单

新增一个 IDE，建议按这个最小路径推进：

1. 先确认它是否真的需要独立入口，而不是已有能力可复用
2. 新建 `pages/<ide>/`
3. 在 `ideWorkbenches.ts` 注册新入口
4. 在 `App.tsx` 挂独立路由
5. 新建该 IDE 的 bridge / adapter
6. 先打通最小链路：项目列表、会话列表、读取、发送
7. 再接配置项、审批、事件流、后台刷新
8. 最后再补移动端并列接入

推荐推进顺序：

- 第一步：桌面端只做只读接入
- 第二步：支持发送与中断
- 第三步：支持配置拉取与写回
- 第四步：支持后台静默刷新
- 第五步：支持移动端映射

---

## 7. 移动端应保持同样思路

移动端不要做成：

- 一个“工具页”里混合所有 IDE 的特有逻辑
- 一个 session body 里靠大量条件分支兼容不同 IDE

应保持：

- 工具层并列：`Codex`、未来 `Cursor`、`Claude Code`
- 公共层复用：列表、骨架、同步容器、基础卡片
- 专用层隔离：各自的 session body、composer extras、配置区、事件解析

也就是说，桌面端怎么分，移动端最终也应该怎么分。

---

## 8. 验收标准

新增一个 IDE 后，至少满足下面这些标准才算接入方式正确：

- 导航里它是并列入口，不是 `Codex` 页内分支
- 它有自己的 `pages/<ide>/` 目录
- 它没有把专用逻辑写回 `pages/codex/`
- 它没有继续扩写 `pages/Agents.tsx`
- 它的 bridge / adapter 是独立文件
- 它能独立刷新，不依赖硬编码假数据
- 它的项目、会话、消息、配置链路能独立验证

反例信号：

- 又开始往 `Agents.tsx` 写业务
- 一个页面里出现大量 `if (provider === "...")`
- `CodexWorkbenchSections.tsx` 里开始出现 `Cursor` 字样
- 为了复用而把多个 IDE 的特有字段强行塞进一个组件

---

## 9. 与现有文档的关系

本文档关注的是“多 IDE 并列接入的页面与代码组织方式”。

相关但不等价的文档：

- [provider-addition-guide.md](provider-addition-guide.md)
  - 更偏 provider / adapter 接入
- [refactoring-analysis-plan.md](refactoring-analysis-plan.md)
  - 更偏历史重构分析和拆分方向
- [mobile-ai-workbench-ui-plan-2026-05-28.md](mobile-ai-workbench-ui-plan-2026-05-28.md)
  - 更偏移动端产品形态

如果未来出现实现冲突，以当前实际代码结构和本文件约束为准，再同步更新其它文档。
