use log::{error, info};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use uuid::Uuid;

use crate::ws::WsMessage;
use tokio::sync::mpsc;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct P2POffer {
    pub token: String,
    pub ips: Vec<String>,
    pub port: u16,
    pub filename: String,
    pub file_size: u64,
}

/// Helper device finding all local IPs (rudimentary fallback)
fn get_local_ips() -> Vec<String> {
    let mut ips = Vec::new();
    // A quick hack: connect a UDP socket to a public IP to find out which local interface is used
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0")
        && socket.connect("8.8.8.8:80").is_ok()
            && let Ok(addr) = socket.local_addr() {
                ips.push(addr.ip().to_string());
            }
    ips.push("127.0.0.1".to_string());
    ips
}

pub async fn start_file_send(
    file_path: std::path::PathBuf,
    target_device: u32,
    ws_tx: mpsc::Sender<WsMessage>,
) -> Result<(), String> {
    let file_meta = std::fs::metadata(&file_path).map_err(|e| e.to_string())?;
    let file_size = file_meta.len();
    let filename = file_path.file_name().unwrap_or_default().to_string_lossy().to_string();
    
    // Bind to any available port
    let listener = TcpListener::bind("0.0.0.0:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().unwrap().port();
    
    let token = Uuid::new_v4().to_string();
    let ips = get_local_ips();
    
    let offer = P2POffer {
        token: token.clone(),
        ips,
        port,
        filename: filename.clone(),
        file_size,
    };
    
    // Send WS Offer
    let msg = WsMessage {
        sender_uid: 0,
        sender_device_id: 0,
        target_devices: if target_device > 0 { vec![target_device] } else { vec![] },
        r#type: "p2p_file_offer".to_string(),
        payload: serde_json::to_value(&offer).unwrap(),
    };
    
    if let Err(e) = ws_tx.send(msg).await {
        return Err(format!("Failed to send P2P offer WS message: {}", e));
    }
    
    info!("P2P Sender listening on port {} for token {}", port, token);
    
    tokio::spawn(async move {
        // Wait up to 30 seconds for the receiver to connect
        if let Ok(Ok((mut stream, addr))) = tokio::time::timeout(std::time::Duration::from_secs(30), listener.accept()).await {
            info!("P2P Connection from {:?}. Verifying token...", addr);
            
            // Read token (assume it's exactly 36 bytes for a UUID)
            let mut recv_token = vec![0u8; 36];
            if stream.read_exact(&mut recv_token).await.is_ok()
                && let Ok(s) = String::from_utf8(recv_token) {
                    if s == token {
                        info!("P2P Token verified. Streaming file...");
                        stream.write_all(b"OK").await.unwrap_or_default();
                        
                        if let Ok(mut file) = tokio::fs::File::open(&file_path).await
                            && let Ok(bytes_sent) = tokio::io::copy(&mut file, &mut stream).await {
                                info!("P2P Transfer complete: {} bytes sent.", bytes_sent);
                            }
                    } else {
                        error!("P2P Invalid token received: {}", s);
                    }
                }
        } else {
            error!("P2P Sender timed out waiting for connection.");
        }
    });
    
    Ok(())
}

pub async fn handle_p2p_offer(
    offer: P2POffer,
    save_dir: PathBuf,
) {
    tokio::spawn(async move {
        info!("P2P Received offer for {}. Attempting to connect...", offer.filename);
        let mut connected_stream: Option<TcpStream> = None;
        
        // Try all IPs
        for ip in offer.ips {
            let addr = format!("{}:{}", ip, offer.port);
            if let Ok(stream) = tokio::time::timeout(std::time::Duration::from_secs(3), TcpStream::connect(&addr)).await
                && let Ok(stream) = stream {
                    info!("P2P Successfully connected to sender at {}", addr);
                    connected_stream = Some(stream);
                    break;
                }
        }
        
        if let Some(mut stream) = connected_stream {
            if stream.write_all(offer.token.as_bytes()).await.is_ok() {
                let mut ack = [0u8; 2];
                if stream.read_exact(&mut ack).await.is_ok() && &ack == b"OK" {
                    info!("P2P Sender ready to stream. Saving to {:?}", save_dir);
                    
                    std::fs::create_dir_all(&save_dir).unwrap_or_default();
                    let save_path = save_dir.join(&offer.filename);
                    
                    if let Ok(mut file) = tokio::fs::File::create(&save_path).await {
                        if let Ok(bytes_read) = tokio::io::copy(&mut stream, &mut file).await {
                            info!("P2P File received successfully: {} bytes saved to {:?}", bytes_read, save_path);
                        } else {
                            error!("P2P Failed during streaming transmission");
                        }
                    } else {
                        error!("P2P Failed to open local file for writing");
                    }
                } else {
                    error!("P2P Handshake ACK failed");
                }
            }
        } else {
            error!("P2P Could not connect to any of the sender's IPs");
        }
    });
}
