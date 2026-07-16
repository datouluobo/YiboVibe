// Legacy "agents" entry kept only for backwards compatibility.
// New IDE integrations should follow the Codex-specific entrypoint pattern
// under pages/<ide>/ instead of extending a single generic agents page.
export { default as default } from "../codex";
export { ChatPanel } from "./ChatPanel";
export { ThreadList } from "./ThreadList";
export { ProjectList } from "./ProjectList";
export { ConfigPanel } from "./ConfigPanel";
export { useWorkbench } from "./hooks";
