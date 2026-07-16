import type { CSSProperties, RefObject } from "react";
import {
  AlertCircle,
  Archive,
  ArrowDownToLine,
  ArrowUpToLine,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  FileText,
  Folder,
  GitBranch,
  Loader2,
  Pin,
  Plus,
  Search,
  Send,
  Square,
} from "lucide-react";
import {
  APPROVAL_POLICIES,
  REASONING_SUMMARIES,
  SANDBOX_MODES,
  summarizeThread,
  formatRelativeAge,
  formatTime,
  normalizeThreadStatus,
  describeItem,
  type AuthStatusResult,
  type CodexModel,
  type CodexPendingApproval,
  type CodexThread,
  type CodexThreadItem,
  type ConversationSummary,
  type ProjectSummary,
} from "../../services/codexBridge";
import {
  WorkbenchEmptyState,
  WorkbenchPanelHeader,
  workbenchFloatingIconButtonStyle,
  workbenchIconButtonStyle,
  workbenchPanelStyle,
  workbenchToolbarMetricStyle,
} from "../workbench/primitives";

const codexSidebarPanelStyle: CSSProperties = {
  background: "#f3f6fa",
  borderRight: "1px solid #d9e0ea",
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const codexSectionTitleStyle: CSSProperties = {
  color: "#8b949e",
  fontSize: 20,
  fontWeight: 500,
  padding: "16px 14px 10px",
};

const codexProjectGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

export const SERVICE_TIER_OPTIONS = ["default", "priority"];

function roleColor(role: string) {
  if (role === "user") return "#8ab4ff";
  if (role === "assistant") return "#7ee787";
  if (role === "tool") return "#f2cc60";
  return "var(--color-text-muted)";
}

function chatMessageStyle(role: string): CSSProperties {
  if (role === "user") {
    return {
      alignSelf: "flex-end",
      maxWidth: "70%",
      borderRadius: 18,
      background: "var(--color-surface-elevated)",
      color: "var(--color-text-main)",
      padding: "10px 14px",
      boxShadow: "0 1px 0 rgba(0,0,0,0.05)",
      userSelect: "text",
      WebkitUserSelect: "text",
    };
  }

  if (role === "assistant") {
    return {
      alignSelf: "stretch",
      maxWidth: "860px",
      borderLeft: "3px solid #52d66b",
      color: "var(--color-text-main)",
      padding: "6px 0 6px 12px",
      userSelect: "text",
      WebkitUserSelect: "text",
    };
  }

  return {
    alignSelf: "stretch",
    borderRadius: 8,
    background: "rgba(255,255,255,0.025)",
    border: "1px dashed var(--color-border)",
    color: "var(--color-text-muted)",
    padding: 10,
    userSelect: "text",
    WebkitUserSelect: "text",
  };
}

function chatTitle(role: string, title: string) {
  if (role === "user") return "";
  if (role === "assistant") return "Codex";
  return title;
}

function isImageLikeString(value: string) {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("data:image/")
    || trimmed.startsWith("blob:")
    || trimmed.includes(".png")
    || trimmed.includes(".jpg")
    || trimmed.includes(".jpeg")
    || trimmed.includes(".gif")
    || trimmed.includes(".webp");
}

function collectImageUrlsFromUnknown(value: unknown): string[] {
  const out = new Set<string>();

  const visit = (input: unknown) => {
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (trimmed && isImageLikeString(trimmed)) {
        out.add(trimmed);
      }
      return;
    }
    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }
    if (!input || typeof input !== "object") {
      return;
    }
    const record = input as Record<string, unknown>;
    const imageUrl = typeof record.image_url === "string"
      ? record.image_url
      : typeof record.imageUrl === "string"
        ? record.imageUrl
        : null;
    if (imageUrl?.trim()) {
      out.add(imageUrl.trim());
    }
    const typedUrl = typeof record.url === "string" && typeof record.type === "string" && record.type.includes("image")
      ? record.url
      : null;
    if (typedUrl?.trim()) {
      out.add(typedUrl.trim());
    }
    Object.values(record).forEach(visit);
  };

  visit(value);
  return Array.from(out);
}

function cleanDisplayedMessageText(text: string, imageCount: number) {
  const cleaned = text
    .split(/\r?\n/)
    .filter((line) => !isImageLikeString(line))
    .join("\n")
    .trim();
  if (cleaned) return cleaned;
  return imageCount > 0 ? `[${imageCount} 张图片]` : "";
}

function codexProjectButtonStyle(active: boolean): CSSProperties {
  return {
    width: "100%",
    border: "none",
    background: active ? "#e4e9f1" : "transparent",
    color: active ? "#20242a" : "#5f6873",
    borderRadius: 10,
    padding: "8px 10px",
    textAlign: "left",
    cursor: "pointer",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 42,
  };
}

function codexThreadButtonStyle(active: boolean): CSSProperties {
  return {
    width: "100%",
    border: "none",
    background: active ? "#e4e9f1" : "transparent",
    color: active ? "#20242a" : "#2f343b",
    borderRadius: 10,
    padding: "8px 10px",
    textAlign: "left",
    cursor: "pointer",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 42,
    fontSize: 18,
  };
}

export function CodexProjectSidebar(props: {
  filteredProjects: ProjectSummary[];
  projects: ProjectSummary[];
  projectSearch: string;
  pinnedProjectPath: string;
  selectedProject?: ProjectSummary;
  selectedThread?: CodexThread;
  isMutatingThread: boolean;
  onSearchChange: (value: string) => void;
  onTogglePin: () => void;
  onCreateThread: () => void;
  onSelectProject: (cwd: string, firstThreadId?: string) => void;
  onSelectThread: (threadId: string) => void;
}) {
  const {
    filteredProjects,
    projects,
    projectSearch,
    pinnedProjectPath,
    selectedProject,
    selectedThread,
    isMutatingThread,
    onSearchChange,
    onTogglePin,
    onCreateThread,
    onSelectProject,
    onSelectThread,
  } = props;

  return (
    <div style={codexSidebarPanelStyle}>
      <div style={{ ...codexSectionTitleStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>项目</span>
        <button
          type="button"
          title="新建对话"
          onClick={onCreateThread}
          disabled={isMutatingThread}
          style={workbenchIconButtonStyle}
        >
          {isMutatingThread ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        </button>
      </div>
      <div style={{ padding: "0 10px 10px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr) auto",
            alignItems: "center",
            gap: 8,
            border: "1px solid #d9e0ea",
            background: "#fff",
            borderRadius: 8,
            padding: "7px 9px",
          }}
        >
          <Search size={15} style={{ color: "#8b949e" }} />
          <input
            value={projectSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索项目或对话"
            style={{
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--color-text-main)",
              fontSize: 13,
            }}
          />
          <button
            type="button"
            title={selectedProject?.cwd === pinnedProjectPath ? "取消置顶" : "置顶当前项目"}
            onClick={onTogglePin}
            style={{ ...workbenchIconButtonStyle, width: 26, height: 26, background: "transparent", boxShadow: "none" }}
          >
            <Pin size={13} />
          </button>
        </div>
      </div>
      <div style={{ overflow: "auto", padding: "0 10px 14px", display: "flex", flexDirection: "column", gap: 2 }}>
        {filteredProjects.map((project) => {
          const projectActive = project.cwd === selectedProject?.cwd;
          return (
            <div key={project.cwd} style={codexProjectGroupStyle}>
              <button
                type="button"
                onClick={() => onSelectProject(project.cwd, project.threads[0]?.id)}
                style={codexProjectButtonStyle(projectActive)}
              >
                <Folder size={17} style={{ flexShrink: 0, opacity: 0.82 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 20,
                      fontWeight: projectActive ? 650 : 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {project.name}
                  </span>
                </div>
              </button>
              {projectActive &&
                project.threads.map((thread) => {
                  const threadActive = thread.id === selectedThread?.id;
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => onSelectThread(thread.id)}
                      style={codexThreadButtonStyle(threadActive)}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {summarizeThread(thread)}
                      </span>
                      <span style={{ color: "#8b949e", flexShrink: 0 }}>{formatRelativeAge(thread.updatedAt)}</span>
                    </button>
                  );
                })}
              {projectActive && !project.threads.length && (
                <div style={{ color: "#b7bdc7", fontSize: 18, padding: "8px 10px 8px 40px" }}>暂无对话</div>
              )}
            </div>
          );
        })}
        {!filteredProjects.length && (
          <WorkbenchEmptyState
            icon={<Folder size={18} />}
            text={projects.length ? "没有匹配的项目或对话。" : "还没有读取到项目。先确认 Codex Desktop 有历史线程。"}
          />
        )}
      </div>
    </div>
  );
}

export function CodexConversationPanel(props: {
  selectedThread?: CodexThread;
  threadDetail: CodexThread | null;
  conversationSummary: ConversationSummary | null;
  isLoadingThread: boolean;
  isLoadingSummary: boolean;
  isMutatingThread: boolean;
  activeTurnId: string;
  pendingApproval: CodexPendingApproval | null;
  visibleConversationItems: CodexThreadItem[];
  hiddenTechnicalEventCount: number;
  collapsedChatEventCount: number;
  showTechnicalEvents: boolean;
  copiedMessageKey: string;
  chatScrollRef: RefObject<HTMLDivElement | null>;
  sendStatus: string;
  sendError: string;
  liveStatus: string;
  liveWarning: string;
  liveEventCount: number;
  onRenameThread: () => void;
  onArchiveThread: () => void;
  onInterruptTurn: () => void;
  onRespondApproval: (approved: boolean) => void;
  onScrollChatToTop: () => void;
  onScrollChatToBottom: () => void;
  onCopyMessageText: (key: string, text: string) => void;
  onChatScroll: (element: HTMLDivElement) => void;
}) {
  const {
    selectedThread,
    threadDetail,
    conversationSummary,
    isLoadingThread,
    isLoadingSummary,
    isMutatingThread,
    activeTurnId,
    pendingApproval,
    visibleConversationItems,
    hiddenTechnicalEventCount,
    collapsedChatEventCount,
    showTechnicalEvents,
    copiedMessageKey,
    chatScrollRef,
    sendStatus,
    sendError,
    liveStatus,
    liveWarning,
    liveEventCount,
    onRenameThread,
    onArchiveThread,
    onInterruptTurn,
    onRespondApproval,
    onScrollChatToTop,
    onScrollChatToBottom,
    onCopyMessageText,
    onChatScroll,
  } = props;

  const currentThreadStatus = normalizeThreadStatus(threadDetail ?? selectedThread);
  const approvalAcceptLabel = pendingApproval?.kind === "permissions-approval" ? "授权并继续" : "确认并继续";
  const approvalRejectLabel = pendingApproval?.kind === "permissions-approval" ? "不授权" : "拒绝";

  return (
    <div style={{ ...workbenchPanelStyle, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <WorkbenchPanelHeader
        icon={<Bot size={15} />}
        title="对话"
        meta={
          activeTurnId
            ? "运行中"
            : isLoadingThread
              ? "读取中"
              : showTechnicalEvents
                ? `${visibleConversationItems.length} 条聊天消息`
                : `${visibleConversationItems.length} 条 · 折叠 ${collapsedChatEventCount} · 隐藏 ${hiddenTechnicalEventCount}`
        }
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "10px 12px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
              {selectedThread ? summarizeThread(selectedThread) : "未选择"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                title="重命名"
                onClick={onRenameThread}
                disabled={!selectedThread || isMutatingThread}
                style={workbenchIconButtonStyle}
              >
                <Edit3 size={14} />
              </button>
              <button
                type="button"
                title="归档"
                onClick={onArchiveThread}
                disabled={!selectedThread || isMutatingThread}
                style={workbenchIconButtonStyle}
              >
                <Archive size={14} />
              </button>
              <button
                type="button"
                title="中断回复"
                onClick={onInterruptTurn}
                disabled={!activeTurnId || isMutatingThread}
                style={{
                  ...workbenchIconButtonStyle,
                  color: activeTurnId ? "#ef4444" : "var(--color-text-muted)",
                }}
              >
                {isMutatingThread && activeTurnId ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} />}
              </button>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 6,
              color: "var(--color-text-muted)",
              fontSize: 11,
            }}
          >
            <span>来源: {conversationSummary?.source || selectedThread?.source || "unknown"}</span>
            <span>CLI: {conversationSummary?.cliVersion || selectedThread?.cliVersion || "unknown"}</span>
            <span>状态: {currentThreadStatus}{activeTurnId ? ` / ${activeTurnId.slice(0, 8)}` : ""}</span>
            <span>{isLoadingSummary ? "摘要读取中" : `更新: ${formatTime(conversationSummary?.updatedAt || selectedThread?.updatedAt)}`}</span>
          </div>
        </div>
      </div>

      <div
        ref={chatScrollRef}
        onScroll={(event) => onChatScroll(event.currentTarget)}
        style={{
          overflow: "auto",
          padding: "18px 24px",
          minHeight: 0,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          scrollBehavior: "smooth",
          scrollbarGutter: "stable",
          userSelect: "text",
          WebkitUserSelect: "text",
        }}
      >
        {pendingApproval && (
          <div
            style={{
              alignSelf: "stretch",
              border: "1px solid rgba(250, 204, 21, 0.5)",
              background: "rgba(250, 204, 21, 0.08)",
              borderRadius: 12,
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ color: "#d29922", fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>
                待确认操作
              </div>
              <div style={{ color: "var(--color-text-main)", fontSize: 14, fontWeight: 700 }}>
                {pendingApproval.title}
              </div>
              {pendingApproval.summary && (
                <div
                  style={{
                    color: "var(--color-text-muted)",
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {pendingApproval.summary}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={isMutatingThread}
                onClick={() => onRespondApproval(false)}
                style={{
                  minHeight: 36,
                  borderRadius: 10,
                  borderColor: "rgba(239,68,68,0.5)",
                  color: "#ef4444",
                }}
              >
                {isMutatingThread ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
                {approvalRejectLabel}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={isMutatingThread}
                onClick={() => onRespondApproval(true)}
                style={{
                  minHeight: 36,
                  borderRadius: 10,
                  borderColor: "rgba(34,197,94,0.55)",
                  color: "#22c55e",
                }}
              >
                {isMutatingThread ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {approvalAcceptLabel}
              </button>
            </div>
          </div>
        )}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            display: "flex",
            justifyContent: "flex-end",
            gap: 6,
            height: 0,
            pointerEvents: "none",
          }}
        >
          <button
            type="button"
            title="到顶部"
            onClick={onScrollChatToTop}
            style={workbenchFloatingIconButtonStyle}
          >
            <ArrowUpToLine size={14} />
          </button>
          <button
            type="button"
            title="到底部"
            onClick={onScrollChatToBottom}
            style={workbenchFloatingIconButtonStyle}
          >
            <ArrowDownToLine size={14} />
          </button>
        </div>
        {isLoadingThread && <WorkbenchEmptyState icon={<Loader2 size={18} />} text="正在读取 thread/read..." />}
        {!isLoadingThread &&
          !showTechnicalEvents &&
          hiddenTechnicalEventCount > 0 && (
            <div
              style={{
                color: "var(--color-text-muted)",
                background: "rgba(255,255,255,0.025)",
                border: "1px dashed var(--color-border)",
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 12,
                alignSelf: "stretch",
              }}
            >
              已按聊天视图隐藏 {hiddenTechnicalEventCount} 个推理、命令、文件变更或工具事件。
            </div>
          )}
        {!isLoadingThread &&
          visibleConversationItems.map((item, index) => {
            const described = describeItem(item);
            const imageUrls = collectImageUrlsFromUnknown(item.content ?? item.text);
            const displayText = cleanDisplayedMessageText(described.text, imageUrls.length);
            const color = roleColor(described.role);
            const title = chatTitle(described.role, described.title);
            const messageKey = `${item.type ?? "item"}-${index}-${displayText.length}-${imageUrls.length}`;
            return (
              <div
                key={messageKey}
                style={{
                  ...chatMessageStyle(described.role),
                  position: "relative",
                  paddingRight: described.role === "user" ? 42 : 36,
                }}
              >
                <button
                  type="button"
                  title={copiedMessageKey === messageKey ? "已复制" : "复制消息"}
                  onClick={() => onCopyMessageText(messageKey, displayText)}
                  style={{
                    ...workbenchIconButtonStyle,
                    position: "absolute",
                    top: described.role === "user" ? 6 : 2,
                    right: described.role === "user" ? 8 : 0,
                  }}
                >
                  {copiedMessageKey === messageKey ? <Check size={14} /> : <Copy size={14} />}
                </button>
                {title && <div style={{ color, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{title}</div>}
                {imageUrls.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: displayText ? 10 : 0 }}>
                    {imageUrls.map((url) => (
                      <img
                        key={url}
                        src={url}
                        alt="会话图片"
                        style={{
                          maxWidth: "min(100%, 520px)",
                          maxHeight: 320,
                          borderRadius: 12,
                          border: "1px solid var(--color-border)",
                          objectFit: "cover",
                          background: "rgba(255,255,255,0.04)",
                        }}
                      />
                    ))}
                  </div>
                )}
                {displayText ? (
                  <pre
                    style={{
                      margin: 0,
                      color: "var(--color-text-main)",
                      fontFamily:
                        described.role === "tool" || displayText.includes("{\n")
                          ? "'JetBrains Mono', 'Cascadia Code', monospace"
                          : "inherit",
                      fontSize: 13,
                      lineHeight: 1.75,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      userSelect: "text",
                      WebkitUserSelect: "text",
                    }}
                  >
                    {displayText}
                  </pre>
                ) : (
                  <div style={{ color: "var(--color-text-muted)", fontSize: 12 }}>(empty)</div>
                )}
              </div>
            );
          })}
        {!isLoadingThread && !visibleConversationItems.length && (
          <WorkbenchEmptyState icon={<FileText size={18} />} text="已选对话没有返回 turns，或该线程尚未加载正文。" />
        )}
      </div>

      {(sendError || sendStatus || (showTechnicalEvents && (liveStatus || liveWarning))) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, margin: "8px 18px 0", fontSize: 12 }}>
          {sendError && (
            <pre
              style={{
                margin: 0,
                color: "#ff7b72",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 120,
                overflow: "auto",
              }}
            >
              {`发送失败：${sendError}`}
            </pre>
          )}
          {!sendError && sendStatus && <div style={{ color: "var(--color-text-muted)" }}>{sendStatus}</div>}
          {!sendError && showTechnicalEvents && liveStatus && (
            <div style={{ color: "var(--color-text-muted)" }}>
              {`连接事件：${liveStatus}${liveEventCount ? ` · ${liveEventCount}` : ""}`}
            </div>
          )}
          {showTechnicalEvents && liveWarning && (
            <pre
              style={{
                margin: 0,
                color: "#d29922",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 96,
                overflow: "auto",
              }}
            >
              {`Codex 警告：${liveWarning}`}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function CodexComposerPanel(props: {
  selectedThread?: CodexThread;
  selectedProject?: ProjectSummary;
  models: CodexModel[];
  modelEfforts: string[];
  draftMessage: string;
  currentPath: string;
  currentBranch: string;
  authStatus: AuthStatusResult | null;
  selectedModel: string;
  selectedServiceTier: string;
  selectedEffort: string;
  selectedSummary: string;
  selectedApprovalPolicy: string;
  selectedSandboxMode: string;
  showTechnicalEvents: boolean;
  isSendingTurn: boolean;
  isMutatingThread: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onSwitchProjectBranch: (branch: string) => void;
  onSelectedModelChange: (model: string) => void;
  onSelectedServiceTierChange: (tier: string) => void;
  onSelectedEffortChange: (effort: string) => void;
  onSelectedSummaryChange: (summary: string) => void;
  onSelectedApprovalPolicyChange: (policy: string) => void;
  onSelectedSandboxModeChange: (mode: string) => void;
  onApplyProjectConfig: () => void;
  onShowTechnicalEventsChange: (value: boolean) => void;
}) {
  const {
    selectedThread,
    selectedProject,
    models,
    modelEfforts,
    draftMessage,
    currentPath,
    currentBranch,
    authStatus,
    selectedModel,
    selectedServiceTier,
    selectedEffort,
    selectedSummary,
    selectedApprovalPolicy,
    selectedSandboxMode,
    showTechnicalEvents,
    isSendingTurn,
    isMutatingThread,
    onDraftChange,
    onSend,
    onSwitchProjectBranch,
    onSelectedModelChange,
    onSelectedServiceTierChange,
    onSelectedEffortChange,
    onSelectedSummaryChange,
    onSelectedApprovalPolicyChange,
    onSelectedSandboxModeChange,
    onApplyProjectConfig,
    onShowTechnicalEventsChange,
  } = props;

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-border)",
        padding: "12px 18px 16px",
        background: "var(--color-surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          background: "var(--color-surface-elevated)",
          padding: "10px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <textarea
            value={draftMessage}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            disabled={!selectedThread || isSendingTurn}
            placeholder={selectedThread ? "给 Codex 发送消息" : "请选择一个对话"}
            rows={1}
            style={{
              minHeight: 40,
              maxHeight: 140,
              resize: "vertical",
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--color-text-main)",
              font: "inherit",
              fontSize: 15,
              lineHeight: 1.6,
              padding: "8px 6px",
            }}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!draftMessage.trim() || !selectedThread || isSendingTurn}
            title="发送"
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              border: "none",
              display: "grid",
              placeItems: "center",
              background:
                draftMessage.trim() && selectedThread && !isSendingTurn
                  ? "var(--color-primary)"
                  : "rgba(148,163,184,0.35)",
              color: "#fff",
              cursor: draftMessage.trim() && selectedThread && !isSendingTurn ? "pointer" : "default",
            }}
          >
            {isSendingTurn ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(160px, 1fr) minmax(100px, 0.8fr) minmax(150px, 1fr) 104px 96px 86px 120px 132px auto auto",
            gap: 8,
            alignItems: "center",
          }}
        >
          <div style={workbenchToolbarMetricStyle}>
            <Folder size={14} />
            <span
              title={currentPath}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {currentPath}
            </span>
          </div>
          <div style={workbenchToolbarMetricStyle}>
            <GitBranch size={14} />
            <select
              className="modern-input custom-select"
              value={currentBranch}
              onChange={(event) => onSwitchProjectBranch(event.target.value)}
              disabled={!selectedProject?.branches.length || isMutatingThread}
              style={{ fontSize: 12, border: "none", background: "transparent", padding: 0, minWidth: 0 }}
            >
              {(selectedProject?.branches.length ? selectedProject.branches : [currentBranch]).map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </div>
          <div style={workbenchToolbarMetricStyle}>
            {authStatus?.requiresOpenaiAuth ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {authStatus?.authMethod || (authStatus ? "authenticated" : "auth unknown")}
            </span>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
            <select
              className="modern-input custom-select"
              value={selectedModel}
              onChange={(event) => onSelectedModelChange(event.target.value)}
              style={{ fontSize: 12 }}
            >
              {models.map((model) => {
                const value = model.id || model.model || "";
                return (
                  <option key={value} value={value}>
                    {model.displayName || model.model || value}
                  </option>
                );
              })}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
            <select
              className="modern-input custom-select"
              value={selectedServiceTier}
              onChange={(event) => onSelectedServiceTierChange(event.target.value)}
              style={{ fontSize: 12 }}
            >
              {SERVICE_TIER_OPTIONS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
            <select
              className="modern-input custom-select"
              value={selectedEffort}
              onChange={(event) => onSelectedEffortChange(event.target.value)}
              style={{ fontSize: 12 }}
            >
              {modelEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
            <select
              className="modern-input custom-select"
              value={selectedSummary}
              onChange={(event) => onSelectedSummaryChange(event.target.value)}
              style={{ fontSize: 12 }}
            >
              {REASONING_SUMMARIES.map((summary) => (
                <option key={summary} value={summary}>
                  {summary}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
            <select
              className="modern-input custom-select"
              value={selectedApprovalPolicy}
              onChange={(event) => onSelectedApprovalPolicyChange(event.target.value)}
              style={{ fontSize: 12 }}
            >
              {APPROVAL_POLICIES.map((policy) => (
                <option key={policy} value={policy}>
                  {policy}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
            <select
              className="modern-input custom-select"
              value={selectedSandboxMode}
              onChange={(event) => onSelectedSandboxModeChange(event.target.value)}
              style={{ fontSize: 12 }}
            >
              {SANDBOX_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={onApplyProjectConfig}
            disabled={isMutatingThread}
            title="写回确认与沙箱配置"
            style={{ minHeight: 35, borderRadius: 8, whiteSpace: "nowrap", fontSize: 12 }}
          >
            {isMutatingThread ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            确认/沙箱
          </button>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--color-text-muted)",
              fontSize: 12,
              paddingBottom: 9,
              whiteSpace: "nowrap",
            }}
          >
            <input
              type="checkbox"
              checked={showTechnicalEvents}
              onChange={(event) => onShowTechnicalEventsChange(event.target.checked)}
            />
            技术事件
          </label>
        </div>
      </div>
    </div>
  );
}
