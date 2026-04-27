# YiboFlow 命名规范

## 页面命名规则

### 英文命名：`Flow + 名词`

核心功能页面统一使用 `Flow` 前缀 + 大驼峰名词，简洁有力。

### 中文命名：两字文言/古风词

采用两字古典意象词，兼具武侠韵味与功能含义，与英文名形成对照。

### 完整标题格式

页面标题统一格式：**`中文名 · 英文名`**，例如 `键谱 · FlowKeys`。

### 导航分组

| 分组 ID | 分组含义 | 包含页面 |
|---------|---------|---------|
| `overview` | 总览 | 布告 FlowDeck |
| `input` | 输入 | 灵思 FlowMind |
| `transfer` | 传输 | 烽火 FlowSync, 走镖 FlowDrop |
| `system` | 系统 | 探脉 FlowProbe, 键谱 FlowKeys, 中枢 FlowRules, 韬略 Settings, 扉页 FlowInfo |

### 已有页面对照表

| 英文名 | 中文名 | 文件名 | 路由路径 | 图标 | 功能说明 |
|--------|--------|--------|---------|------|---------|
| FlowDeck | 布告 | `FlowDeck.tsx` | `/app/flowdeck` | LayoutDashboard | 全局状态总览与设备连接监控 |
| FlowMind | 灵思 | `FlowMind.tsx` | `/app/flowmind` | Sparkles | 统一智能输入引擎 |
| FlowSync | 烽火 | `FlowSync.tsx` | `/app/flowsync` | Flame | 端到端加密剪贴板同步 |
| FlowDrop | 走镖 | `FlowDrop.tsx` | `/app/flowdrop` | Truck | P2P 跨设备安全文件传输 |
| FlowProbe | 探脉 | `FlowProbe.tsx` | `/app/flowprobe` | Activity | AI 端点探测与连通性测试 |
| FlowKeys | 键谱 | `FlowKeys.tsx` | `/app/flowkeys` | Keyboard | 键盘按键重映射与快捷键配置 |
| FlowRules | 中枢 | `FlowRules.tsx` | `/app/flowrules` | ShieldCheck | 按应用精细控制功能模块 |
| Settings | 韬略 | `Settings.tsx` | `/app/settings` | Settings | 主题、语言与全局偏好配置 |
| FlowInfo | 扉页 | `FlowInfo.tsx` | `/app/flowinfo` | BookOpen | 关于 YiboFlow 的版本与信息 |

### i18n Key 规则

- 导航标签：`nav.<英文id小写>`，例如 `nav.flowkeys`
- 导航提示：`nav.tooltip_<英文id小写>`，例如 `nav.tooltip_flowkeys`
- 页面内容：`<英文id小写>.<key>`，例如 `flowkeys.title`

## 新增页面 Checklist

1. 创建页面文件 `desktop/src/pages/<Name>.tsx`
2. 在 `desktop/src/App.tsx` 中 lazy import 并添加路由
3. 在 `desktop/src/components/Layout.tsx` 中添加导航项（含 icon）
4. 在 `desktop/src/locales/en.json` 和 `zh.json` 中添加所有翻译 key
