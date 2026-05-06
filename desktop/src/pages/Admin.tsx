import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  ShieldCheck,
  Users,
  Monitor,
  RefreshCw,
  ArrowUpDown,
  ToggleLeft,
  ToggleRight,
  Trash2,
  KeyRound,
  LogOut,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface AdminUser {
  uid: number;
  username: string;
  role: string;
  status: string;
  created_at: string;
}

interface AdminDevice {
  id: number;
  uid: number;
  username: string;
  device_name: string;
  device_type: string;
  last_seen_at: string;
}

interface FlowSyncDiagnostics {
  remote_device_id: number | null;
}

interface FlowSyncStagingPolicy {
  id: number;
  staging_enabled: boolean;
  default_ttl_seconds: number;
  max_ttl_seconds: number;
  max_object_size_bytes: number;
  user_quota_bytes: number;
  external_links_enabled: boolean;
  external_link_max_ttl_seconds: number;
  gc_interval_seconds: number;
}

type Tab = "users" | "devices";
type DeviceSortKey = "id" | "device_name" | "username" | "device_type" | "last_seen_at";
type SortDirection = "asc" | "desc";
type ConfirmAction =
  | { isOpen: false; kind: null; id: number; label: string }
  | { isOpen: true; kind: "delete-user" | "kick-device"; id: number; label: string };

export default function Admin() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [currentRemoteDeviceId, setCurrentRemoteDeviceId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadError, setLoadError] = useState("");
  const [resetPasswordModal, setResetPasswordModal] = useState<{
    isOpen: boolean;
    uid: number;
    username: string;
  }>({ isOpen: false, uid: 0, username: "" });
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordHint, setNewPasswordHint] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deviceSort, setDeviceSort] = useState<{
    key: DeviceSortKey;
    direction: SortDirection;
  }>({
    key: "last_seen_at",
    direction: "desc",
  });
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>({
    isOpen: false,
    kind: null,
    id: 0,
    label: "",
  });
  const [stagingPolicyDraft, setStagingPolicyDraft] = useState<FlowSyncStagingPolicy | null>(null);
  const [stagingPolicyLoading, setStagingPolicyLoading] = useState(false);

  const tryRestoreAdminSession = useCallback(async () => {
    const serverUrl = localStorage.getItem("yiboflow_server_url") || "";
    const username = localStorage.getItem("yiboflow_username") || "";
    const savedPwdB64 = localStorage.getItem("yiboflow_saved_pwd") || "";
    const deviceName =
      localStorage.getItem("yiboflow_device_name") || "Sim-PC-1";

    if (!serverUrl || !username || !savedPwdB64) {
      return false;
    }

    try {
      const password = atob(savedPwdB64);
      const result: { success: boolean; role: string } = await invoke(
        "connect_engine",
        {
          serverUrl,
          username,
          password,
          deviceName,
        }
      );
      if (result.success) {
        localStorage.setItem("yiboflow_user_role", result.role);
        return true;
      }
    } catch (error) {
      console.error("Failed to restore admin session:", error);
    }

    return false;
  }, []);

  const invokeAdminAction = useCallback(
    async <T,>(command: string, args?: Record<string, unknown>, allowRetry = true) => {
      try {
        return await invoke<T>(command, args);
      } catch (error) {
        const message = String(error);
        const shouldRetry =
          allowRetry &&
          (message.includes("Not authenticated") ||
            message.includes("Admin access required") ||
            message.includes("Invalid or expired access token"));

        if (shouldRetry && (await tryRestoreAdminSession())) {
          return invokeAdminAction<T>(command, args, false);
        }

        throw error;
      }
    },
    [tryRestoreAdminSession]
  );

  // Load data
  const loadData = useCallback(async (allowRetry = true) => {
    setLoading(true);
    setLoadError("");
    try {
      const diagnostics = await invoke<FlowSyncDiagnostics>("get_flowsync_diagnostics");
      setCurrentRemoteDeviceId(diagnostics.remote_device_id);
      setStagingPolicyLoading(true);
      const policy = await invokeAdminAction<FlowSyncStagingPolicy>("admin_get_flowsync_staging_policy");
      setStagingPolicyDraft(policy);

      if (activeTab === "users") {
        const data: AdminUser[] = await invoke("admin_list_users");
        setUsers(data);
      } else {
        const data: AdminDevice[] = await invoke("admin_list_devices");
        setDevices(data);
      }
    } catch (error) {
      console.error("Failed to load admin data:", error);
      const message = String(error);
      const shouldRetry =
        allowRetry &&
        (message.includes("Not authenticated") ||
          message.includes("Admin access required") ||
          message.includes("Invalid or expired access token"));

      if (shouldRetry && (await tryRestoreAdminSession())) {
        await loadData(false);
        return;
      }

      setLoadError(message);
    } finally {
      setStagingPolicyLoading(false);
      setLoading(false);
    }
  }, [activeTab, tryRestoreAdminSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Toggle user status
  const handleToggleStatus = async (uid: number, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "disabled" : "active";
    setActionLoading(`user-status:${uid}`);
    setLoadError("");
    try {
      await invokeAdminAction("admin_update_user_status", { uid, newStatus });
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, status: newStatus } : u))
      );
    } catch (error) {
      console.error("Failed to update user status:", error);
      setLoadError(String(error));
    } finally {
      setActionLoading(null);
    }
  };

  // Delete user
  const handleDeleteUser = async (uid: number, username: string) => {
    setConfirmAction({
      isOpen: true,
      kind: "delete-user",
      id: uid,
      label: username,
    });
  };

  // Reset password
  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 8) return;
    setActionLoading(`user-reset:${resetPasswordModal.uid}`);
    setLoadError("");
    try {
      await invokeAdminAction("admin_reset_password", {
        uid: resetPasswordModal.uid,
        newPassword,
        newPasswordHint,
      });
      setResetPasswordModal({ isOpen: false, uid: 0, username: "" });
      setNewPassword("");
      setNewPasswordHint("");
    } catch (error) {
      console.error("Failed to reset password:", error);
      setLoadError(String(error));
    } finally {
      setActionLoading(null);
    }
  };

  // Kick device
  const handleKickDevice = async (deviceId: number, deviceName: string) => {
    setConfirmAction({
      isOpen: true,
      kind: "kick-device",
      id: deviceId,
      label: deviceName,
    });
  };

  const handleConfirmAction = async () => {
    if (!confirmAction.isOpen || !confirmAction.kind) {
      return;
    }

    const currentAction = confirmAction;
    setConfirmAction({ isOpen: false, kind: null, id: 0, label: "" });
    setLoadError("");

    if (currentAction.kind === "delete-user") {
      setActionLoading(`user-delete:${currentAction.id}`);
      try {
        await invokeAdminAction("admin_delete_user", { uid: currentAction.id });
        setUsers((prev) => prev.filter((u) => u.uid !== currentAction.id));
      } catch (error) {
        console.error("Failed to delete user:", error);
        setLoadError(String(error));
      } finally {
        setActionLoading(null);
      }
      return;
    }

    setActionLoading(`device-kick:${currentAction.id}`);
    try {
      await invokeAdminAction("admin_kick_device", { deviceId: currentAction.id });
      setDevices((prev) => prev.filter((d) => d.id !== currentAction.id));
    } catch (error) {
      console.error("Failed to kick device:", error);
      setLoadError(String(error));
    } finally {
      setActionLoading(null);
    }
  };

  // Filter data based on search
  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredDevices = devices.filter(
    (d) =>
      d.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.device_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.device_type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedDevices = [...filteredDevices].sort((a, b) => {
    const directionFactor = deviceSort.direction === "asc" ? 1 : -1;

    switch (deviceSort.key) {
      case "id":
        return (a.id - b.id) * directionFactor;
      case "last_seen_at": {
        const aTime = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
        const bTime = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
        return (aTime - bTime) * directionFactor;
      }
      case "device_name":
      case "username":
      case "device_type":
      default:
        return a[deviceSort.key].localeCompare(b[deviceSort.key], undefined, {
          sensitivity: "base",
          numeric: true,
        }) * directionFactor;
    }
  });

  const isProtectedAdmin = (user: AdminUser) =>
    user.username.trim().toLowerCase() === "admin";

  const toggleDeviceSort = (key: DeviceSortKey) => {
    setDeviceSort((prev) =>
      prev.key === key
        ? {
            key,
            direction: prev.direction === "asc" ? "desc" : "asc",
          }
        : {
            key,
            direction: key === "last_seen_at" || key === "id" ? "desc" : "asc",
          }
    );
  };

  const renderDeviceHeader = (
    key: DeviceSortKey,
    label: string,
    align: "left" | "right" = "left"
  ) => {
    const active = deviceSort.key === key;
    const indicator = active
      ? deviceSort.direction === "asc"
        ? "↑"
        : "↓"
      : "";

    return (
      <button
        type="button"
        onClick={() => toggleDeviceSort(key)}
        className="btn-ghost"
        style={{
          padding: 0,
          border: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: align === "right" ? "flex-end" : "flex-start",
          gap: "6px",
          fontSize: "12px",
          fontWeight: 600,
          color: active
            ? "var(--color-text-main)"
            : "var(--color-text-dim)",
          width: "100%",
        }}
      >
        <span>{label}</span>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            color: active ? "var(--color-primary)" : "var(--color-text-dim)",
            opacity: active ? 1 : 0.7,
            minWidth: "12px",
          }}
        >
          {indicator || <ArrowUpDown size={12} />}
        </span>
      </button>
    );
  };

  const handleSaveStagingPolicy = async () => {
    if (!stagingPolicyDraft) return;
    setActionLoading("staging-policy");
    setLoadError("");
    try {
      const saved = await invokeAdminAction<FlowSyncStagingPolicy>(
        "admin_update_flowsync_staging_policy",
        { policy: stagingPolicyDraft }
      );
      setStagingPolicyDraft(saved);
    } catch (error) {
      console.error("Failed to update staging policy:", error);
      setLoadError(String(error));
    } finally {
      setActionLoading(null);
    }
  };

  const updateStagingDraft = <K extends keyof FlowSyncStagingPolicy>(
    key: K,
    value: FlowSyncStagingPolicy[K]
  ) => {
    setStagingPolicyDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  return (
    <div className="page-container">
      {/* Page Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1
          style={{
            fontSize: "20px",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            margin: 0,
            color: "var(--color-text-main)",
          }}
        >
          <ShieldCheck size={22} color="var(--color-primary)" />
          {t("admin.title")}
        </h1>
        <p
          style={{
            color: "var(--color-text-dim)",
            fontSize: "13px",
            marginTop: "6px",
          }}
        >
          {t("admin.subtitle")}
        </p>
      </div>

      {/* Tab Navigation */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          marginBottom: "20px",
          padding: "4px",
          background: "var(--color-surface-elevated)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-border)",
          width: "fit-content",
        }}
      >
        <button
          onClick={() => setActiveTab("users")}
          style={{
            padding: "8px 16px",
            borderRadius: "var(--radius-md)",
            border: "none",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background:
              activeTab === "users"
                ? "var(--color-primary)"
                : "transparent",
            color:
              activeTab === "users" ? "#fff" : "var(--color-text-muted)",
            transition: "all 0.2s",
          }}
        >
          <Users size={16} />
          {t("admin.tab_users")}
        </button>
        <button
          onClick={() => setActiveTab("devices")}
          style={{
            padding: "8px 16px",
            borderRadius: "var(--radius-md)",
            border: "none",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background:
              activeTab === "devices"
                ? "var(--color-primary)"
                : "transparent",
            color:
              activeTab === "devices" ? "#fff" : "var(--color-text-muted)",
            transition: "all 0.2s",
          }}
        >
          <Monitor size={16} />
          {t("admin.tab_devices")}
        </button>
      </div>

      {/* Search and Refresh */}
      <div
        className="glass-panel"
        style={{
          marginBottom: "16px",
          padding: "16px",
          borderRadius: "var(--radius-lg)",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-main)" }}>
              FlowSync NAS 暂存策略
            </div>
            <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              管理是否允许上传暂存、TTL 上限、对象大小和用户配额。
            </div>
          </div>
          <button
            onClick={() => void handleSaveStagingPolicy()}
            className="btn-primary"
            disabled={!stagingPolicyDraft || actionLoading === "staging-policy"}
            style={{ padding: "9px 16px", fontSize: "13px" }}
          >
            {actionLoading === "staging-policy" ? "保存中..." : "保存策略"}
          </button>
        </div>
        {stagingPolicyLoading || !stagingPolicyDraft ? (
          <div style={{ fontSize: "12px", color: "var(--color-text-dim)" }}>正在加载暂存策略...</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "12px",
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              全局暂存开关
              <button
                type="button"
                className="btn-ghost"
                onClick={() => updateStagingDraft("staging_enabled", !stagingPolicyDraft.staging_enabled)}
                style={{ justifyContent: "flex-start", padding: "10px 12px", fontSize: "13px", gap: "8px" }}
              >
                {stagingPolicyDraft.staging_enabled ? <CheckCircle2 size={14} color="#22c55e" /> : <XCircle size={14} color="#ef4444" />}
                {stagingPolicyDraft.staging_enabled ? "已启用" : "已关闭"}
              </button>
            </label>
            {[
              ["default_ttl_seconds", "默认 TTL（秒）"],
              ["max_ttl_seconds", "最大 TTL（秒）"],
              ["max_object_size_bytes", "单对象大小上限（字节）"],
              ["user_quota_bytes", "单用户配额（字节）"],
              ["external_link_max_ttl_seconds", "外链最大 TTL（秒）"],
              ["gc_interval_seconds", "GC 间隔（秒）"],
            ].map(([key, label]) => (
              <label
                key={key}
                style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--color-text-dim)" }}
              >
                {label}
                <input
                  type="number"
                  min={0}
                  value={String(stagingPolicyDraft[key as keyof FlowSyncStagingPolicy] ?? 0)}
                  onChange={(e) =>
                    updateStagingDraft(
                      key as keyof FlowSyncStagingPolicy,
                      Number(e.target.value) as never
                    )
                  }
                  style={{
                    padding: "10px 12px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface-elevated)",
                    color: "var(--color-text-main)",
                    fontSize: "13px",
                  }}
                />
              </label>
            ))}
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              外链功能开关
              <button
                type="button"
                className="btn-ghost"
                onClick={() => updateStagingDraft("external_links_enabled", !stagingPolicyDraft.external_links_enabled)}
                style={{ justifyContent: "flex-start", padding: "10px 12px", fontSize: "13px", gap: "8px" }}
              >
                {stagingPolicyDraft.external_links_enabled ? <CheckCircle2 size={14} color="#22c55e" /> : <XCircle size={14} color="#ef4444" />}
                {stagingPolicyDraft.external_links_enabled ? "已启用" : "已关闭"}
              </button>
            </label>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "16px",
          alignItems: "center",
        }}
      >
        <div
          style={{
            flex: 1,
            position: "relative",
            maxWidth: "400px",
          }}
        >
          <Search
            size={16}
            style={{
              position: "absolute",
              left: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--color-text-dim)",
            }}
          />
          <input
            type="text"
            placeholder={t("admin.search_placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px 10px 36px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-elevated)",
              color: "var(--color-text-main)",
              fontSize: "13px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        <button
          onClick={() => {
            void loadData();
          }}
          className="btn-ghost"
          style={{
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            fontSize: "13px",
          }}
        >
          <RefreshCw size={14} />
          {t("admin.refresh")}
        </button>
      </div>

      {loadError && (
        <div
          className="glass-panel"
          style={{
            marginBottom: "16px",
            padding: "14px 16px",
            borderRadius: "var(--radius-lg)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            background: "rgba(239, 68, 68, 0.06)",
            color: "#b91c1c",
            fontSize: "13px",
            lineHeight: 1.5,
          }}
        >
          管理页数据加载失败：{loadError}
        </div>
      )}

      {/* Content Area */}
      <div className="glass-panel" style={{ borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        {loading ? (
          <div
            style={{
              padding: "60px 20px",
              textAlign: "center",
              color: "var(--color-text-dim)",
              fontSize: "13px",
            }}
          >
            {t("admin.loading")}
          </div>
        ) : activeTab === "users" ? (
          /* Users Table */
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
                tableLayout: "fixed",
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                    background: "var(--color-surface-elevated)",
                  }}
                >
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                      fontWeight: 600,
                      color: "var(--color-text-dim)",
                      fontSize: "12px",
                      width: "72px",
                    }}
                  >
                    {t("admin.col_uid")}
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                      fontWeight: 600,
                      color: "var(--color-text-dim)",
                      fontSize: "12px",
                      width: "120px",
                    }}
                  >
                    {t("admin.col_username")}
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                      fontWeight: 600,
                      color: "var(--color-text-dim)",
                      fontSize: "12px",
                      width: "140px",
                    }}
                  >
                    {t("admin.col_role")}
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                      fontWeight: 600,
                      color: "var(--color-text-dim)",
                      fontSize: "12px",
                      width: "180px",
                    }}
                  >
                    {t("admin.col_status")}
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                      fontWeight: 600,
                      color: "var(--color-text-dim)",
                      fontSize: "12px",
                    }}
                  >
                    {t("admin.col_created_at")}
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "12px 16px",
                      fontWeight: 600,
                      color: "var(--color-text-dim)",
                      fontSize: "12px",
                      width: "132px",
                    }}
                  >
                    {t("admin.col_actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        textAlign: "center",
                        padding: "40px 20px",
                        color: "var(--color-text-dim)",
                        fontStyle: "italic",
                      }}
                    >
                      {t("admin.no_users")}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr
                      key={user.uid}
                      style={{
                        borderBottom: "1px solid var(--color-border)",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          "var(--color-surface-elevated)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >
                      <td style={{ padding: "12px 16px", fontFamily: "monospace" }}>
                        {user.uid}
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {user.username}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "4px 8px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 700,
                            minWidth: "92px",
                            background:
                              user.role === "admin"
                                ? "rgba(99, 102, 241, 0.15)"
                                : "rgba(150, 150, 150, 0.15)",
                            color:
                              user.role === "admin"
                                ? "var(--color-primary)"
                                : "var(--color-text-muted)",
                            border: `1px solid ${
                              user.role === "admin"
                                ? "rgba(99, 102, 241, 0.3)"
                                : "var(--color-border)"
                            }`,
                          }}
                        >
                          {user.role}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "4px 8px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 700,
                            justifyContent: "center",
                            minWidth: "92px",
                            background:
                              user.status === "active"
                                ? "rgba(34, 197, 94, 0.12)"
                                : "rgba(239, 68, 68, 0.12)",
                            color:
                              user.status === "active" ? "#22c55e" : "#ef4444",
                            border: `1px solid ${
                              user.status === "active"
                                ? "rgba(34, 197, 94, 0.28)"
                                : "rgba(239, 68, 68, 0.28)"
                            }`,
                          }}
                        >
                          {user.status === "active" ? (
                            <CheckCircle2 size={12} />
                          ) : (
                            <XCircle size={12} />
                          )}
                          {user.status}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          color: "var(--color-text-dim)",
                          fontSize: "12px",
                        }}
                      >
                        {user.created_at}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            justifyContent: "flex-end",
                            alignItems: "center",
                            width: "100%",
                            minHeight: "30px",
                          }}
                        >
                          {!isProtectedAdmin(user) && (
                            <button
                              onClick={() =>
                                handleToggleStatus(user.uid, user.status)
                              }
                              disabled={actionLoading === `user-status:${user.uid}`}
                              className="btn-ghost"
                              title={
                                user.status === "active"
                                  ? t("admin.status_active")
                                  : t("admin.status_disabled")
                              }
                              style={{
                                padding: "6px",
                                color:
                                  user.status === "active"
                                    ? "#22c55e"
                                    : "var(--color-text-muted)",
                                  opacity:
                                    actionLoading === `user-status:${user.uid}`
                                      ? 0.5
                                      : 1,
                                width: "30px",
                                height: "30px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              {user.status === "active" ? (
                                <ToggleRight size={18} />
                              ) : (
                                <ToggleLeft size={18} />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() =>
                              setResetPasswordModal({
                                isOpen: true,
                                uid: user.uid,
                                username: user.username,
                              })
                            }
                            className="btn-ghost"
                            title={t("admin.reset_password")}
                            style={{
                              padding: "6px",
                              color: "#f59e0b",
                              width: "30px",
                              height: "30px",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <KeyRound size={16} />
                          </button>
                          {!isProtectedAdmin(user) && (
                            <button
                              onClick={() =>
                                handleDeleteUser(user.uid, user.username)
                              }
                              disabled={actionLoading === `user-delete:${user.uid}`}
                              className="btn-ghost"
                              title={t("admin.delete_user")}
                              style={{
                                padding: "6px",
                                color: "#ef4444",
                                opacity:
                                  actionLoading === `user-delete:${user.uid}`
                                    ? 0.5
                                    : 1,
                                width: "30px",
                                height: "30px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Devices Table */
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                    background: "var(--color-surface-elevated)",
                  }}
                >
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                    }}
                  >
                    {renderDeviceHeader("id", t("admin.col_device_id"))}
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                    }}
                  >
                    {renderDeviceHeader("device_name", t("admin.col_device_name"))}
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                    }}
                  >
                    {renderDeviceHeader("username", t("admin.col_owner"))}
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                    }}
                  >
                    {renderDeviceHeader("device_type", t("admin.col_device_type"))}
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px 16px",
                    }}
                  >
                    {renderDeviceHeader("last_seen_at", t("admin.col_last_seen"))}
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "12px 16px",
                      fontWeight: 600,
                      color: "var(--color-text-dim)",
                      fontSize: "12px",
                    }}
                  >
                    {t("admin.col_actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedDevices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        textAlign: "center",
                        padding: "40px 20px",
                        color: "var(--color-text-dim)",
                        fontStyle: "italic",
                      }}
                    >
                      {t("admin.no_devices")}
                    </td>
                  </tr>
                ) : (
                  sortedDevices.map((device) => (
                    <tr
                      key={device.id}
                      style={{
                        borderBottom: "1px solid var(--color-border)",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          "var(--color-surface-elevated)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >
                      <td style={{ padding: "12px 16px", fontFamily: "monospace" }}>
                        {device.id}
                      </td>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                        {device.device_name}
                      </td>
                      <td style={{ padding: "12px 16px" }}>{device.username}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            padding: "4px 8px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 700,
                            background: "rgba(99, 102, 241, 0.15)",
                            color: "var(--color-primary)",
                            border: "1px solid rgba(99, 102, 241, 0.3)",
                          }}
                        >
                          {device.device_type}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          color: "var(--color-text-dim)",
                          fontSize: "12px",
                        }}
                      >
                        {device.last_seen_at || "N/A"}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        {device.id !== currentRemoteDeviceId && (
                          <button
                            onClick={() =>
                              handleKickDevice(device.id, device.device_name)
                            }
                            disabled={actionLoading === `device-kick:${device.id}`}
                            className="btn-ghost"
                            title={t("admin.kick_device")}
                            style={{
                              padding: "6px",
                              color: "#ef4444",
                              opacity:
                                actionLoading === `device-kick:${device.id}`
                                  ? 0.5
                                  : 1,
                              width: "30px",
                              height: "30px",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <LogOut size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reset Password Modal */}
      {resetPasswordModal.isOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={() =>
            setResetPasswordModal({ isOpen: false, uid: 0, username: "" })
          }
        >
          <div
            className="glass-panel"
            style={{
              padding: "24px",
              borderRadius: "var(--radius-lg)",
              width: "400px",
              maxWidth: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: "0 0 16px",
                fontSize: "16px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <KeyRound size={18} color="#f59e0b" />
              {t("admin.reset_password")}
            </h3>
            <p
              style={{
                fontSize: "13px",
                color: "var(--color-text-dim)",
                marginBottom: "16px",
                lineHeight: 1.5,
              }}
            >
              {t("admin.reset_password_warning", {
                username: resetPasswordModal.username,
              })}
            </p>

            {/* Warning Banner */}
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "var(--radius-md)",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                marginBottom: "16px",
                display: "flex",
                gap: "10px",
                alignItems: "flex-start",
              }}
            >
              <AlertTriangle
                size={16}
                color="#ef4444"
                style={{ marginTop: "2px", flexShrink: 0 }}
              />
              <p
                style={{
                  margin: 0,
                  fontSize: "12px",
                  color: "#ef4444",
                  lineHeight: 1.5,
                }}
              >
                {t("admin.e2ee_warning")}
              </p>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label
                style={{
                  fontSize: "12px",
                  color: "var(--color-text-dim)",
                  marginBottom: "6px",
                  display: "block",
                }}
              >
                {t("admin.new_password")}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("admin.new_password_placeholder")}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface-elevated)",
                  color: "var(--color-text-main)",
                  fontSize: "13px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  fontSize: "12px",
                  color: "var(--color-text-dim)",
                  marginBottom: "6px",
                  display: "block",
                }}
              >
                {t("admin.new_password_hint")}
              </label>
              <input
                type="text"
                value={newPasswordHint}
                onChange={(e) => setNewPasswordHint(e.target.value)}
                placeholder={t("admin.new_password_hint_placeholder")}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface-elevated)",
                  color: "var(--color-text-main)",
                  fontSize: "13px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}
            >
              <button
                className="btn-ghost"
                onClick={() =>
                  setResetPasswordModal({
                    isOpen: false,
                    uid: 0,
                    username: "",
                  })
                }
                style={{
                  padding: "10px 20px",
                  fontSize: "13px",
                  borderRadius: "var(--radius-md)",
                }}
              >
                {t("admin.cancel")}
              </button>
              <button
                onClick={handleResetPassword}
                disabled={
                  !newPassword ||
                  newPassword.length < 8 ||
                    actionLoading === `user-reset:${resetPasswordModal.uid}`
                }
                style={{
                  padding: "10px 20px",
                  fontSize: "13px",
                  borderRadius: "var(--radius-md)",
                  background: "#ef4444",
                  color: "#fff",
                  border: "none",
                  cursor:
                    newPassword && newPassword.length >= 8
                      ? "pointer"
                      : "not-allowed",
                  opacity:
                    newPassword && newPassword.length >= 8 ? 1 : 0.5,
                }}
              >
                {t("admin.confirm_reset")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAction.isOpen && (
        <div
          onClick={() =>
            setConfirmAction({ isOpen: false, kind: null, id: 0, label: "" })
          }
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(420px, calc(100vw - 32px))",
              background: "var(--color-surface)",
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--color-border)",
              boxShadow: "var(--shadow-lg)",
              padding: "22px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginBottom: "10px",
              }}
            >
              <div
                style={{
                  width: "42px",
                  height: "42px",
                  borderRadius: "999px",
                  background: "rgba(239,68,68,0.12)",
                  color: "#ef4444",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={22} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "var(--color-text-main)",
                  }}
                >
                  {confirmAction.kind === "kick-device"
                    ? t("admin.kick_device")
                    : t("admin.delete_user")}
                </div>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    fontSize: "13px",
                    color: "var(--color-text-muted)",
                    lineHeight: 1.5,
                  }}
                >
                  {confirmAction.kind === "kick-device"
                    ? t("admin.confirm_kick_device", {
                        deviceName: confirmAction.label,
                      }) ||
                      `Are you sure you want to kick device "${confirmAction.label}"?`
                    : t("admin.confirm_delete_user", {
                        username: confirmAction.label,
                      }) ||
                      `Are you sure you want to delete user "${confirmAction.label}"? This action cannot be undone.`}
                </p>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                marginTop: "20px",
              }}
            >
              <button
                className="btn-ghost"
                onClick={() =>
                  setConfirmAction({
                    isOpen: false,
                    kind: null,
                    id: 0,
                    label: "",
                  })
                }
                style={{
                  padding: "8px 16px",
                  fontSize: "14px",
                  borderRadius: "var(--radius-md)",
                }}
              >
                取消
              </button>
              <button
                className="btn-primary"
                onClick={handleConfirmAction}
                style={{
                  padding: "8px 18px",
                  fontSize: "14px",
                  borderRadius: "var(--radius-md)",
                  background: "#ef4444",
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
