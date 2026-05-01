# AGENTS.md

## 项目定位

YiboFlow 当前是桌面优先的本地生产力工具：

- `core/`：Rust 共享能力层
- `desktop/`：Tauri + React 桌面端
- `server/`：登录、认证、设备管理、配置保存与同步
- `YiboFlow-Mobile/`：移动端骨架，当前不应视为完整实现

## 当前产品边界

当前应按 [docs/specs.md](/F:/Download/GitHub/YiboFlow/docs/specs.md) 理解产品范围。

保留模块：

- `FlowDeck`
- `FlowSnap`
- `FlowHint`
- `FlowSync`
- `FlowDrop`
- `FlowRules`
- `FlowKeys`
- `FlowProbe`
- `Settings`

约束：

- `FlowProbe` 只是桌面端本机直连第三方 API 的测试工具，不是主业务链路。
- `server/` 不是 AI 网关，不负责第三方模型代理。
- 不要默认把旧页面、旧目录或残留文件当作当前产品承诺。

## 目录职责

- `core/src/hook_manager.rs`、`core/src/clipboard.rs`：输入捕获和剪贴板核心热点
- `desktop/src/pages/`：桌面产品页面
- `desktop/src/components/FlowKeys/`：键位映射相关复杂 UI
- `desktop/src-tauri/`：桌面原生桥接
- `server/cmd/yiboflow/main.go`：服务端入口
- `server/internal/`：handler、service、repo、ws 等后端实现
- `docs/`：规格、分析、部署文档

## 协作规则

1. 修改功能边界前，先对齐 `docs/specs.md`。
2. 需要判断真实入口时，优先看 manifest、router 和实际入口文件，不要猜。
3. 评估项目规模时，区分源码和构建产物；`target/`、`node_modules/` 不代表业务复杂度。
4. 非必要不要扩展 AI 相关范围；当前 AI 能力只收敛在 `FlowProbe`。
5. 删除文件或目录前，必须先向用户给出明确删除清单并获得确认；得到确认后，才可删除已确认路径。

## 删除规则

- 允许删除已确认的构建产物、诊断产物和其它明确无用的中间文件。
- 删除前必须先列出计划删除的具体路径，并得到用户明确确认。
- 未经确认，不要直接删除文件或目录。
- 执行删除时，优先使用明确路径，避免模糊匹配。

## 常用验证

- `cargo check -p yiboflow-core`
- `cargo check -p tauri-app`
- `cd desktop && npm run build`
