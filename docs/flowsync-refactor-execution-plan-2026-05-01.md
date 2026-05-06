# FlowSync 重构执行计划

日期：2026-05-01  
状态：执行计划草案  
关联文档：

- [flowsync-transfer-integration-plan-2026-05-01.md](./flowsync-transfer-integration-plan-2026-05-01.md)
- [flowsync-content-stream-technical-design-2026-05-01.md](./flowsync-content-stream-technical-design-2026-05-01.md)
- [flowsync-schema-migration-plan-2026-05-01.md](./flowsync-schema-migration-plan-2026-05-01.md)

## 1. 目标

本计划用于把 `FlowSync` 从当前“剪贴板同步 + 历史 + 占位 FlowDrop”状态，重构为“统一内容流系统”。

执行目标：

1. 保持现有文本/图片同步功能可用
2. 引入统一条目与对象模型
3. 支持文件/文件夹条目
4. 为按需下载、设备推送、NAS 暂存、NAS 外链打好基础
5. 删除旧 `FlowDrop` 前后端实现

执行原则：

1. 先建新内核，再迁旧功能
2. 先让新老并存，再切主路径
3. 优先保证可回退
4. 每一阶段都要有明确验证点

## 2. 范围

## 2.1 纳入本次重构

- `FlowSync` 产品入口收束
- 新条目/对象 schema
- 文本/图片自动同步开关
- 文件/文件夹条目创建
- 新本地存储结构
- 旧 history 数据迁移
- 旧 `FlowDrop` 删除

## 2.2 不纳入本次重构首轮闭环

- 完整公网匿名传输
- NAT 打洞
- 多人协作分享空间
- 完整 NAS 外链下载页视觉打磨
- 移动端适配

## 3. 当前重构对象

当前需要重点处理的区域：

前端：

- `desktop/src/pages/FlowSync.tsx`
- `desktop/src/pages/FlowDrop.tsx`
- `desktop/src/App.tsx`
- `desktop/src/components/Layout.tsx`
- `desktop/src/pages/FlowDeck.tsx`
- `desktop/src/locales/*.json`

桌面桥接：

- `desktop/src-tauri/src/lib.rs`

Rust Core：

- `core/src/clipboard.rs`
- `core/src/cache.rs`
- `core/src/history.rs`
- `core/src/p2p.rs`
- `core/src/lib.rs`

服务端：

- `server/internal/ws/*`
- `server/internal/api/handler/blob_handler.go`
- `server/internal/api/handler/vault_handler.go`
- 后续新增 `server/internal/contentstream/`

## 4. 总体路线

重构路线分为 7 个阶段：

1. 基础收口
2. 新数据层与迁移层
3. 文本/图片接入新条目模型
4. 文件/文件夹条目落地
5. 设备侧按需传输会话
6. NAS 暂存与管理员控制
7. 删除旧 `FlowDrop` 与最终切换

说明：

- 阶段 1-4 可以视为首批主干重构
- 阶段 5-6 是能力落地扩展
- 阶段 7 是架构收尾

## 5. 阶段计划

## 5.1 Phase 0：基线确认

目标：

- 在重构前固定当前可运行基线
- 明确哪些功能必须保持不回退

任务：

- 记录当前 `FlowSync` 文本同步可用性
- 记录当前 `FlowSync` 图片同步可用性
- 记录当前历史查询/复制/删除行为
- 记录当前 `FlowDrop` 引用链路
- 记录当前 Tauri commands 清单

交付物：

- 基线清单
- 影响面列表

验证：

- `cargo check -p yiboflow-core`
- `cargo check -p tauri-app`
- `cd desktop && npm run build`

## 5.2 Phase 1：基础收口

目标：

- 先把架构切换所需的边界理出来
- 不急着上新功能

任务包：

### WP-1 命名与模块占位

- 在 `core/src/` 下新增：
  - `flow_store.rs`
  - `flow_migration.rs`
  - `content_stream.rs`
- 在 `core/src/lib.rs` 中注册新模块

### WP-2 Tauri 命令面收口

- 梳理旧命令：
  - history 相关
  - flowsync 相关
  - flowdrop 相关
- 标出保留、迁移、删除三类命令

### WP-3 前端入口收口

- 明确 `FlowSync` 是唯一长期入口
- `FlowDrop` 暂不删除代码，但先标记为待移除

完成定义：

- 新模块已能编译通过
- 命令映射表完成
- 删除范围已明确

回退点：

- 仅新增占位模块，不改旧行为，可直接撤回

## 5.3 Phase 2：新数据层与迁移层

目标：

- 引入新 `entries.db`
- 能初始化新 schema
- 能从旧 `clipboard.db` 回填 text/image

任务包：

### WP-4 FlowStoreManager

- 实现新 DB 初始化
- 建表：
  - `schema_migrations`
  - `flow_entries`
  - `flow_objects`
  - `flow_chunks`
  - `flow_transfers`
  - `legacy_history_map`

### WP-5 FlowMigrationManager

- 检测旧 `clipboard.db`
- 扫描旧 `history`
- 幂等回填到新表

### WP-6 新旧并存

- 新库可写
- 旧库仍可读
- 不搬动旧 text/image 物理文件

完成定义：

- 首次启动能创建 `entries.db`
- 回填不会重复生成对象
- text/image 旧历史在新表可见

验证：

- 空库初始化
- 有旧 `clipboard.db` 的迁移
- 重复运行迁移两次结果一致

回退点：

- 删除 `entries.db` 后仍能用旧 `clipboard.db`

## 5.4 Phase 3：文本/图片接入新条目模型

目标：

- 现有文本/图片内容变化开始双写新模型
- `FlowSync` 页面查询逐步切到新条目表

任务包：

### WP-7 clipboard 写入双轨

- 文本变化：
  - 继续保留原有同步链路
  - 同时写 `flow_entries + flow_objects`

- 图片变化：
  - 继续保留原有同步链路
  - 同时写 `flow_entries + flow_objects`

### WP-8 自动同步开关

- 新增配置项：
  - `auto_sync_text`
  - `auto_sync_image`
- Tauri 命令暴露读取与写入

### WP-9 查询切换

- 新增统一查询接口读取 `flow_entries`
- 历史搜索迁移到 `flow_entries_fts`

完成定义：

- 文本复制后新表立即有条目
- 图片复制后新表立即有条目
- 关闭自动同步开关后：
  - 条目仍创建
  - 内容不自动发给其它设备

验证：

- 文本自动同步开/关
- 图片自动同步开/关
- 历史查询与复制回剪贴板不退化

风险：

- 双写期间可能出现重复展示
- source/direction 字段映射不一致

## 5.5 Phase 4：文件/文件夹条目落地

目标：

- 不传内容也能先把 file/bundle 条目走通

任务包：

### WP-10 文件/文件夹对象识别

- 在 `clipboard_sync` 中识别：
  - 单文件
  - 单文件夹
- 首版明确不支持多个独立文件对象混合复制

### WP-11 手动新建条目

- `FlowSync` 页面加按钮
- 支持文件、文件夹选择

### WP-12 bundle manifest

- 为文件夹生成目录树 manifest
- 计算 root hash / item_count / size_bytes

### WP-13 条目自动同步

- 文件/文件夹只同步条目
- 内容不自动下发

完成定义：

- 复制文件能出现 file 条目
- 复制文件夹能出现 bundle 条目
- 手动选文件/文件夹也能出现条目
- 同账号其它设备能看到条目

验证：

- 单文件条目
- 单文件夹条目
- 条目跨设备出现
- 不发生自动大文件传输

回退点：

- 可先关闭“复制文件对象自动入条目”，只保留手动创建入口

## 5.6 Phase 5：设备侧按需传输会话

目标：

- 文件/文件夹条目能从在线设备按需下载
- 能推送到指定在线设备

任务包：

### WP-14 会话状态机

- 落库 `flow_transfers`
- 支持：
  - `created`
  - `offered`
  - `accepted`
  - `transferring`
  - `paused`
  - `verifying`
  - `completed`
  - `failed`
  - `expired`

### WP-15 chunk 与校验

- 单文件 chunk
- bundle 内文件映射
- chunk 校验
- root hash 校验

### WP-16 WS 事件

- `flow_entry_offer`
- `flow_entry_accept`
- `flow_transfer_progress`
- `flow_transfer_completed`
- `flow_transfer_failed`

完成定义：

- 设备 A 对条目点击下载
- 设备 B 在线时可完成传输
- 失败后可重试
- 校验失败不会标记成功

验证：

- 小文件下载
- 大文件中断恢复
- 文件夹整体领取
- 校验失败重试

风险：

- 旧 WS 消息模型主要为 clipboard 设计
- file/bundle 大对象对当前链路压力更大

## 5.7 Phase 6：NAS 暂存与管理员控制

目标：

- 条目可上传到 NAS 暂存
- 管理员可控制暂存策略

任务包：

### WP-17 NAS 暂存协议

- manifest 上传
- chunk 上传
- 完成态上报
- TTL 记录

### WP-18 管理员控制面

- 全局暂存开关
- 默认 TTL
- 最大 TTL
- 单对象大小限制
- 单用户配额
- 外链功能开关
- 外链最大有效期
- GC 策略

### WP-19 用户侧暂存管理

- 查看自己暂存对象
- 删除自己的暂存对象
- 设置默认 TTL

完成定义：

- 对象可转成 `nas_staged`
- 其它设备能从 NAS 获取
- 管理员策略能实际生效

验证：

- TTL 到期不可领取
- 关闭暂存开关后无法创建新暂存
- 超配额时拒绝上传

## 5.8 Phase 7：NAS 外链

目标：

- 只基于 NAS 暂存提供受控外链

任务包：

### WP-20 share_links

- 生成高熵 token
- TTL
- 下载次数限制
- 失效与禁用

### WP-21 外链风险提示

- UI 明示：
  - 任何拿到链接的人都可下载
  - 不建议分享敏感文件

### WP-22 审计

- 外链创建记录
- 下载次数
- 到期与禁用记录

完成定义：

- 浏览器可领取 NAS 暂存对象
- 超时或超次数后链接失效
- 管理员可关闭外链

验证：

- 正常下载
- 过期失效
- 达到次数限制失效

## 5.9 Phase 8：删除旧 FlowDrop 与最终切换

目标：

- 删除旧 `FlowDrop`
- 所有主读取路径切到新模型

任务包：

### WP-23 前端删除

- 删除 `FlowDrop.tsx`
- 删除 route
- 删除导航入口
- 删除 locale 文案
- 删除 `FlowDeck` 中相关卡片逻辑

### WP-24 Core/Bridge 删除

- 删除 `core/src/p2p.rs`
- 删除 `send_file_p2p`
- 删除 `p2p_file_offer` 处理

### WP-25 主路径切换

- `FlowSync` 页面只读 `flow_entries`
- 旧 `history` 写入路径下线

完成定义：

- 项目内已无 `FlowDrop` 功能依赖
- `FlowSync` 独立承担全部内容流入口

验证：

- 全量构建通过
- `FlowSync` 主功能可用
- 删除 `FlowDrop` 后无编译错误

## 6. 工作包依赖

关键依赖关系如下：

```text
Phase 1 -> Phase 2 -> Phase 3 -> Phase 4
Phase 4 -> Phase 5
Phase 5 -> Phase 6
Phase 6 -> Phase 7
Phase 3 + Phase 5 + Phase 6 -> Phase 8
```

更具体地说：

- 没有 `entries.db` 和迁移层，不能可靠切查询
- 没有 file/bundle 条目模型，不能做设备侧按需传输
- 没有 NAS 暂存，外链没有实际对象来源

## 7. 建议的提交粒度

建议不要把整个重构压成一个大提交，推荐按批次：

1. 新 store 与 migration 骨架
2. text/image 双写与自动同步开关
3. file/bundle 条目创建
4. 设备侧 transfer session
5. NAS 暂存与管理员控制
6. NAS 外链
7. 删除旧 FlowDrop

每批次都应满足：

- 可编译
- 可验证
- 可回退

## 8. 验证矩阵

## 8.1 文本

- 本地复制创建条目
- 自动同步开/关
- 远端接收
- 历史查询
- 复制回剪贴板

## 8.2 图片

- 本地复制创建条目
- 自动同步开/关
- 远端接收
- 本地预览
- 历史查询

## 8.3 文件

- 手动新建条目
- 复制文件自动进条目
- 远端看到条目
- 按需下载
- 失败恢复

## 8.4 文件夹

- 手动新建 bundle
- 复制文件夹自动进条目
- 远端看到条目
- 整体领取目录树
- 不支持局部领取

## 8.5 NAS

- 暂存成功
- TTL 生效
- 清理成功
- 管理员策略生效

## 8.6 外链

- 创建成功
- 浏览器下载
- 超时失效
- 超次数失效

## 9. 风险与缓解

## 9.1 schema 风险

风险：

- 新旧库并存导致查询不一致

缓解：

- 先 migration backfill
- 再切主查询
- 保留旧库只读回退路径

## 9.2 clipboard 风险

风险：

- 文件/文件夹对象识别跨平台行为不稳定

缓解：

- 首版先支持 Windows
- 保留手动“新建条目”入口作为兜底

## 9.3 WS 风险

风险：

- 现有 WS 消息更偏剪贴板，扩展大对象事件可能引入混乱

缓解：

- 新增内容流事件前缀
- 不复用旧 `p2p_file_offer`

## 9.4 删除风险

风险：

- 提前删除 `FlowDrop` 导致仍有依赖未清理

缓解：

- 先列引用链
- 编译验证
- 最后统一删除

## 10. 阶段退出标准

每个阶段完成时必须满足：

1. 功能定义达成
2. 验证项通过
3. 文档更新
4. 没有引入阻断性回归

特别地：

- 未完成 Phase 2，不允许切主查询
- 未完成 Phase 5，不允许宣称支持文件/文件夹稳定下载
- 未完成 Phase 8，不算完成结构性重构

## 11. 推荐执行顺序

如果按最现实的工程推进顺序，建议直接这样做：

1. Phase 1：新模块骨架与命令面收口
2. Phase 2：`entries.db` + migration
3. Phase 3：text/image 双写 + 自动同步开关
4. Phase 4：file/bundle 条目
5. Phase 8 中的“旧 FlowDrop 引用梳理”，提前做但不删除
6. Phase 5：设备按需下载
7. Phase 6：NAS 暂存与管理员控制
8. Phase 7：NAS 外链
9. Phase 8：最终删除旧 FlowDrop

## 12. 下一步建议

如果继续从文档推进到实现，最好的下一步不是再讨论方向，而是直接开始第一批代码骨架：

- `FlowStoreManager`
- `FlowMigrationManager`
- `schema_migrations`
- `legacy_history_map`
- `auto_sync_text / auto_sync_image`

因为这批内容最独立、回退最容易，也最能检验整个重构路线是否站得住。
