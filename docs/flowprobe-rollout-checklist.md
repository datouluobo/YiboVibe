# FlowProbe 收口上线清单

更新时间：2026-05-11

## 1. 目标

本次上线目标是把 AI 相关能力收口为 `FlowProbe` 本机 API 资产管理与固定中转工具，并让服务端职责回归：

- 登录
- 认证
- 设备会话
- Vault / 配置保存
- Vault / 配置同步
- WebSocket 通知
- `FlowSync` NAS 暂存 / 外链

## 2. 必须更新的组件

### 客户端

必须更新桌面客户端。原因：

- `FlowProbe` 页面和交互已重做
- `FlowProbe` 已拆分为 `接入` / `转发` 两页
- Tauri 命令集已替换
- AI 配置结构已改成 `probe_tool`
- 新增了本机密钥存储与直连测试逻辑
- 新增 Anthropic 协议支持

涉及的关键代码：

- [desktop/src/pages/FlowProbeSources.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/pages/FlowProbeSources.tsx)
- [desktop/src/pages/FlowProbeRelay.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/pages/FlowProbeRelay.tsx)
- [desktop/src/pages/FlowDeck.tsx](/F:/Download/GitHub/YiboFlow/desktop/src/pages/FlowDeck.tsx)
- [desktop/src-tauri/src/probe.rs](/F:/Download/GitHub/YiboFlow/desktop/src-tauri/src/probe.rs)
- [desktop/src-tauri/src/lib.rs](/F:/Download/GitHub/YiboFlow/desktop/src-tauri/src/lib.rs)
- [core/src/config.rs](/F:/Download/GitHub/YiboFlow/core/src/config.rs)

### 服务端

如果你要实际部署，服务端也必须一起更新。原因：

- 旧的 AI 网关配置已删除
- 现在服务端不应再承担第三方 AI API 转发
- 服务端边界必须与新客户端保持一致

涉及的关键代码：

- [server/Caddyfile](/F:/Download/GitHub/YiboFlow/server/Caddyfile)

## 3. 更新顺序

1. 先更新服务端配置与网关。
2. 再发布桌面客户端。
3. 最后做联调验证。

这样可以避免客户端已切到直连逻辑，但网关和部署说明仍停留在旧边界。

## 4. 客户端发布检查

- 构建通过：`npm run build`
- Rust 核心检查通过：`cargo check -p yiboflow-core`
- Tauri 检查通过：`cargo check -p tauri-app`
- `FlowProbe 接入` 页可新增测试目标
- `FlowProbe 接入` 页修改表单后自动保存
- `FlowProbe 接入` 页包含 API 详情、模型池与诊断日志
- `FlowProbe 接入` 页可将当前 API 设为 `OpenAI` / `Anthropic` 目标
- `FlowProbe` 可直接测试：
  - OpenAI Compatible
  - Ollama
  - Gemini OpenAI Compatible
  - Anthropic
  - Custom
- `FlowProbe 转发` 页可查看并复制：
  - OpenAI 本机入口
  - Anthropic 本机入口
  - 本地 Token
- `FlowProbe 转发` 页可切换监听地址：
  - `127.0.0.1`
  - `0.0.0.0`
  - 自定义主机 IP
- 测试结果正确输出：
  - `code`
  - `summary`
  - `detail`
  - `latency_ms`
  - `detected_protocol`
  - `auth_status`
  - `model_count`
- API Key 不进入同步配置，只保存在本机 `probe_secrets.json`
- 已拉取模型列表会回写到 `probe_tool.credentials[*].discovered_models`
- `FlowProbe` 统计口径明确区分：
  - 当前会话累计
  - 最近 5 分钟
- `proxy.is_enabled=false` 时不能启动本机代理
- `proxy.collect_usage=false` 时不再新增调用日志、Token 与费用统计
- `FlowDeck` 不再展示任何第三方 AI 运行状态

## 5. 服务端发布检查

- `Caddyfile` 已移除 `/v1/*` AI 代理
- 服务端仅保留：
  - 登录
  - 认证
  - 配置保存
  - 配置同步
- 反向代理只处理 YiboFlow 自身 API
- 部署说明不再写 AI 网关或 Ollama 转发

## 6. 联调验证

至少验证以下场景：

1. 本机 Ollama 地址可直连测试。
2. NAS 地址可作为普通测试目标直连测试。
3. 远程 OpenAI Compatible 地址可拉取模型。
4. Anthropic 地址可拉取模型或正确返回认证失败。
5. 错误结果能正确区分：
   - 超时
   - 认证失败
   - 路径错误
   - 协议不匹配
   - 网络错误
6. 在 Sources 页面拉取模型后，刷新页面仍能看到相同模型列表。
7. 将 `collect_usage` 关闭后，调用代理接口不会继续累加近期活动和统计。
8. 将 `is_enabled` 关闭并保存后，已运行的 Probe 会停止，且不能再次启动直到重新启用。
9. `FlowProbe 接入` 页默认模型可从模型池直接点击回填，并可复制。
10. `FlowProbe 转发` 页的 OpenAI / Anthropic 固定别名分别为 `flowprobe-openai` 与 `flowprobe-anthropic`。

## 7. 上线后观察项

- 是否仍有客户端尝试依赖服务端 AI 代理
- 是否有配置同步把 API Key 一并带走
- 是否有旧文档或部署脚本继续描述已废弃的 AI 主链路

## 8. 结论

如果只是看代码，不需要立刻更新服务端和客户端。

如果要实际运行、联调、预发布或部署，客户端和服务端都要一起更新，不能只发一边。
