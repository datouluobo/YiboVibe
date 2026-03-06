use log::info;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use walkdir::WalkDir;
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

#[derive(Serialize, Deserialize)]
pub struct BackupManifest {
    pub version: String,
    pub timestamp: String,
    pub components: Vec<String>,
}

pub fn get_data_dir() -> PathBuf {
    crate::local_auth::get_active_user_dir()
}

pub fn export_config(dest_path: &str) -> Result<(), String> {
    let file = File::create(dest_path).map_err(|e| format!("Failed to create backup file: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // 1. Write Manifest
    let manifest = BackupManifest {
        version: "v1.0".to_string(),
        timestamp: chrono::Local::now().to_rfc3339(),
        components: vec![
            "config.json".to_string(),
            "rules.json".to_string(),
            "dictionaries".to_string(),
        ],
    };
    let manifest_json = serde_json::to_string_pretty(&manifest).unwrap();
    zip.start_file("manifest.json", options).map_err(|e| e.to_string())?;
    zip.write_all(manifest_json.as_bytes()).map_err(|e| e.to_string())?;

    let data_dir = get_data_dir();

    // 2. Export config.json
    let config_path = data_dir.join("config.json");
    if config_path.exists()
        && let Ok(content) = fs::read_to_string(&config_path) {
            zip.start_file("config.json", options).map_err(|e| e.to_string())?;
            zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        }

    // 3. Export rules.json
    let rules_path = data_dir.join("rules.json");
    if rules_path.exists()
        && let Ok(content) = fs::read_to_string(&rules_path) {
            zip.start_file("rules.json", options).map_err(|e| e.to_string())?;
            zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        }

    // 4. Export dictionaries
    let dict_dir = data_dir.join("dictionaries");
    if dict_dir.exists() {
        zip.add_directory("dictionaries/", options).map_err(|e| e.to_string())?;
        for entry in WalkDir::new(&dict_dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                let name = path.strip_prefix(&data_dir).unwrap_or(path).to_string_lossy();
                zip.start_file(name.replace("\\", "/"), options).map_err(|e| e.to_string())?;
                if let Ok(mut f) = File::open(path) {
                    let mut buffer = Vec::new();
                    f.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
                    zip.write_all(&buffer).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    zip.finish().map_err(|e| format!("Failed to finish zip: {}", e))?;
    info!("Configuration exported successfully to: {}", dest_path);
    Ok(())
}

pub fn import_config(src_path: &str) -> Result<(), String> {
    let file = File::open(src_path).map_err(|e| format!("Failed to open backup file: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Failed to read zip: {}", e))?;

    let data_dir = get_data_dir();

    // Validate Manifest
    if let Ok(mut manifest_file) = archive.by_name("manifest.json") {
        let mut content = String::new();
        if manifest_file.read_to_string(&mut content).is_ok()
            && let Ok(manifest) = serde_json::from_str::<BackupManifest>(&content) {
                info!("Importing backup from {}, version: {}", manifest.timestamp, manifest.version);
            }
    } else {
        return Err("Invalid backup: Missing manifest.json".to_string());
    }

    // Extract files
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).unwrap();
        let outpath = match file.enclosed_name() {
            Some(path) => data_dir.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            // It's a directory
            fs::create_dir_all(&outpath).unwrap_or(());
        } else {
            if let Some(p) = outpath.parent()
                && !p.exists() {
                    fs::create_dir_all(p).unwrap_or(());
                }
            if let Ok(mut outfile) = File::create(&outpath) {
                std::io::copy(&mut file, &mut outfile).unwrap_or(0);
            }
        }
    }

    // Reload singletons by calling force reload
    crate::config::reload();
    crate::rules::reload();
    crate::dictionary::reload();

    info!("Configuration imported successfully from: {}", src_path);
    Ok(())
}
