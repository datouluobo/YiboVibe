type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function withCode(t: TranslateFn, message: string, code: string) {
    return t("errors.with_code", { message, code });
}

function normalizePrefix(raw: string, pattern: RegExp) {
    return raw.replace(pattern, "").trim();
}

export function resolveAuthError(rawError: string, isRegistering: boolean, t: TranslateFn) {
    const trimmed = rawError.trim();
    const lower = trimmed.toLowerCase();

    if (isRegistering) {
        if (lower.includes("password") && (lower.includes("at least 8") || lower.includes("min"))) {
            return withCode(t, t("login.error_register_password_too_short"), "AUTH_REGISTER_PASSWORD_TOO_SHORT");
        }
        if (lower.includes("username") && lower.includes("at least 3")) {
            return withCode(t, t("login.error_register_username_too_short"), "AUTH_REGISTER_USERNAME_TOO_SHORT");
        }
        if (lower.includes("user already exists") || lower.includes("already exists") || lower.includes("409")) {
            return withCode(t, t("login.error_register_user_exists"), "AUTH_USER_EXISTS");
        }
        if (lower.includes("invalid request payload")) {
            return withCode(t, t("login.error_register_invalid_payload"), "AUTH_INVALID_REQUEST");
        }
        if (lower.startsWith("registration api error:") || lower.startsWith("server returned:")) {
            return resolveAuthError(
                normalizePrefix(normalizePrefix(trimmed, /^Registration API error:\s*/i), /^Server returned:\s*/i),
                true,
                t,
            );
        }
    } else {
        if (
            lower.includes("用户名或密码错误")
            || lower.includes("wrong password")
            || lower.includes("invalid credentials")
            || lower.includes("unauthorized")
        ) {
            return withCode(t, t("login.error_login_invalid_credentials"), "AUTH_INVALID_CREDENTIALS");
        }
        if (lower.startsWith("auth failed:")) {
            return resolveAuthError(normalizePrefix(trimmed, /^Auth Failed:\s*/i), false, t);
        }
        if (lower.startsWith("network error:")) {
            const normalized = normalizePrefix(trimmed, /^Network Error:\s*/i);
            if (
                normalized.toLowerCase().includes("用户名或密码错误")
                || normalized.toLowerCase().includes("wrong password")
                || normalized.toLowerCase().includes("invalid credentials")
            ) {
                return withCode(t, t("login.error_login_invalid_credentials"), "AUTH_INVALID_CREDENTIALS");
            }
            return withCode(t, t("login.error_network_with_detail", { detail: normalized }), "AUTH_NETWORK_ERROR");
        }
        if (lower.startsWith("could not connect to nas:")) {
            return withCode(t, t("login.error_server_unreachable"), "AUTH_SERVER_UNREACHABLE");
        }
        if (lower.startsWith("login failed via api:")) {
            return resolveAuthError(normalizePrefix(trimmed, /^Login failed via API:\s*/i), false, t);
        }
    }

    return withCode(t, t("login.error_unknown_with_detail", { detail: trimmed }), isRegistering ? "AUTH_REGISTER_UNKNOWN" : "AUTH_UNKNOWN");
}

export function resolveSyncError(rawError: string, t: TranslateFn) {
    const trimmed = rawError.trim();
    const lower = trimmed.toLowerCase();

    if (lower === "master_pwd_unsaved") {
        return {
            code: "SYNC_AUTH_REQUIRED",
            detail: t("flowdeck.detail_auth_required"),
            tone: "warn" as const,
        };
    }

    if (
        lower.includes("timeout")
        || lower.includes("timed out")
        || lower.includes("failed to fetch")
        || lower.includes("dns")
        || lower.includes("connection refused")
        || lower.includes("network")
        || lower.includes("socket")
        || lower.includes("could not connect")
    ) {
        return {
            code: "SYNC_SERVER_UNREACHABLE",
            detail: withCode(t, t("flowdeck.detail_server_unreachable"), "SYNC_SERVER_UNREACHABLE"),
            tone: "error" as const,
        };
    }

    if (
        lower.includes("用户名或密码错误")
        || lower.includes("wrong password")
        || lower.includes("invalid credentials")
        || lower.includes("unauthorized")
    ) {
        return {
            code: "SYNC_AUTH_INVALID_CREDENTIALS",
            detail: withCode(t, t("flowdeck.detail_auth_invalid_credentials"), "SYNC_AUTH_INVALID_CREDENTIALS"),
            tone: "warn" as const,
        };
    }

    return {
        code: "SYNC_API_ERROR",
        detail: withCode(t, t("flowdeck.detail_api_error"), "SYNC_API_ERROR"),
        tone: "warn" as const,
    };
}

export function formatOperationError(
    t: TranslateFn,
    code: string,
    messageKey: string,
    options?: Record<string, unknown>,
) {
    return withCode(t, t(messageKey, options), code);
}
