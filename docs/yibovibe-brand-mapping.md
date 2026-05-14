# YiboFlow -> YiboVibe 命名映射清单

更新时间：2026-05-11

## 1. 目的

本文档用于统一记录主品牌从 `YiboFlow` 切换到 `YiboVibe` 的命名映射、当前执行范围和后续保留项。

当前策略：

- 主品牌统一改为 `YiboVibe`
- `Flow*` 模块命名继续保留
- 先修改对外身份、部署身份和本地落盘身份
- 暂不强制修改 crate 名、内部模块名和构建元数据环境变量名

## 2. 主品牌与副标题

| 层级 | 旧值 | 新值 | 当前处理 |
|------|------|------|----------|
| 主品牌 | `YiboFlow` | `YiboVibe` | 现在改 |
| 产品方向描述 | `本地优先桌面生产力工具` | `Vibe Coding Tools` | 现在改 |
| 模块体系 | `FlowProbe` / `FlowSync` / `FlowKeys` 等 | 保留 | 保留 |

建议对外写法：

- `YiboVibe`
- `YiboVibe: Vibe Coding Tools`

## 3. 现在改

### 3.1 仓库与文档对外身份

| 类型 | 旧值 | 新值 |
|------|------|------|
| README 标题 | `YiboFlow` | `YiboVibe` |
| v2 规格文档标题 | `YiboFlow v2 ...` | `YiboVibe ...` |
| v2 架构文档标题 | `YiboFlow v2 ...` | `YiboVibe ...` |
| v2 UI 文档标题 | `YiboFlow v2 ...` | `YiboVibe ...` |

### 3.2 桌面应用对外身份

| 类型 | 旧值 | 新值 |
|------|------|------|
| Tauri productName | `YiboFlow Desktop` | `YiboVibe Desktop` |
| 主窗口标题 | `YiboFlow` | `YiboVibe` |
| 第二实例标题 | `YiboFlow Sim 2` | `YiboVibe Sim 2` |
| Bundle ID | `com.yiboflow.desktop` | `com.yibovibe.desktop` |
| Sim2 Bundle ID | `com.yiboflow.desktop.sim2` | `com.yibovibe.desktop.sim2` |

### 3.3 Docker / 服务端部署身份

| 类型 | 旧值 | 新值 |
|------|------|------|
| Docker 镜像 | `datouluobo/yiboflow-server` | `datouluobo/yibovibe-server` |
| Compose 环境变量 | `YIBOFLOW_API_IMAGE` | `YIBOVIBE_API_IMAGE` |
| API 容器名 | `yiboflow_api` | `yibovibe_api` |
| Gateway 容器名 | `yiboflow_ai_gate` | `yibovibe_ai_gate` |
| DB 容器名 | `yiboflow_db` | `yibovibe_db` |
| Redis 容器名 | `yiboflow_redis` | `yibovibe_redis` |
| Docker 网络 | `yiboflow_net` | `yibovibe_net` |
| 服务端二进制 | `yiboflow_server` | `yibovibe_server` |

### 3.4 本地落盘与对外环境变量

| 类型 | 旧值 | 新值 |
|------|------|------|
| 默认数据目录 | `%APPDATA%/YiboFlow` | `%APPDATA%/YiboVibe` |
| 数据目录变量 | `YIBOFLOW_DATA_DIR` | `YIBOVIBE_DATA_DIR` |
| 多实例变量 | `YIBOFLOW_ALLOW_MULTI_INSTANCE` | `YIBOVIBE_ALLOW_MULTI_INSTANCE` |
| 实例标签变量 | `YIBOFLOW_INSTANCE_TAG` | `YIBOVIBE_INSTANCE_TAG` |
| 设备指纹变量 | `YIBOFLOW_MACHINE_FINGERPRINT` | `YIBOVIBE_MACHINE_FINGERPRINT` |
| NAS 暂存目录变量 | `YIBOFLOW_STAGING_DIR` | `YIBOVIBE_STAGING_DIR` |

### 3.5 前端本地存储 key 前缀

统一从：

- `yiboflow_*`

切换到：

- `yibovibe_*`

适用范围包括：

- 登录态
- 服务端地址
- 用户名
- 设备名
- 主题
- 语言
- FlowKeys profile
- FlowSync 面板偏好

## 4. 暂缓到后续再改

### 4.1 Rust / Go 内部包名

| 类型 | 当前值 | 建议 |
|------|--------|------|
| Rust crate | `yiboflow-core` | 后续再评估 |
| Rust `use yiboflow_core::...` | 大量存在 | 暂不动 |
| Go module path | `github.com/datouluobo/YiboFlow/server` | `github.com/datouluobo/YiboVibe/server` |
| `server/cmd/yiboflow` 路径 | 旧名目录 | 暂不动 |

原因：

- 这些属于内部实现标识
- `go.mod` 与 import path 已在主仓库改名后统一
- 剩余目录名与命令路径可后续再评估

### 4.2 移动端目录状态

| 类型 | 当前值 | 建议 |
|------|--------|------|
| 移动端目录 | `mobile/` | 已并入主仓库 |
| 当前平台优先级 | `android` | 先落 Android，再补 iOS |

原因：

- 原 `YiboFlow-Mobile` 独立仓库未承载真实业务代码
- 当前主线更适合把移动端作为主仓库内部目录维护
- 目录采用 `mobile/android/` 比直接使用根级 `android/` 更利于后续扩展

### 4.3 构建元数据环境变量

| 类型 | 当前值 | 建议 |
|------|--------|------|
| `YIBOFLOW_BUILD_*` | 保留 | 暂不动 |

原因：

- 主要用于内部构建信息注入
- 不影响用户、部署和文档品牌感知

## 5. 明确保留

以下命名不建议因为主品牌切换而强行改名：

- `FlowDeck`
- `FlowSnap`
- `FlowHint`
- `FlowSync`
- `FlowDrop`
- `FlowRules`
- `FlowKeys`
- `FlowProbe`

原因：

- 它们已经形成稳定的功能语义层
- 与主品牌 `YiboVibe` 并不冲突
- 比强行改成 `Vibe*` 更清晰、更低风险

## 6. 后续阶段建议

1. 先完成当前清单中的“现在改”
2. 再处理 GitHub 仓库改名与远端地址
3. 最后评估是否要统一 crate 名、Go module path 与源码目录名

## 7. 更新记录

| 日期 | 变更 |
|------|------|
| 2026-05-11 | 初始创建 |
| 2026-05-11 | Cargo.toml 描述/作者改为 YiboSoft |
| 2026-05-11 | 导出配置扩展名改为 .yvb |
| 2026-05-11 | FlowInfo GitHub 链接更新为 YiboVibe |
| 2026-05-11 | POSTGRES_DB 改为 yibovibe |
| 2026-05-11 | GitHub 仓库重命名已完成 |
| 2026-05-11 | Docker Hub 镜像切换推迟到下个版本 |
| 2026-05-11 | Rust crate yiboflow-core 保留暂不重命名 |
| 2026-05-11 | server/cmd/yiboflow 目录保留暂不重命名 |
