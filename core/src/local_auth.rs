use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use lazy_static::lazy_static;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalUser {
    pub username: String,
    pub password_hash: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct UsersConfig {
    pub users: HashMap<String, LocalUser>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SessionConfig {
    pub last_username: Option<String>,
}

lazy_static! {
    pub static ref ACTIVE_USER: RwLock<Option<String>> = RwLock::new(None);
}

/// Helper to get the base `%APPDATA%/YiboFlow` global dir
pub fn get_yiboflow_global_dir() -> PathBuf {
    if let Ok(val) = std::env::var("YIBOFLOW_DATA_DIR") {
        let path = PathBuf::from(val);
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }
        return path;
    }
    
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("./"));
    path.push("YiboFlow");
    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }
    path
}

/// Helper to get the current `%APPDATA%/YiboFlow/users/<username>` active dir
pub fn get_active_user_dir() -> PathBuf {
    let base = get_yiboflow_global_dir();
    let user_lock = ACTIVE_USER.read().unwrap();
    if let Some(ref username) = *user_lock {
        let mut path = base;
        path.push("users");
        let safe_name = username.replace(|c: char| !c.is_alphanumeric(), "_");
        path.push(safe_name);
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }
        return path;
    }
    
    // Fallback: Default to "users/default" if no user is authenticated
    let mut path = base;
    path.push("users");
    path.push("default");
    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }
    path
}

pub fn load_session() {
    let mut path = get_yiboflow_global_dir();
    path.push("last_session.json");
    if path.exists()
        && let Ok(content) = fs::read_to_string(&path)
            && let Ok(config) = serde_json::from_str::<SessionConfig>(&content)
                && let Some(u) = config.last_username {
                    info!("[Session] Loaded last session user: {}", u);
                    *ACTIVE_USER.write().unwrap() = Some(u);
                }
}

pub fn save_session(username: String) {
    info!("[Session] Setting active user: {}", username);
    *ACTIVE_USER.write().unwrap() = Some(username.clone());
    
    let mut path = get_yiboflow_global_dir();
    path.push("last_session.json");
    let config = SessionConfig { last_username: Some(username) };
    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = fs::write(path, json);
    }

    // Call reloads here to hot-switch the active context
    crate::config::reload();
    crate::dictionary::reload();
    crate::rules::reload();
}

pub fn get_users_config_path() -> PathBuf {
    let mut path = get_yiboflow_global_dir();
    path.push("users.json");
    path
}

pub fn load_users_config() -> UsersConfig {
    let path = get_users_config_path();
    if path.exists()
        && let Ok(content) = fs::read_to_string(&path)
            && let Ok(cfg) = serde_json::from_str::<UsersConfig>(&content) {
                return cfg;
            }
    UsersConfig::default()
}

pub fn save_users_config(cfg: &UsersConfig) {
    let path = get_users_config_path();
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(path, json);
    }
}

pub fn register_local_user(username: &str, password: &str) -> Result<bool, String> {
    let mut cfg = load_users_config();
    if cfg.users.contains_key(username) {
        return Err("Account already exists locally".to_string());
    }

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string();

    let new_user = LocalUser {
        username: username.to_string(),
        password_hash,
    };

    cfg.users.insert(username.to_string(), new_user);
    save_users_config(&cfg);
    
    // Automatically set as active
    save_session(username.to_string());
    Ok(true)
}

pub fn login_local_user(username: &str, password: &str) -> Result<bool, String> {
    let cfg = load_users_config();
    if let Some(user) = cfg.users.get(username) {
        let parsed_hash = PasswordHash::new(&user.password_hash).map_err(|e| e.to_string())?;
        if Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_ok() {
            save_session(username.to_string());
            return Ok(true);
        } else {
            return Err("Invalid credentials".to_string());
        }
    }
    Err("User not found locally".to_string())
}

pub fn rename_local_user(old_username: &str, new_username: &str) -> Result<bool, String> {
    let mut cfg = load_users_config();
    if !cfg.users.contains_key(old_username) {
        return Err("Old account not found locally".to_string());
    }
    if cfg.users.contains_key(new_username) {
        return Err("New username already exists locally".to_string());
    }

    // Rename the directory
    let base = get_yiboflow_global_dir();
    let old_safe_name = old_username.replace(|c: char| !c.is_alphanumeric(), "_");
    let new_safe_name = new_username.replace(|c: char| !c.is_alphanumeric(), "_");
    
    let mut old_path = base.clone();
    old_path.push("users");
    old_path.push(&old_safe_name);

    let mut new_path = base.clone();
    new_path.push("users");
    new_path.push(&new_safe_name);

    if old_path.exists()
        && let Err(e) = fs::rename(&old_path, &new_path) {
            return Err(format!("Failed to rename user directory: {}", e));
        }

    // Update users.json
    let mut user = cfg.users.remove(old_username).unwrap();
    user.username = new_username.to_string();
    cfg.users.insert(new_username.to_string(), user);
    save_users_config(&cfg);

    // If it was the active session, update it
    let active_user = ACTIVE_USER.read().unwrap().clone();
    if let Some(active) = active_user
        && active == old_username {
            save_session(new_username.to_string());
        }

    Ok(true)
}
