use crate::flow_store::{
    FLOW_STORE_MANAGER, FlowHistoryEntryRecord, build_bundle_manifest, compute_file_blake3,
};
use crate::ws::WsMessage;
use log::{error, info};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

const HANDSHAKE_ACK: &[u8; 2] = b"OK";
const TRANSFER_BUFFER_SIZE: usize = 64 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct P2POffer {
    pub token: String,
    pub ips: Vec<String>,
    pub port: u16,
    pub filename: String,
    pub file_size: u64,
    #[serde(default)]
    pub transfer_id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub root_hash: String,
    #[serde(default)]
    pub unpack_bundle: bool,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub source_device_name: Option<String>,
}

fn current_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn get_local_ips() -> Vec<String> {
    let mut ips = Vec::new();
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0")
        && socket.connect("8.8.8.8:80").is_ok()
        && let Ok(addr) = socket.local_addr()
    {
        ips.push(addr.ip().to_string());
    }
    ips.push("127.0.0.1".to_string());
    ips
}

fn sanitize_file_name(name: &str) -> String {
    let trimmed = name.trim();
    let sanitized: String = trimmed
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => ch,
        })
        .collect();
    if sanitized.is_empty() {
        "flowsync-transfer".to_string()
    } else {
        sanitized
    }
}

fn unique_destination_path(base_dir: &Path, preferred_name: &str) -> PathBuf {
    let preferred = sanitize_file_name(preferred_name);
    let candidate = base_dir.join(&preferred);
    if !candidate.exists() {
        return candidate;
    }

    let preferred_path = Path::new(&preferred);
    let stem = preferred_path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| preferred.clone());
    let ext = preferred_path
        .extension()
        .map(|value| value.to_string_lossy().to_string());
    for index in 2..1000 {
        let file_name = match &ext {
            Some(ext) if !ext.is_empty() => format!("{stem}-{index}.{ext}"),
            _ => format!("{stem}-{index}"),
        };
        let candidate = base_dir.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    base_dir.join(format!("{stem}-{}", Uuid::new_v4()))
}

pub fn package_bundle_archive(root: &Path, archive_path: &Path) -> Result<(), String> {
    if let Some(parent) = archive_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create transfer temp dir {}: {}",
                parent.display(),
                e
            )
        })?;
    }
    let file = File::create(archive_path).map_err(|e| {
        format!(
            "Failed to create bundle archive {}: {}",
            archive_path.display(),
            e
        )
    })?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for entry in WalkDir::new(root).min_depth(1).sort_by_file_name() {
        let entry =
            entry.map_err(|e| format!("Failed to walk bundle {}: {}", root.display(), e))?;
        let path = entry.path();
        let relative = path.strip_prefix(root).map_err(|e| {
            format!(
                "Failed to derive bundle relative path for {}: {}",
                path.display(),
                e
            )
        })?;
        let relative_name = relative.to_string_lossy().replace('\\', "/");
        if entry.file_type().is_dir() {
            zip.add_directory(format!("{relative_name}/"), options)
                .map_err(|e| format!("Failed to add bundle directory {}: {}", relative_name, e))?;
            continue;
        }
        zip.start_file(relative_name.clone(), options)
            .map_err(|e| format!("Failed to add bundle file {}: {}", relative_name, e))?;
        let mut source = File::open(path)
            .map_err(|e| format!("Failed to open bundle file {}: {}", path.display(), e))?;
        let mut buffer = Vec::new();
        source
            .read_to_end(&mut buffer)
            .map_err(|e| format!("Failed to read bundle file {}: {}", path.display(), e))?;
        zip.write_all(&buffer).map_err(|e| {
            format!(
                "Failed to write bundle file {} to archive: {}",
                path.display(),
                e
            )
        })?;
    }

    zip.finish().map_err(|e| {
        format!(
            "Failed to finish bundle archive {}: {}",
            archive_path.display(),
            e
        )
    })?;
    Ok(())
}

pub fn extract_bundle_archive(archive_path: &Path, extract_dir: &Path) -> Result<(), String> {
    if extract_dir.exists() {
        fs::remove_dir_all(extract_dir).map_err(|e| {
            format!(
                "Failed to clean existing extraction dir {}: {}",
                extract_dir.display(),
                e
            )
        })?;
    }
    fs::create_dir_all(extract_dir).map_err(|e| {
        format!(
            "Failed to create extraction dir {}: {}",
            extract_dir.display(),
            e
        )
    })?;
    let file = File::open(archive_path).map_err(|e| {
        format!(
            "Failed to open bundle archive {}: {}",
            archive_path.display(),
            e
        )
    })?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read bundle zip archive: {}", e))?;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| format!("Failed to read bundle zip entry {}: {}", index, e))?;
        let outpath = extract_dir.join(
            file.enclosed_name()
                .ok_or_else(|| "Bundle zip contains unsafe path".to_string())?,
        );
        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| {
                format!(
                    "Failed to create bundle directory {}: {}",
                    outpath.display(),
                    e
                )
            })?;
            continue;
        }
        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!("Failed to create bundle parent {}: {}", parent.display(), e)
            })?;
        }
        let mut outfile = File::create(&outpath).map_err(|e| {
            format!(
                "Failed to create extracted file {}: {}",
                outpath.display(),
                e
            )
        })?;
        std::io::copy(&mut file, &mut outfile)
            .map_err(|e| format!("Failed to extract file {}: {}", outpath.display(), e))?;
    }
    Ok(())
}

async fn emit_transfer_progress(
    tx: &mpsc::Sender<WsMessage>,
    target_device: u32,
    transfer_id: &str,
    bytes_done: i64,
    bytes_total: i64,
) {
    let _ = tx
        .send(WsMessage {
            sender_uid: 0,
            sender_device_id: 0,
            target_devices: if target_device > 0 {
                vec![target_device]
            } else {
                vec![]
            },
            r#type: "flow_transfer_progress".to_string(),
            payload: serde_json::json!({
                "transfer_id": transfer_id,
                "bytes_done": bytes_done,
                "bytes_total": bytes_total,
                "status": "transferring",
            }),
        })
        .await;
}

async fn emit_transfer_completed(
    tx: &mpsc::Sender<WsMessage>,
    target_device: u32,
    transfer_id: &str,
    bytes_total: i64,
) {
    let _ = tx
        .send(WsMessage {
            sender_uid: 0,
            sender_device_id: 0,
            target_devices: if target_device > 0 {
                vec![target_device]
            } else {
                vec![]
            },
            r#type: "flow_transfer_completed".to_string(),
            payload: serde_json::json!({
                "transfer_id": transfer_id,
                "bytes_done": bytes_total,
                "bytes_total": bytes_total,
                "status": "completed",
            }),
        })
        .await;
}

async fn emit_transfer_failed(
    tx: &mpsc::Sender<WsMessage>,
    target_device: u32,
    transfer_id: &str,
    error_message: &str,
) {
    let _ = tx
        .send(WsMessage {
            sender_uid: 0,
            sender_device_id: 0,
            target_devices: if target_device > 0 {
                vec![target_device]
            } else {
                vec![]
            },
            r#type: "flow_transfer_failed".to_string(),
            payload: serde_json::json!({
                "transfer_id": transfer_id,
                "status": "failed",
                "message": error_message,
            }),
        })
        .await;
}

pub async fn start_flow_entry_send(
    record: &FlowHistoryEntryRecord,
    transfer_id: &str,
    target_device: u32,
    target_device_name: &str,
    ws_tx: mpsc::Sender<WsMessage>,
    device_label: &str,
) -> Result<(), String> {
    let entry_id = record.entry.id;
    let local_path = record
        .local_storage_path
        .as_ref()
        .map(PathBuf::from)
        .ok_or_else(|| {
            format!(
                "FlowSync entry {} has no local content path",
                record.entry.id
            )
        })?;
    if !local_path.exists() {
        return Err(format!(
            "FlowSync entry {} local content path does not exist: {}",
            record.entry.id,
            local_path.display()
        ));
    }

    let kind = record.entry.entry_type.clone();
    let root_hash = record.entry.hash.clone();
    let transfer_id_owned = transfer_id.to_string();
    let target_device_name_owned = target_device_name.to_string();
    let device_label_owned = device_label.to_string();
    let title = record
        .title
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            local_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });
    let temp_root = std::env::temp_dir().join("yibovibe-flowsync");
    fs::create_dir_all(&temp_root).map_err(|e| {
        format!(
            "Failed to create temp transfer dir {}: {}",
            temp_root.display(),
            e
        )
    })?;

    let (send_path, cleanup_path, filename) = if kind == "bundle" {
        let archive_path = temp_root.join(format!("{transfer_id}.zip"));
        package_bundle_archive(&local_path, &archive_path)?;
        let archive_name = format!("{}.zip", sanitize_file_name(&title));
        (archive_path.clone(), Some(archive_path), archive_name)
    } else {
        (
            local_path.clone(),
            None,
            local_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
        )
    };

    let file_meta = fs::metadata(&send_path).map_err(|e| {
        format!(
            "Failed to read transfer source metadata {}: {}",
            send_path.display(),
            e
        )
    })?;
    let bytes_total = file_meta.len() as i64;
    if let Some(flow_store) = FLOW_STORE_MANAGER.read().unwrap().as_ref() {
        flow_store.upsert_transfer_session(
            entry_id,
            &transfer_id_owned,
            "outbound",
            "offered",
            Some(&device_label_owned),
            Some(&target_device_name_owned),
            bytes_total,
            0,
            current_unix_ms(),
        )?;
    }

    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Failed to bind transfer listener: {}", e))?;
    let port = listener.local_addr().unwrap().port();
    let token = Uuid::new_v4().to_string();
    let offer = P2POffer {
        token: token.clone(),
        ips: get_local_ips(),
        port,
        filename,
        file_size: bytes_total as u64,
        transfer_id: transfer_id_owned.clone(),
        kind: kind.clone(),
        root_hash: root_hash.clone(),
        unpack_bundle: kind == "bundle",
        title: Some(title.clone()),
        source_device_name: Some(device_label_owned.clone()),
    };

    ws_tx
        .send(WsMessage {
            sender_uid: 0,
            sender_device_id: 0,
            target_devices: vec![target_device],
            r#type: "flow_transfer_offer".to_string(),
            payload: serde_json::to_value(&offer).unwrap(),
        })
        .await
        .map_err(|e| format!("Failed to send FlowSync transfer offer: {}", e))?;

    tokio::spawn(async move {
        let result: Result<(), String> = async {
            let (mut stream, addr) =
                tokio::time::timeout(std::time::Duration::from_secs(30), listener.accept())
                    .await
                    .map_err(|_| "Timed out waiting for receiver connection".to_string())?
                    .map_err(|e| format!("Failed to accept receiver connection: {}", e))?;
            info!(
                "FlowSync transfer {} connected from {:?}",
                transfer_id_owned, addr
            );

            let mut recv_token = vec![0_u8; token.len()];
            stream
                .read_exact(&mut recv_token)
                .await
                .map_err(|e| format!("Failed to read transfer token: {}", e))?;
            let token_text = String::from_utf8(recv_token)
                .map_err(|e| format!("Invalid transfer token: {}", e))?;
            if token_text != token {
                return Err("Transfer token mismatch".to_string());
            }
            stream
                .write_all(HANDSHAKE_ACK)
                .await
                .map_err(|e| format!("Failed to write transfer handshake ack: {}", e))?;

            if let Some(flow_store) = FLOW_STORE_MANAGER.read().unwrap().as_ref() {
                flow_store.upsert_transfer_session(
                    entry_id,
                    &transfer_id_owned,
                    "outbound",
                    "transferring",
                    Some(&device_label_owned),
                    Some(&target_device_name_owned),
                    bytes_total,
                    0,
                    current_unix_ms(),
                )?;
            }

            let mut file = tokio::fs::File::open(&send_path).await.map_err(|e| {
                format!(
                    "Failed to open transfer source {}: {}",
                    send_path.display(),
                    e
                )
            })?;
            let mut buffer = vec![0_u8; TRANSFER_BUFFER_SIZE];
            let mut bytes_done = 0_i64;
            loop {
                let read = file.read(&mut buffer).await.map_err(|e| {
                    format!(
                        "Failed to read transfer source {}: {}",
                        send_path.display(),
                        e
                    )
                })?;
                if read == 0 {
                    break;
                }
                stream
                    .write_all(&buffer[..read])
                    .await
                    .map_err(|e| format!("Failed to write transfer chunk: {}", e))?;
                bytes_done += read as i64;
                if let Some(flow_store) = FLOW_STORE_MANAGER.read().unwrap().as_ref() {
                    flow_store.upsert_transfer_session(
                        entry_id,
                        &transfer_id_owned,
                        "outbound",
                        "transferring",
                        Some(&device_label_owned),
                        Some(&target_device_name_owned),
                        bytes_total,
                        bytes_done,
                        current_unix_ms(),
                    )?;
                }
                emit_transfer_progress(
                    &ws_tx,
                    target_device,
                    &transfer_id_owned,
                    bytes_done,
                    bytes_total,
                )
                .await;
            }

            if let Some(flow_store) = FLOW_STORE_MANAGER.read().unwrap().as_ref() {
                flow_store.mark_transfer_completed(&transfer_id_owned, current_unix_ms())?;
            }
            emit_transfer_completed(&ws_tx, target_device, &transfer_id_owned, bytes_total).await;
            Ok(())
        }
        .await;

        if let Err(err) = result {
            error!(
                "FlowSync transfer {} send failed: {}",
                transfer_id_owned, err
            );
            if let Some(flow_store) = FLOW_STORE_MANAGER.read().unwrap().as_ref() {
                let _ = flow_store.mark_transfer_failed(&transfer_id_owned, current_unix_ms());
            }
            emit_transfer_failed(&ws_tx, target_device, &transfer_id_owned, &err).await;
        }

        if let Some(cleanup_path) = cleanup_path {
            let _ = fs::remove_file(cleanup_path);
        }
    });

    Ok(())
}

pub async fn handle_flow_transfer_offer(
    offer: P2POffer,
    source_device_id: u32,
    ws_tx: mpsc::Sender<WsMessage>,
    device_label: String,
) -> Result<(), String> {
    let record = {
        let flow_store_lock = FLOW_STORE_MANAGER.read().unwrap();
        let flow_store = flow_store_lock
            .as_ref()
            .ok_or("FlowSync store not initialized for transfer receive")?;
        flow_store
            .get_history_record_by_kind_hash(&offer.kind, &offer.root_hash)?
            .ok_or_else(|| {
                format!(
                    "Could not find FlowSync entry for transfer {} ({}/{})",
                    offer.transfer_id, offer.kind, offer.root_hash
                )
            })?
    };

    let download_root = {
        let flow_store_lock = FLOW_STORE_MANAGER.read().unwrap();
        let flow_store = flow_store_lock
            .as_ref()
            .ok_or("FlowSync store not initialized for transfer receive")?;
        let root = flow_store.root_dir().join("downloads");
        fs::create_dir_all(&root).map_err(|e| {
            format!(
                "Failed to create FlowSync downloads dir {}: {}",
                root.display(),
                e
            )
        })?;
        root
    };

    if let Some(flow_store) = FLOW_STORE_MANAGER.read().unwrap().as_ref() {
        flow_store.upsert_transfer_session(
            record.entry.id,
            &offer.transfer_id,
            "inbound",
            "offered",
            offer.source_device_name.as_deref(),
            Some(&device_label),
            offer.file_size as i64,
            0,
            current_unix_ms(),
        )?;
    }

    tokio::spawn(async move {
        let temp_archive_path = download_root.join(format!("{}.part", offer.transfer_id));
        let result: Result<(PathBuf, Option<String>), String> = async {
            let mut connected_stream: Option<TcpStream> = None;
            for ip in &offer.ips {
                let addr = format!("{}:{}", ip, offer.port);
                if let Ok(stream) = tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    TcpStream::connect(&addr),
                )
                .await
                    && let Ok(stream) = stream
                {
                    connected_stream = Some(stream);
                    break;
                }
            }

            let mut stream = connected_stream
                .ok_or_else(|| "Could not connect to any sender transfer address".to_string())?;
            stream
                .write_all(offer.token.as_bytes())
                .await
                .map_err(|e| format!("Failed to send transfer token: {}", e))?;
            let mut ack = [0_u8; 2];
            stream
                .read_exact(&mut ack)
                .await
                .map_err(|e| format!("Failed to read transfer handshake ack: {}", e))?;
            if &ack != HANDSHAKE_ACK {
                return Err("Transfer handshake ack mismatch".to_string());
            }

            if let Some(flow_store) = FLOW_STORE_MANAGER.read().unwrap().as_ref() {
                flow_store.upsert_transfer_session(
                    record.entry.id,
                    &offer.transfer_id,
                    "inbound",
                    "transferring",
                    offer.source_device_name.as_deref(),
                    Some(&device_label),
                    offer.file_size as i64,
                    0,
                    current_unix_ms(),
                )?;
            }

            let mut output = tokio::fs::File::create(&temp_archive_path)
                .await
                .map_err(|e| {
                    format!(
                        "Failed to create temp transfer file {}: {}",
                        temp_archive_path.display(),
                        e
                    )
                })?;
            let mut buffer = vec![0_u8; TRANSFER_BUFFER_SIZE];
            let mut bytes_done = 0_i64;
            loop {
                let read = stream
                    .read(&mut buffer)
                    .await
                    .map_err(|e| format!("Failed to read transfer stream: {}", e))?;
                if read == 0 {
                    break;
                }
                output
                    .write_all(&buffer[..read])
                    .await
                    .map_err(|e| format!("Failed to write temp transfer file: {}", e))?;
                bytes_done += read as i64;
                if let Some(flow_store) = FLOW_STORE_MANAGER.read().unwrap().as_ref() {
                    flow_store.upsert_transfer_session(
                        record.entry.id,
                        &offer.transfer_id,
                        "inbound",
                        "transferring",
                        offer.source_device_name.as_deref(),
                        Some(&device_label),
                        offer.file_size as i64,
                        bytes_done,
                        current_unix_ms(),
                    )?;
                }
                emit_transfer_progress(
                    &ws_tx,
                    source_device_id,
                    &offer.transfer_id,
                    bytes_done,
                    offer.file_size as i64,
                )
                .await;
            }
            output
                .flush()
                .await
                .map_err(|e| format!("Failed to flush temp transfer file: {}", e))?;

            if let Some(flow_store) = FLOW_STORE_MANAGER.read().unwrap().as_ref() {
                flow_store.upsert_transfer_session(
                    record.entry.id,
                    &offer.transfer_id,
                    "inbound",
                    "verifying",
                    offer.source_device_name.as_deref(),
                    Some(&device_label),
                    offer.file_size as i64,
                    bytes_done,
                    current_unix_ms(),
                )?;
            }

            if offer.unpack_bundle {
                let title = offer
                    .title
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "bundle".to_string());
                let final_dir = unique_destination_path(&download_root, &title);
                extract_bundle_archive(&temp_archive_path, &final_dir)?;
                let manifest = build_bundle_manifest(&final_dir)?;
                let manifest_json = serde_json::to_string_pretty(&manifest)
                    .map_err(|e| format!("Failed to encode received bundle manifest: {}", e))?;
                let verified_hash = blake3::hash(manifest_json.as_bytes()).to_hex().to_string();
                if verified_hash != offer.root_hash {
                    return Err(format!(
                        "Bundle verification failed for transfer {}: expected {}, got {}",
                        offer.transfer_id, offer.root_hash, verified_hash
                    ));
                }
                Ok((final_dir, Some(manifest_json)))
            } else {
                let verified_hash = compute_file_blake3(&temp_archive_path)?;
                if !offer.root_hash.is_empty() && verified_hash != offer.root_hash {
                    return Err(format!(
                        "File verification failed for transfer {}: expected {}, got {}",
                        offer.transfer_id, offer.root_hash, verified_hash
                    ));
                }
                let final_file = unique_destination_path(&download_root, &offer.filename);
                fs::rename(&temp_archive_path, &final_file).map_err(|e| {
                    format!(
                        "Failed to move downloaded file {} -> {}: {}",
                        temp_archive_path.display(),
                        final_file.display(),
                        e
                    )
                })?;
                Ok((final_file, None))
            }
        }
        .await;

        match result {
            Ok((final_path, manifest_json)) => {
                let finalize_result = {
                    let flow_store_lock = FLOW_STORE_MANAGER.read().unwrap();
                    let flow_store = flow_store_lock.as_ref();
                    if let Some(flow_store) = flow_store {
                        flow_store.finalize_downloaded_entry(
                            record.entry.id,
                            &final_path,
                            manifest_json.as_deref(),
                            &offer.transfer_id,
                            current_unix_ms(),
                        )
                    } else {
                        Err("FlowSync store not initialized while finalizing transfer".to_string())
                    }
                };
                if let Err(err) = finalize_result {
                    error!(
                        "Failed to finalize FlowSync transfer {}: {}",
                        offer.transfer_id, err
                    );
                    if let Some(flow_store) = FLOW_STORE_MANAGER.read().unwrap().as_ref() {
                        let _ =
                            flow_store.mark_transfer_failed(&offer.transfer_id, current_unix_ms());
                    }
                    emit_transfer_failed(&ws_tx, source_device_id, &offer.transfer_id, &err).await;
                } else {
                    let _ = fs::remove_file(&temp_archive_path);
                    emit_transfer_completed(
                        &ws_tx,
                        source_device_id,
                        &offer.transfer_id,
                        offer.file_size as i64,
                    )
                    .await;
                }
            }
            Err(err) => {
                error!(
                    "FlowSync transfer {} receive failed: {}",
                    offer.transfer_id, err
                );
                let _ = fs::remove_file(&temp_archive_path);
                if let Some(flow_store) = FLOW_STORE_MANAGER.read().unwrap().as_ref() {
                    let _ = flow_store.mark_transfer_failed(&offer.transfer_id, current_unix_ms());
                }
                emit_transfer_failed(&ws_tx, source_device_id, &offer.transfer_id, &err).await;
            }
        }
    });

    Ok(())
}
