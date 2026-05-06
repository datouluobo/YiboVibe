# YiboFlow 传输能力对比报告

日期：2026-05-01

对比对象：

- YiboFlow `FlowDrop`
- [LocalSend](https://github.com/localsend/localsend)
- [alt-sendme](https://github.com/tonyantony300/alt-sendme)

## 1. 结论摘要

当前的 YiboFlow `FlowDrop` 更接近一个“已打通最小链路的半成品传输能力”：

- 已具备基础发送链路：桌面端可选文件，服务端通过 WebSocket 协调，端侧再走点对点 TCP 传输。
- 接收链路也已存在：收到 `p2p_file_offer` 后会主动连接发送端，并把文件落到下载目录。
- 但它离成熟可用的文件传输产品还有明显差距，尤其体现在：
  - 发现方式依赖 YiboFlow 账号体系和在线设备列表，不是纯局域网自发现。
  - 当前发送目标没有真正绑定到用户在 UI 中点击的具体设备，实际代码里仍把 `targetDevice` 传成 `0`。
  - 没有显式接收确认、没有断点续传、没有完整性校验、没有传输加密、没有进度和历史闭环。

对比结论可以直接概括为：

- `YiboFlow FlowDrop`：适合做“YiboFlow 自有账号设备之间的受控传输模块”，暂不适合直接对标通用成熟传输工具。
- `LocalSend`：最适合“同一局域网内、零账号、跨平台、稳定可用”的近场互传。
- `alt-sendme`：最适合“跨局域网甚至跨公网、强调隐私和高速、需要 NAT 穿透和断点续传”的现代 P2P 传输。

## 2. 本次分析依据

### 2.1 YiboFlow 本地代码与文档

- `desktop/src/pages/FlowDrop.tsx`
- `core/src/p2p.rs`
- `core/src/clipboard.rs`
- `desktop/src-tauri/src/lib.rs`
- `core/src/api.rs`
- `server/internal/ws/hub.go`
- `docs/specs.md`
- `docs/analysis_report.md`

### 2.2 外部项目官方资料

- LocalSend 仓库 README: <https://github.com/localsend/localsend>
- LocalSend 协议文档: <https://github.com/localsend/protocol>
- alt-sendme 仓库 README: <https://github.com/tonyantony300/alt-sendme>

说明：

- 外部项目信息按 2026-05-01 可访问到的官方 GitHub 页面整理。
- YiboFlow 结论以当前仓库代码现状为准，不以旧设计口径替代现状实现。

## 3. YiboFlow 传输能力现状

## 3.1 功能定位

`docs/specs.md` 把 `FlowDrop` 定义为“跨设备文件传输”，目标包括：

- 在设备之间进行文件发送与接收
- 支持状态管理、历史记录和清理策略

但当前仓库代码与该目标仍有落差。

## 3.2 当前发送流程

从 `desktop/src/pages/FlowDrop.tsx` 看，桌面端流程是：

1. 从本地存储读取 `server_url / username / saved_pwd`
2. 调用 `get_cluster_devices`
3. 每 10 秒轮询一次在线设备
4. 用户点击某个在线设备，选择文件
5. 前端调用 `send_file_p2p`

实际问题有两个：

- 设备发现不是局域网广播，而是走 YiboFlow 服务端登录后查询在线设备。
- UI 上虽然点击的是某个设备，但调用时实际写死 `targetDevice: 0`，因此当前实现并没有严格指向某一台具体设备。

这意味着：

- 它不是 LocalSend 那种“打开即发现附近设备”的体验。
- 它更像“YiboFlow 同账号设备集群内的传输入口”。

## 3.3 当前接收流程

从 `core/src/clipboard.rs` 与 `core/src/p2p.rs` 看：

- 收到 WebSocket 消息类型 `p2p_file_offer` 后，客户端会解析 `P2POffer`
- 默认将保存目录指向用户下载目录
- 自动连接发送端给出的 `ips + port`
- 发送 token，收到 `OK` 后直接流式接收文件并落盘

这条链路的特点是：

- 接收端没有显式“接受/拒绝”交互
- 没有下载前预览、重命名、保存路径选择
- 没有用户可见的接收会话管理
- 更像“后台自动拉取”

## 3.4 当前传输方式

`core/src/p2p.rs` 的实现非常直接：

- 发送端在 `0.0.0.0:0` 上随机监听一个 TCP 端口
- 通过 WebSocket 发出 `P2POffer`
- Offer 中包含：
  - `token`
  - `ips`
  - `port`
  - `filename`
  - `file_size`
- 接收端遍历 `ips` 发起 TCP 连接
- 36 字节 token 握手成功后开始 `tokio::io::copy` 直接流式传输

它的优点是简单、容易跑通、局域网直连开销低。

它的短板也很明显：

- 只有 token 握手，没有传输层加密
- 没有文件哈希校验
- 没有分块协议和续传协议
- 没有 NAT 穿透
- `get_local_ips()` 通过连接 `8.8.8.8:80` 推断本机地址，这对离线局域网和复杂网络并不稳健

## 3.5 当前性能和可用性判断

如果只看“单个大文件、同一局域网、双端都在线、网络平稳”的理想路径，YiboFlow 当前实现理论上可以获得不错的吞吐，因为它：

- 走的是直接 TCP 流
- 中间不经过应用层分块重组
- 发送端和接收端逻辑都很轻

但在真实使用中，它的可用性会被以下问题明显拖累：

- 没有断点续传，网络抖动即整次失败
- 没有接收确认，误收风险高
- 没有校验，无法确认文件是否完整
- 没有多路径或回退策略
- 发现链路依赖服务端在线状态，而不是局域网自治发现

## 3.6 当前安全性判断

`docs/analysis_report.md` 已明确把 “文件传输通道不加密” 列为中等风险项，这和现有代码是吻合的。

当前 `FlowDrop` 的安全模型大致是：

- 服务端只负责协调 `offer`
- 数据面走端到端 TCP
- 认证靠一次性 token

这不等于端到端加密。当前状态下：

- 协调面有账号体系和 WebSocket
- 数据面没有看到 TLS、Noise、QUIC 或应用层文件加密
- 文件完整性也没有用 `SHA-256` 或 `BLAKE3` 做最终校验

因此它更适合：

- 可信局域网
- 同账号设备
- 内部工具阶段

而不适合直接宣称为成熟的“安全文件传输”方案。

## 4. LocalSend 分析

## 4.1 传送与接收方式

LocalSend 的核心定位很清晰：

- 同一局域网内
- 无需互联网
- 无需第三方服务器
- 以 HTTPS + REST API 为主协议

它的默认传输模型是：

- 接收端起 HTTP/HTTPS 服务
- 发送端先发元数据 `prepare-upload`
- 接收端决定接受、部分接受或拒绝
- 之后再按 `sessionId + file token` 上传实际文件

这套模型比 YiboFlow 当前实现成熟很多，因为它天然包含：

- 元数据预协商
- 显式接受/拒绝
- 每文件 token
- 会话取消
- 可并行上传

## 4.2 发现方式

LocalSend 的设备发现以局域网自治为主：

- 默认使用 UDP multicast
- 默认端口 `53317`
- 还支持 HTTP 扫描作为 fallback

这意味着：

- 不依赖中心账号系统
- 更适合“打开即发现附近设备”
- 对家庭和办公室局域网场景更自然

## 4.3 操作体验

从协议和 README 能看出的产品特征：

- 用户先看到附近设备
- 发送前先发送元数据
- 接收端可确认
- 支持 PIN 场景
- 有浏览器下载反向模式 `Reverse File Transfer`

其中反向模式很实用：

- 当接收端不是 LocalSend 客户端时
- 可以退化为浏览器下载
- 但该模式因浏览器限制使用未加密 HTTP

这是一种很务实的兼容设计。

## 4.4 性能

LocalSend 的性能特点是：

- 局域网内路径短
- 直接传文件二进制
- 支持并行上传 route

但它也明确给出一个现实权衡：

- 如果追求最高速度，可以关闭加密

这说明它把安全和性能做成了可调权衡，而不是简单地只追求最大吞吐。

## 4.5 安全性

LocalSend 的安全设计明显强于当前 YiboFlow `FlowDrop`：

- 默认 HTTPS
- 证书按设备动态生成
- 开启加密时，设备指纹使用证书 `SHA-256`
- 支持 PIN
- 文件协商和上传带 session/token

但也要注意它的边界：

- 浏览器下载 fallback 是 HTTP
- 局域网发现依赖 multicast，网络环境差时可见性会受路由器配置影响

## 5. alt-sendme 分析

## 5.1 传送与接收方式

alt-sendme 的设计目标明显比 LocalSend 更激进：

- 不限局域网
- 可跨公网
- 无账号
- 直接 P2P
- 断点续传
- 高性能

README 里明确列出的能力包括：

- 端到端加密
- `QUIC + TLS 1.3`
- `BLAKE3` 完整性校验
- 断点续传
- 广播式多接收方发送
- 下载前预览
- QUIC 打洞与加密 relay fallback

这已经不是“局域网小工具”级别，而是现代化 P2P 传输产品路线。

## 5.2 发现与连接方式

alt-sendme 的重点不在局域网广播发现，而在“任意网络环境下尽量打通连接”：

- QUIC
- NAT hole punching
- encrypted relay fallback

这意味着它对复杂网络更友好，也意味着技术复杂度明显高于 LocalSend 和当前 YiboFlow。

## 5.3 操作体验

从 README 暴露出的产品行为看，alt-sendme 的交互强调：

- 直接发送文件或文件夹
- 可恢复中断传输
- 可广播给多个 peer
- 接收前可预览
- 与 CLI 生态互通

这套体验对“重度文件传输”用户更有吸引力，尤其适合：

- 大文件
- 网络不稳定
- 跨网络设备
- 自动化工作流

## 5.4 性能

alt-sendme 明确把性能作为卖点之一：

- 可跑满多千兆链路
- 支持续传
- 使用 QUIC
- 有更现代的完整性校验和连接建立策略

从架构上推断，它在高带宽和高抖动场景下都更有优势：

- QUIC 对弱网和重传的体验通常优于简单裸 TCP 产品化实现
- 断点续传能显著降低失败重传成本
- relay fallback 让“连不上”概率更低

## 5.5 安全性

在三者中，alt-sendme 的安全路线最完整：

- Always-on end-to-end encryption
- QUIC + TLS 1.3
- forward secrecy / backward secrecy
- BLAKE3 integrity checks
- 不依赖云存储

对比 YiboFlow 当前 `FlowDrop`，差距主要不是“有没有 token”，而是：

- 有没有真正的传输加密
- 有没有完整性校验
- 有没有抗复杂网络的稳定连接策略

## 6. 三者对比

| 维度 | YiboFlow FlowDrop | LocalSend | alt-sendme |
|---|---|---|---|
| 产品定位 | YiboFlow 自有设备集群内传输模块 | 局域网内 AirDrop 替代 | 跨局域网/跨公网现代 P2P 传输 |
| 发现方式 | 依赖服务端登录后获取在线设备 | UDP multicast + HTTP fallback | 侧重 QUIC 打洞与 relay |
| 是否依赖中心服务 | 协调面依赖 YiboFlow 服务端 | 不依赖第三方服务器 | 不存云，连接层可有 relay fallback |
| 发送前协商 | 很弱，基本只有 offer | `prepare-upload` 元数据协商 | 有，更偏完整产品化会话 |
| 接收确认 | 当前代码未体现显式确认 | 明确支持接受/拒绝/PIN | 产品能力上更完整 |
| 文件选择 | 支持单文件选择 | 支持文件/消息共享 | 支持文件和文件夹 |
| 接收落盘 | 自动保存到下载目录 | 用户确认后接收 | 更完整的接收前确认与预览 |
| 协议 | WebSocket 协调 + 直连 TCP | REST + HTTPS | QUIC + TLS 1.3 |
| 完整性校验 | 当前未见 | 协议层支持 `sha256` 元数据 | README 明确 `BLAKE3` |
| 断点续传 | 未完成 | 不以此为主卖点 | 明确支持 |
| 多接收方/广播 | 当前实现存在广播风险，不是产品能力 | 可面向多个局域网设备发送 | README 明确支持广播 |
| NAT 穿透 | 无 | 不主打 | 明确支持 |
| 局域网离线可用 | 不好，发现依赖服务端 | 很强 | 可以，但重点不只局域网 |
| 公网可用性 | 弱 | 弱，不是目标场景 | 强，是主目标之一 |
| UI/历史/状态 | 仅基础页面，状态闭环不足 | 成熟 | 更偏成熟 |
| 安全性 | 仅 token 握手，数据面未加密 | HTTPS + 指纹 + PIN | Always-on E2EE + QUIC/TLS + BLAKE3 |

## 7. 对 YiboFlow 的关键判断

## 7.1 它现在更像什么

当前 `FlowDrop` 更像：

- `FlowSync` 体系旁边的一个补充模块
- 借助现有登录、设备、WebSocket 基础设施搭出的传输原型

而不是：

- 一个已经成型、可对外宣称成熟可用的通用传输产品

## 7.2 它和 LocalSend 的本质差别

YiboFlow 和 LocalSend 的核心差别不是“UI 是否像传输工具”，而是产品假设不同：

- YiboFlow 假设用户已进入 YiboFlow 账号/设备体系
- LocalSend 假设用户只是在同一局域网下临时互传

所以如果 YiboFlow 想做成“账号体系内受控传输”，它不必完全照抄 LocalSend。
但如果想让用户感知到“像 AirDrop 一样自然”，那就必须补齐局域网自发现和接收确认。

## 7.3 它和 alt-sendme 的本质差别

与 alt-sendme 的差距则主要是“协议代差”：

- 当前 YiboFlow 是最小可用 TCP 直连
- alt-sendme 是现代 P2P 传输栈

这个差距不是补几个 UI 就能解决的，而是：

- 连接建立
- 安全层
- 校验层
- 续传层
- 弱网容错

都需要重做。

## 8. 对 YiboFlow 的建议

## 8.1 如果目标是“先把当前 FlowDrop 做到能用”

优先级建议如下：

1. 修正发送目标绑定
   - UI 点击的设备必须传真实 `device_id`
   - 不能继续把 `targetDevice` 固定为 `0`

2. 加接收确认
   - 收到 offer 后先弹出“接受/拒绝”
   - 支持改名和选择保存路径

3. 加完整性校验
   - 至少补 `SHA-256`
   - 接收完成后校验再标记成功

4. 加进度、失败原因和历史
   - 发送中/接收中/成功/失败
   - UI 和后台状态要闭环

5. 补断点续传
   - 至少先做分块 + offset 恢复

## 8.2 如果目标是“做成 LocalSend 型局域网互传”

需要新增：

- 局域网自发现
- 纯本地离线可用
- 元数据预协商
- 接收确认
- PIN/临时许可
- 无账号进入路径

这条路线的好处是：

- 产品理解成本低
- 用户预期明确
- 局域网稳定性更容易打磨

## 8.3 如果目标是“做成 alt-sendme 型现代 P2P 传输”

需要新增：

- QUIC 或等价现代传输层
- NAT 穿透
- relay fallback
- 强制端到端加密
- 文件级完整性校验
- 真正的续传协议
- 目录传输与多 peer 会话管理

这条路线可做，但复杂度远高于当前仓库里的 `FlowDrop` 基础。

## 9. 最终建议

如果从产品节奏和工程成本看，建议不要同时追两个目标。

更合理的决策是二选一：

- 路线 A：把 `FlowDrop` 定位为“YiboFlow 账号设备体系内的受控文件传输”
  - 强化设备定向、确认、历史、校验、续传
  - 不急着做局域网匿名发现

- 路线 B：把 `FlowDrop` 定位为“YiboFlow 内置版 LocalSend”
  - 直接围绕局域网发现、离线可用、确认收发重构

不建议当前阶段直接对标 alt-sendme 的完整目标，因为这会把问题从“补产品闭环”升级为“重做传输协议栈”。

在现阶段，YiboFlow 最现实的目标不是超越 LocalSend 或 alt-sendme，而是先把 `FlowDrop` 从“最小链路打通”提升到“对 YiboFlow 用户可稳定使用”。

## 10. 参考链接

- YiboFlow 规格：`docs/specs.md`
- YiboFlow 现有分析：`docs/analysis_report.md`
- LocalSend README: <https://github.com/localsend/localsend>
- LocalSend Protocol: <https://github.com/localsend/protocol>
- alt-sendme README: <https://github.com/tonyantony300/alt-sendme>
