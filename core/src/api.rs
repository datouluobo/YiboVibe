use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub kdf_salt: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub password_hint: String,
}

#[derive(Serialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
    pub device_name: String,
    pub device_type: String,
    pub device_fingerprint: String,
}

#[derive(Deserialize, Debug)]
pub struct AuthResponseData {
    pub uid: u32,
    #[serde(default)]
    pub device_id: u32,
    pub username: String,
    pub kdf_salt: String,
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Deserialize, Debug, Clone, Default)]
pub struct LoginFailData {
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub password_hint: String,
}

#[derive(Deserialize, Debug)]
pub struct DeviceInfo {
    pub id: u32,
    pub name: String,
    pub r#type: String,
    pub is_online: bool,
    pub last_seen_at: String,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct AdminUserInfo {
    pub uid: u32,
    pub username: String,
    pub role: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct AdminDeviceInfo {
    pub id: u32,
    pub uid: u32,
    pub username: String,
    pub device_name: String,
    pub device_type: String,
    pub last_seen_at: String,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct FlowSyncStagingPolicy {
    pub id: u32,
    pub staging_enabled: bool,
    pub default_ttl_seconds: i32,
    pub max_ttl_seconds: i32,
    pub max_object_size_bytes: i64,
    pub user_quota_bytes: i64,
    pub external_links_enabled: bool,
    pub external_link_max_ttl_seconds: i32,
    pub gc_interval_seconds: i32,
    pub last_gc_at: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct FlowSyncStagingPreference {
    pub default_ttl_seconds: i32,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct FlowSyncStagedObjectInfo {
    pub id: String,
    pub uid: u32,
    pub kind: String,
    pub root_hash: String,
    pub title: String,
    pub manifest_json: String,
    pub size_bytes: i64,
    pub chunk_count: i32,
    pub ttl_seconds: i32,
    pub status: String,
    pub storage_path: String,
    pub expires_at: String,
    pub completed_at: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct FlowSyncShareLinkInfo {
    pub id: u32,
    pub uid: u32,
    pub stage_object_id: String,
    pub token_preview: String,
    pub status: String,
    #[serde(default)]
    pub ttl_seconds: i32,
    #[serde(default)]
    pub max_downloads: i32,
    #[serde(default)]
    pub download_count: i32,
    pub last_downloaded_at: Option<String>,
    pub disabled_at: Option<String>,
    pub expires_at: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub share_url: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct FlowSyncCreateStageRequest {
    pub kind: String,
    pub root_hash: String,
    pub title: String,
    pub manifest_json: String,
    pub size_bytes: i64,
    pub chunk_count: i32,
    pub ttl_seconds: i32,
}

#[derive(Serialize, Debug, Clone)]
pub struct FlowSyncCreateShareLinkRequest {
    pub stage_object_id: String,
    pub ttl_seconds: i32,
    pub max_downloads: i32,
}

#[derive(Deserialize, Debug)]
pub struct GeneralResponse<T> {
    pub code: u32,
    pub msg: String,
    pub data: Option<T>,
}

pub struct ApiClient {
    base_url: String,
    client: Client,
    pub access_token: Option<String>,
}

impl ApiClient {
    pub fn new(mut base_url: String) -> Self {
        use std::time::Duration;

        // Remove trailing slashes and version prefixes if accidentally added by user
        while base_url.ends_with('/') {
            base_url.pop();
        }
        if base_url.ends_with("/api/v1") {
            base_url = base_url.trim_end_matches("/api/v1").to_string();
        }
        while base_url.ends_with('/') {
            base_url.pop();
        }

        Self {
            base_url,
            client: Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap_or_else(|_| Client::new()),
            access_token: None,
        }
    }

    pub async fn register(
        &self,
        pr: RegisterRequest,
    ) -> Result<GeneralResponse<serde_json::Value>, String> {
        let url = format!("{}/api/v1/user/register", self.base_url);
        let res = self
            .client
            .post(&url)
            .json(&pr)
            .send()
            .await
            .map_err(|e| format!("Registration request failed: {}", e))?;

        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<serde_json::Value> =
            serde_json::from_str(&body).map_err(|e| {
                format!(
                    "Registration JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        Ok(result)
    }

    pub async fn login(
        &mut self,
        pr: LoginRequest,
    ) -> Result<GeneralResponse<serde_json::Value>, String> {
        let url = format!("{}/api/v1/user/login", self.base_url);
        let res = self
            .client
            .post(&url)
            .json(&pr)
            .send()
            .await
            .map_err(|e| format!("Login failed (URL: {}): {}", url, e))?;

        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Login body read failed (URL: {}): {}", url, e))?;

        let result: GeneralResponse<serde_json::Value> =
            serde_json::from_str(&body).map_err(|e| {
                format!(
                    "Login JSON decode error (URL: {}): {} | Status: {} | Raw: {}",
                    url, e, status, body
                )
            })?;

        if result.code == 200 {
            if let Some(ref data) = result.data {
                if let Some(token) = data.get("access_token").and_then(|v| v.as_str()) {
                    self.access_token = Some(token.to_string());
                }
            }
        }

        Ok(result)
    }

    pub async fn get_online_devices(&self) -> Result<GeneralResponse<serde_json::Value>, String> {
        let url = format!("{}/api/v1/sync/online", self.base_url);
        let mut req = self.client.get(&url);

        if let Some(ref tk) = self.access_token {
            req = req.header("Authorization", format!("Bearer {}", tk));
        }

        let res = req
            .send()
            .await
            .map_err(|e| format!("Online devices request failed (URL: {}): {}", url, e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body (URL: {}): {}", url, e))?;
        let result = serde_json::from_str(&body).map_err(|e| {
            format!(
                "Online devices JSON decode error (URL: {}): {} | Status: {} | Raw: {}",
                url, e, status, body
            )
        })?;
        Ok(result)
    }

    pub async fn get_devices(&self, token: &str) -> Result<Vec<DeviceInfo>, String> {
        let url = format!("{}/api/v1/sync/devices", self.base_url);
        let res = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("List devices request failed (URL: {}): {}", url, e))?;

        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body (URL: {}): {}", url, e))?;
        let result: GeneralResponse<Vec<DeviceInfo>> =
            serde_json::from_str(&body).map_err(|e| {
                format!(
                    "List devices JSON decode error (URL: {}): {} | Status: {} | Raw: {}",
                    url, e, status, body
                )
            })?;
        Ok(result.data.unwrap_or_default())
    }

    /// Download a raw encrypted vault file (like manifest.enc)
    pub async fn download_vault_file(&self, filename: &str) -> Result<Vec<u8>, String> {
        let url = format!("{}/api/v1/vault/{}", self.base_url, filename);
        let mut req = self.client.get(&url);
        if let Some(ref tk) = self.access_token {
            req = req.header("Authorization", format!("Bearer {}", tk));
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        if res.status().is_success() {
            let bytes = res.bytes().await.map_err(|e| e.to_string())?;
            Ok(bytes.to_vec())
        } else if res.status() == reqwest::StatusCode::NOT_FOUND {
            // Treat 404 as returning an empty object to initialize
            Err("NOT_FOUND".to_string())
        } else {
            Err(format!("Server returned {}", res.status()))
        }
    }

    /// Upload a raw encrypted vault file (like config.enc or a delta slice)
    pub async fn upload_vault_file(&self, filename: &str, payload: Vec<u8>) -> Result<(), String> {
        let url = format!("{}/api/v1/vault/{}", self.base_url, filename);
        let mut req = self.client.put(&url).body(payload);
        if let Some(ref tk) = self.access_token {
            req = req.header("Authorization", format!("Bearer {}", tk));
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        if res.status().is_success() {
            Ok(())
        } else {
            Err(format!("Upload failed: Server returned {}", res.status()))
        }
    }

    // ── Admin API Methods ──

    pub async fn admin_list_users(&self, token: &str) -> Result<Vec<AdminUserInfo>, String> {
        let url = format!("{}/api/v1/admin/users", self.base_url);
        let res = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Admin list users failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<Vec<AdminUserInfo>> =
            serde_json::from_str(&body).map_err(|e| {
                format!(
                    "Admin users JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        Ok(result.data.unwrap_or_default())
    }

    pub async fn admin_update_user_status(
        &self,
        token: &str,
        uid: u32,
        status: &str,
    ) -> Result<(), String> {
        let url = format!("{}/api/v1/admin/users/{}/status", self.base_url, uid);
        let res = self
            .client
            .put(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({"status": status}))
            .send()
            .await
            .map_err(|e| format!("Admin update status failed: {}", e))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("Server returned error: {}", body))
        }
    }

    pub async fn admin_delete_user(&self, token: &str, uid: u32) -> Result<(), String> {
        let url = format!("{}/api/v1/admin/users/{}", self.base_url, uid);
        let res = self
            .client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Admin delete user failed: {}", e))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("Server returned error: {}", body))
        }
    }

    pub async fn admin_reset_password(
        &self,
        token: &str,
        uid: u32,
        new_password: &str,
        new_password_hint: &str,
    ) -> Result<(), String> {
        let url = format!(
            "{}/api/v1/admin/users/{}/reset-password",
            self.base_url, uid
        );
        let res = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({
                "new_password": new_password,
                "new_password_hint": new_password_hint,
            }))
            .send()
            .await
            .map_err(|e| format!("Admin reset password failed: {}", e))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("Server returned error: {}", body))
        }
    }

    pub async fn admin_list_devices(&self, token: &str) -> Result<Vec<AdminDeviceInfo>, String> {
        let url = format!("{}/api/v1/admin/devices", self.base_url);
        let res = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Admin list devices failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<Vec<AdminDeviceInfo>> =
            serde_json::from_str(&body).map_err(|e| {
                format!(
                    "Admin devices JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        Ok(result.data.unwrap_or_default())
    }

    pub async fn admin_kick_device(&self, token: &str, device_id: u32) -> Result<(), String> {
        let url = format!("{}/api/v1/admin/devices/{}", self.base_url, device_id);
        let res = self
            .client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Admin kick device failed: {}", e))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("Server returned error: {}", body))
        }
    }

    pub async fn admin_delete_user_vault(&self, token: &str, uid: u32) -> Result<(), String> {
        let url = format!("{}/api/v1/admin/users/{}/vault", self.base_url, uid);
        let res = self
            .client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Admin delete vault failed: {}", e))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("Server returned error: {}", body))
        }
    }

    pub async fn get_flowsync_staging_policy(
        &self,
        token: &str,
    ) -> Result<FlowSyncStagingPolicy, String> {
        let url = format!("{}/api/v1/admin/staging/policy", self.base_url);
        let res = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Get staging policy failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<FlowSyncStagingPolicy> =
            serde_json::from_str(&body).map_err(|e| {
                format!(
                    "Staging policy JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        result
            .data
            .ok_or_else(|| "Staging policy payload missing".to_string())
    }

    pub async fn update_flowsync_staging_policy(
        &self,
        token: &str,
        policy: &FlowSyncStagingPolicy,
    ) -> Result<FlowSyncStagingPolicy, String> {
        let url = format!("{}/api/v1/admin/staging/policy", self.base_url);
        let res = self
            .client
            .put(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(policy)
            .send()
            .await
            .map_err(|e| format!("Update staging policy failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<FlowSyncStagingPolicy> =
            serde_json::from_str(&body).map_err(|e| {
                format!(
                    "Update staging policy JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        result
            .data
            .ok_or_else(|| "Updated staging policy payload missing".to_string())
    }

    pub async fn get_flowsync_staging_preferences(
        &self,
        token: &str,
    ) -> Result<FlowSyncStagingPreference, String> {
        let url = format!("{}/api/v1/sync/staging/preferences", self.base_url);
        let res = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Get staging preferences failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<FlowSyncStagingPreference> = serde_json::from_str(&body)
            .map_err(|e| {
                format!(
                    "Staging preferences JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        result
            .data
            .ok_or_else(|| "Staging preferences payload missing".to_string())
    }

    pub async fn update_flowsync_staging_preferences(
        &self,
        token: &str,
        default_ttl_seconds: i32,
    ) -> Result<FlowSyncStagingPreference, String> {
        let url = format!("{}/api/v1/sync/staging/preferences", self.base_url);
        let res = self
            .client
            .put(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({ "default_ttl_seconds": default_ttl_seconds }))
            .send()
            .await
            .map_err(|e| format!("Update staging preferences failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<FlowSyncStagingPreference> = serde_json::from_str(&body)
            .map_err(|e| {
                format!(
                    "Update staging preferences JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        result
            .data
            .ok_or_else(|| "Updated staging preferences payload missing".to_string())
    }

    pub async fn create_flowsync_staged_object(
        &self,
        token: &str,
        request: &FlowSyncCreateStageRequest,
    ) -> Result<FlowSyncStagedObjectInfo, String> {
        let url = format!("{}/api/v1/sync/staging/objects", self.base_url);
        let res = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(request)
            .send()
            .await
            .map_err(|e| format!("Create staged object failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<FlowSyncStagedObjectInfo> = serde_json::from_str(&body)
            .map_err(|e| {
                format!(
                    "Create staged object JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        result
            .data
            .ok_or_else(|| "Create staged object payload missing".to_string())
    }

    pub async fn upload_flowsync_staged_chunk(
        &self,
        token: &str,
        stage_id: &str,
        chunk_index: i32,
        payload: Vec<u8>,
    ) -> Result<(), String> {
        let url = format!(
            "{}/api/v1/sync/staging/objects/{}/chunks?index={}",
            self.base_url, stage_id, chunk_index
        );
        let res = self
            .client
            .put(&url)
            .header("Authorization", format!("Bearer {}", token))
            .body(payload)
            .send()
            .await
            .map_err(|e| format!("Upload staged chunk failed: {}", e))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("Server returned error: {}", body))
        }
    }

    pub async fn complete_flowsync_staged_object(
        &self,
        token: &str,
        stage_id: &str,
    ) -> Result<FlowSyncStagedObjectInfo, String> {
        let url = format!(
            "{}/api/v1/sync/staging/objects/{}/complete",
            self.base_url, stage_id
        );
        let res = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Complete staged object failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<FlowSyncStagedObjectInfo> = serde_json::from_str(&body)
            .map_err(|e| {
                format!(
                    "Complete staged object JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        result
            .data
            .ok_or_else(|| "Completed staged object payload missing".to_string())
    }

    pub async fn lookup_flowsync_staged_object(
        &self,
        token: &str,
        kind: &str,
        root_hash: &str,
    ) -> Result<Option<FlowSyncStagedObjectInfo>, String> {
        let url = format!(
            "{}/api/v1/sync/staging/lookup?kind={}&root_hash={}",
            self.base_url, kind, root_hash
        );
        let res = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Lookup staged object failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<FlowSyncStagedObjectInfo> = serde_json::from_str(&body)
            .map_err(|e| {
                format!(
                    "Lookup staged object JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        Ok(result.data)
    }

    pub async fn list_flowsync_staged_objects(
        &self,
        token: &str,
    ) -> Result<Vec<FlowSyncStagedObjectInfo>, String> {
        let url = format!("{}/api/v1/sync/staging/objects", self.base_url);
        let res = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("List staged objects failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<Vec<FlowSyncStagedObjectInfo>> = serde_json::from_str(&body)
            .map_err(|e| {
                format!(
                    "List staged objects JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        Ok(result.data.unwrap_or_default())
    }

    pub async fn download_flowsync_staged_object(
        &self,
        token: &str,
        stage_id: &str,
    ) -> Result<Vec<u8>, String> {
        let url = format!(
            "{}/api/v1/sync/staging/objects/{}/content",
            self.base_url, stage_id
        );
        let res = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Download staged object failed: {}", e))?;
        if res.status().is_success() {
            let bytes = res
                .bytes()
                .await
                .map_err(|e| format!("Failed to read staged content: {}", e))?;
            Ok(bytes.to_vec())
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("Server returned error: {}", body))
        }
    }

    pub async fn delete_flowsync_staged_object(
        &self,
        token: &str,
        stage_id: &str,
    ) -> Result<(), String> {
        let url = format!("{}/api/v1/sync/staging/objects/{}", self.base_url, stage_id);
        let res = self
            .client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Delete staged object failed: {}", e))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(format!("Server returned error: {}", body))
        }
    }

    pub async fn list_flowsync_share_links(
        &self,
        token: &str,
    ) -> Result<Vec<FlowSyncShareLinkInfo>, String> {
        let url = format!("{}/api/v1/sync/share-links", self.base_url);
        let res = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("List share links failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<Vec<FlowSyncShareLinkInfo>> = serde_json::from_str(&body)
            .map_err(|e| {
                format!(
                    "List share links JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        Ok(result.data.unwrap_or_default())
    }

    pub async fn create_flowsync_share_link(
        &self,
        token: &str,
        request: &FlowSyncCreateShareLinkRequest,
    ) -> Result<FlowSyncShareLinkInfo, String> {
        let url = format!("{}/api/v1/sync/share-links", self.base_url);
        let res = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(request)
            .send()
            .await
            .map_err(|e| format!("Create share link failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<FlowSyncShareLinkInfo> =
            serde_json::from_str(&body).map_err(|e| {
                format!(
                    "Create share link JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        result
            .data
            .ok_or_else(|| "Create share link payload missing".to_string())
    }

    pub async fn disable_flowsync_share_link(
        &self,
        token: &str,
        share_link_id: u32,
    ) -> Result<FlowSyncShareLinkInfo, String> {
        let url = format!(
            "{}/api/v1/sync/share-links/{}/disable",
            self.base_url, share_link_id
        );
        let res = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| format!("Disable share link failed: {}", e))?;
        let status = res.status();
        let body = res
            .text()
            .await
            .map_err(|e| format!("Failed to read body: {}", e))?;
        let result: GeneralResponse<FlowSyncShareLinkInfo> =
            serde_json::from_str(&body).map_err(|e| {
                format!(
                    "Disable share link JSON decode error: {} | Status: {} | Raw: {}",
                    e, status, body
                )
            })?;
        if !status.is_success() || result.code != 200 {
            return Err(result.msg);
        }
        result
            .data
            .ok_or_else(|| "Disable share link payload missing".to_string())
    }
}
