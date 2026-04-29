# FlowDeck 重做实施清单

本文档承接 [flowdeck-redesign-plan.md](/F:/Download/GitHub/YiboFlow/docs/flowdeck-redesign-plan.md)，用于指导后续代码改造。

## 1. 实施目标

将 `FlowDeck` 从“状态灯墙 + 设备列表”重做为“系统总览页”，并完成以下收口：

1. 去掉 AI 相关展示。
2. 去掉旧网关语义。
3. 去掉无真实依据的运行态绿灯。
4. 去掉设备名本地假编辑。
5. 统一错误结构，避免再把所有错误写成“连接不上”。

## 2. 前端页面结构改动点

目标文件：

- [desktop/src/pages/FlowDeck.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/pages/FlowDeck.tsx)
- [desktop/src/locales/zh.json](/F:/Download/GitHub/YiboFlow/desktop/src/locales/zh.json)
- [desktop/src/locales/en.json](/F:/Download/GitHub/YiboFlow/desktop/src/locales/en.json)

需要完成的结构改动：

1. 将页面主结构改为 4 个区块：
- 顶部总览条
- 同步与账户
- 功能状态
- 设备概览

2. 删除现有区块或逻辑：
- `引擎核心`
- `云端同步通道` 中的旧网关文案
- 设备名编辑状态与保存逻辑
- AI / FlowProbe 相关状态残留

3. 保留但重构：
- 远端状态拉取逻辑
- 设备列表拉取逻辑
- 默认首页入口

## 3. 建议的数据结构

建议在页面内把现有混合状态拆成 3 类数据对象。

### 3.1 顶部摘要对象

建议字段：

- `mode`
- `username`
- `serverUrl`
- `serverStatusCode`
- `currentDeviceName`
- `onlineDeviceCount`
- `totalDeviceCount`

### 3.2 同步状态对象

建议字段：

- `code`
- `summary`
- `detail`
- `checkedAt`
- `serverUrl`
- `username`
- `rememberPassword`

### 3.3 功能状态对象

建议字段：

- `featureId`
- `label`
- `description`
- `status`
- `meta`

### 3.4 设备对象

建议字段：

- `id`
- `name`
- `deviceType`
- `isOnline`
- `isCurrentDevice`
- `lastSeenAt`

## 4. 现有逻辑的处理建议

### 4.1 `get_vault_sync_status`

保留，但不要直接把原始返回值塞进 UI。

建议增加一层前端映射，把原始结果转换成统一状态：

- `SYNC_OK`
- `SYNC_LOCAL_MODE`
- `SYNC_AUTH_REQUIRED`
- `SYNC_SERVER_UNREACHABLE`
- `SYNC_API_ERROR`
- `SYNC_UNKNOWN`

### 4.2 `get_cluster_devices`

保留，但结果只用于只读设备概览。

需要做的展示处理：

- 当前设备置顶
- 在线优先排序
- 离线弱化
- 不再允许编辑设备名

### 4.3 本地存储读取

现有 `localStorage` 可继续作为第一轮数据源，用于读取：

- `yiboflow_server_url`
- `yiboflow_username`
- `yiboflow_saved_pwd`

但这些值应只用于形成“页面状态”，不要直接拼接成用户提示文案。

## 5. 错误语义整改

这是本次改造的重点。

### 5.1 需要删除的旧错误表达

- 连接不上
- 云端库探测失败
- 引擎正在侦测云端库

上述表达过于笼统，不能反映问题层级。

### 5.2 新的状态输出规范

每次状态检查至少生成：

- `code`
- `summary`
- `detail`

示例映射：

- 本地模式：`SYNC_LOCAL_MODE`
- 未保存密码：`SYNC_AUTH_REQUIRED`
- 网络超时：`SYNC_SERVER_UNREACHABLE`
- `HTTP 404`：`SYNC_API_ERROR`
- `HTTP 400`：`SYNC_API_ERROR`

### 5.3 展示规则

- 摘要区只显示 `summary`
- 详情区显示 `code + detail`
- 技术细节默认折叠

## 6. 文案键整改建议

建议重命名或重组 `flowdeck` 文案键，避免继续沿用旧阶段语义。

建议新增或替换为以下方向：

- `flowdeck.summary_mode`
- `flowdeck.summary_account`
- `flowdeck.summary_server`
- `flowdeck.summary_devices`
- `flowdeck.sync_title`
- `flowdeck.sync_status`
- `flowdeck.sync_checked_at`
- `flowdeck.sync_detail`
- `flowdeck.features_title`
- `flowdeck.devices_title`
- `flowdeck.state_enabled`
- `flowdeck.state_disabled`
- `flowdeck.state_not_configured`
- `flowdeck.code_local_mode`
- `flowdeck.code_auth_required`
- `flowdeck.code_server_unreachable`
- `flowdeck.code_api_error`
- `flowdeck.code_ok`

建议删除或停用旧键：

- `flowdeck.section_engine`
- `flowdeck.section_network`
- `flowdeck.section_ai`
- `flowdeck.core_running`
- `flowdeck.e2ee_ready`
- `flowdeck.hook_active`
- `flowdeck.nas_connected`
- `flowdeck.ws_active`
- `flowdeck.protocol_secure`
- `flowdeck.protocol_plain`
- 所有 AI 状态键

## 7. 页面交互规则

允许保留：

- 手动刷新状态
- 展开/折叠技术详情
- 刷新设备列表

禁止继续保留：

- 编辑设备名
- 在布告页修改服务端配置
- 在布告页调试 AI
- 在布告页显示 FlowProbe 提示

## 8. 风险点

1. 现有状态来源不足
- 页面目前有些状态只是静态假设，不是真实检测。
- 改造时必须诚实区分“配置状态”和“运行状态”。

2. 文案替换不彻底
- 如果只改页面结构，不改 locale，旧语义会继续残留。

3. 错误映射过粗
- 如果仍然把多种失败压成同一类，页面看起来会更整洁，但排障能力会继续不足。

## 9. 实施顺序建议

1. 先清理旧区块和旧文案语义。
2. 再整理状态映射层。
3. 然后重建 4 个区块的页面结构。
4. 最后统一视觉样式与状态标签。

## 10. 验收标准

改造完成后，应满足：

1. 页面中不再出现 AI 或 FlowProbe 相关展示。
2. 页面中不再出现旧网关话术。
3. 页面中不再出现无真实来源的运行态绿灯。
4. 页面中不再存在设备名本地假编辑。
5. 所有同步异常都能显示为“状态代码 + 解释”，不再笼统写成“连接不上”。
