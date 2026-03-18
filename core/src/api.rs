use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub kdf_salt: String,
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
    pub username: String,
    pub kdf_salt: String,
    pub access_token: String,
    pub refresh_token: String,
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
    pub fn new(base_url: String) -> Self {
        use std::time::Duration;
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
    ) -> Result<GeneralResponse<serde_json::Value>, reqwest::Error> {
        let url = format!("{}/api/v1/user/register", self.base_url);
        let res = self.client.post(&url).json(&pr).send().await?;
        let result: GeneralResponse<serde_json::Value> = res.json().await?;
        Ok(result)
    }

    pub async fn login(
        &mut self,
        pr: LoginRequest,
    ) -> Result<GeneralResponse<AuthResponseData>, reqwest::Error> {
        let url = format!("{}/api/v1/user/login", self.base_url);
        let res = self.client.post(&url).json(&pr).send().await?;
        let result: GeneralResponse<AuthResponseData> = res.json().await?;

        if result.code == 200
            && let Some(ref data) = result.data {
                self.access_token = Some(data.access_token.clone());
            }

        Ok(result)
    }

    pub async fn get_online_devices(
        &self,
    ) -> Result<GeneralResponse<serde_json::Value>, reqwest::Error> {
        let url = format!("{}/api/v1/sync/online", self.base_url);
        let mut req = self.client.get(&url);

        if let Some(ref tk) = self.access_token {
            req = req.header("Authorization", format!("Bearer {}", tk));
        }

        let res = req.send().await?;
        let result = res.json().await?;
        Ok(result)
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
}
