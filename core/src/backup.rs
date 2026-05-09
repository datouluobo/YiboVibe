use crate::config::AppConfig;
use crate::sync::crypto::{decrypt_payload, encrypt_payload};
use log::info;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use walkdir::WalkDir;
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

const PROBE_SECRETS_BACKUP_NAME: &str = "probe_secrets.enc";
const PROBE_SECRETS_AAD: &[u8] = b"flowprobe-secrets-backup";

#[derive(Serialize, Deserialize)]
pub struct BackupManifest {
    pub version: String,
    pub timestamp: String,
    pub components: Vec<String>,
}

pub fn get_data_dir() -> PathBuf {
    crate::local_auth::get_active_user_dir()
}

fn probe_secrets_path() -> PathBuf {
    let mut path = AppConfig::config_path();
    path.set_file_name("probe_secrets.json");
    path
}

fn derive_probe_backup_key(config: &AppConfig) -> Result<[u8; 32], String> {
    if config.local_password_hash.trim().is_empty() || config.local_kdf_salt.trim().is_empty() {
        return Err(
            "FlowProbe key backup requires an initialized local password and KDF salt."
                .to_string(),
        );
    }

    let mut digest = Sha256::new();
    digest.update(config.local_password_hash.as_bytes());
    digest.update(b"|flowprobe-backup|");
    digest.update(config.local_kdf_salt.as_bytes());
    Ok(digest.finalize().into())
}

pub fn export_config(dest_path: &str) -> Result<(), String> {
    let file =
        File::create(dest_path).map_err(|e| format!("Failed to create backup file: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let data_dir = get_data_dir();
    let config_path = data_dir.join("config.json");
    let config_content = if config_path.exists() {
        fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config.json for backup: {}", e))?
    } else {
        serde_json::to_string_pretty(&AppConfig::default())
            .map_err(|e| format!("Failed to serialize fallback config: {}", e))?
    };
    let backup_config: AppConfig = serde_json::from_str(&config_content)
        .map_err(|e| format!("Failed to parse config.json for backup: {}", e))?;

    let mut manifest_components = vec![
        "config.json".to_string(),
        "rules.json".to_string(),
        "dictionaries".to_string(),
    ];

    if backup_config.flowprobe_backup_keys && probe_secrets_path().exists() {
        manifest_components.push(PROBE_SECRETS_BACKUP_NAME.to_string());
    }

    let manifest = BackupManifest {
        version: "v1.1".to_string(),
        timestamp: chrono::Local::now().to_rfc3339(),
        components: manifest_components,
    };
    let manifest_json = serde_json::to_string_pretty(&manifest).unwrap();
    zip.start_file("manifest.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| e.to_string())?;

    zip.start_file("config.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(config_content.as_bytes())
        .map_err(|e| e.to_string())?;

    let rules_path = data_dir.join("rules.json");
    if rules_path.exists() && let Ok(content) = fs::read_to_string(&rules_path) {
        zip.start_file("rules.json", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let dict_dir = data_dir.join("dictionaries");
    if dict_dir.exists() {
        zip.add_directory("dictionaries/", options)
            .map_err(|e| e.to_string())?;
        for entry in WalkDir::new(&dict_dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                let name = path
                    .strip_prefix(&data_dir)
                    .unwrap_or(path)
                    .to_string_lossy();
                zip.start_file(name.replace("\\", "/"), options)
                    .map_err(|e| e.to_string())?;
                if let Ok(mut f) = File::open(path) {
                    let mut buffer = Vec::new();
                    f.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
                    zip.write_all(&buffer).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    if backup_config.flowprobe_backup_keys {
        let secrets_path = probe_secrets_path();
        if secrets_path.exists() {
            let key = derive_probe_backup_key(&backup_config)?;
            let secrets_bytes = fs::read(&secrets_path)
                .map_err(|e| format!("Failed to read FlowProbe secrets: {}", e))?;
            let encrypted = encrypt_payload(&secrets_bytes, &key, PROBE_SECRETS_AAD)?;
            zip.start_file(PROBE_SECRETS_BACKUP_NAME, options)
                .map_err(|e| e.to_string())?;
            zip.write_all(&encrypted).map_err(|e| e.to_string())?;
        }
    }

    zip.finish()
        .map_err(|e| format!("Failed to finish zip: {}", e))?;
    info!("Configuration exported successfully to: {}", dest_path);
    Ok(())
}

pub fn import_config(src_path: &str) -> Result<(), String> {
    let file = File::open(src_path).map_err(|e| format!("Failed to open backup file: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Failed to read zip: {}", e))?;

    let data_dir = get_data_dir();

    if let Ok(mut manifest_file) = archive.by_name("manifest.json") {
        let mut content = String::new();
        if manifest_file.read_to_string(&mut content).is_ok()
            && let Ok(manifest) = serde_json::from_str::<BackupManifest>(&content)
        {
            info!(
                "Importing backup from {}, version: {}",
                manifest.timestamp, manifest.version
            );
        }
    } else {
        return Err("Invalid backup: Missing manifest.json".to_string());
    }

    let mut encrypted_probe_secrets: Option<Vec<u8>> = None;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).unwrap();
        let file_name = file.name().to_string();
        if file_name == PROBE_SECRETS_BACKUP_NAME {
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .map_err(|e| format!("Failed to read encrypted FlowProbe secrets: {}", e))?;
            encrypted_probe_secrets = Some(buffer);
            continue;
        }

        let outpath = match file.enclosed_name() {
            Some(path) => data_dir.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).unwrap_or(());
        } else {
            if let Some(parent) = outpath.parent() && !parent.exists() {
                fs::create_dir_all(parent).unwrap_or(());
            }
            if let Ok(mut outfile) = File::create(&outpath) {
                std::io::copy(&mut file, &mut outfile).unwrap_or(0);
            }
        }
    }

    if let Some(encrypted) = encrypted_probe_secrets {
        let config_content = fs::read_to_string(data_dir.join("config.json"))
            .map_err(|e| format!("Failed to read imported config.json: {}", e))?;
        let imported_config: AppConfig = serde_json::from_str(&config_content)
            .map_err(|e| format!("Failed to parse imported config.json: {}", e))?;
        let key = derive_probe_backup_key(&imported_config)?;
        let decrypted = decrypt_payload(&encrypted, &key, PROBE_SECRETS_AAD)?;
        fs::write(probe_secrets_path(), decrypted)
            .map_err(|e| format!("Failed to restore FlowProbe secrets: {}", e))?;
    }

    crate::config::reload();
    crate::rules::reload();
    crate::dictionary::reload();

    info!("Configuration imported successfully from: {}", src_path);
    Ok(())
}
