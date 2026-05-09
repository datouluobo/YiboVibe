# FlowProbe IDE 兼容矩阵

更新日期：2026-05-08

本文档用于说明 `FlowProbe` 作为本机 `OpenAI-compatible / Anthropic-compatible` 代理时，各类 AI IDE 或编码助手对“本机 / 局域网 provider 直连”的支持情况。

`FlowProbe` 当前对外推荐的固定模型别名为：

- `flowprobe-openai`
- `flowprobe-anthropic`

支持模型发现的客户端也可以直接从 `FlowProbe` 的 `/models` 接口拉取这两个别名。

## WSL / 容器 / 虚拟机场景

如果客户端运行在 WSL、容器或虚拟机内，不应把 `127.0.0.1` 直接当成 `FlowProbe` 地址。

原因：

- `127.0.0.1` 只指向当前运行环境自身
- 当 `FlowProbe` 运行在 Windows 桌面端，而客户端运行在 WSL 内时，WSL 的 `127.0.0.1` 并不是 Windows 主机

推荐做法：

1. 将 `FlowProbe` 的监听地址切换为 `0.0.0.0` 或指定的 Windows 主机 IP
2. 客户端使用 Windows 主机可访问的地址接入，而不是继续使用 `127.0.0.1`
3. 仅在 Windows 原生客户端场景下，才默认使用 `http://127.0.0.1:<port>`

## 判断标准

- `支持自定义 Base URL`：是否允许把请求指向 `FlowProbe`
- `可用 localhost / 局域网`：是否允许直接连接 `127.0.0.1`、`localhost` 或局域网地址
- `适合协议`：更适合接 `OpenAI-compatible` 还是 `Anthropic-compatible`
- `当前结论`：`已确认` / `高概率` / `待验证`

## 兼容矩阵

| IDE / 工具 | 支持自定义 Base URL | 可用 localhost / 局域网 | 适合协议 | 当前结论 | 备注 |
|---|---|---:|---|---|---|
| Cursor | 支持填写 provider / override | 否 | OpenAI / Anthropic | 已确认受限 | 请求会经过 Cursor 后端；把 provider URL 指向本机或局域网时，常见报错是 `Access to private networks is forbidden` |
| Claude Code | 支持 | 可以 | Anthropic | 已确认 | 官方支持 `ANTHROPIC_BASE_URL` 等环境变量 |
| Continue | 支持 | 可以 | OpenAI-compatible | 已确认 | 官方 `OpenAI` provider 支持 `apiBase`，也直接支持本地 `Ollama` |
| Cline | 支持 | 可以 | OpenAI-compatible 为主 | 已确认 | 官方支持 `OpenAI Compatible`、`Ollama`、`LM Studio` 等本地或自定义 endpoint |
| OpenCode | 支持 | 可以 | OpenAI / Anthropic | 已确认 | 官方 provider 配置支持自定义 `baseURL` |
| Hermes | 用户已实测支持 | 可以 | 待定 | 用户已确认 | 当前仓库内已有真实使用反馈，但本文档暂未附上官方文档来源 |
| Windsurf | 未查到清晰公开文档 | 未知 | 未知 | 待验证 | 公开资料更偏团队或托管链路，暂不承诺可直连本机代理 |

## 结论

`FlowProbe` 第一版应优先面向“本地直连型客户端”：

- Claude Code
- Continue
- Cline
- OpenCode
- Hermes

`Cursor` 需要单独标注限制：当前不适合把本机或局域网 `FlowProbe` 直接填成 provider URL。

## 建议的产品口径

后续文档和页面说明建议统一使用以下表述：

1. `FlowProbe` 适用于支持本机或局域网 provider 直连的客户端。
2. 对于会把请求经由厂商后端转发的 IDE，本机 `FlowProbe` 可能无法直接接入。
3. `Cursor` 当前应作为已知受限对象处理，而不是第一版默认支持目标。
4. 对于需要手填模型名的客户端，优先填写 `flowprobe-openai` 或 `flowprobe-anthropic`，避免随着上游切换反复修改 IDE 配置。

## 参考来源

- Cursor API Keys: <https://docs.cursor.com/advanced/api-keys>
- Cursor forum: <https://forum.cursor.com/t/problem-accessing-models-through-internal-proxy/79166>
- Cursor forum: <https://forum.cursor.com/t/requests-not-hitting-local-proxy-resulting-in-403-error/139894>
- Claude Code env vars: <https://code.claude.com/docs/en/env-vars>
- Continue OpenAI provider: <https://docs.continue.dev/customize/model-providers/top-level/openai>
- Cline OpenAI Compatible: <https://docs.cline.bot/provider-config/openai-compatible>
- OpenCode providers: <https://opencode.ai/docs/providers/>
