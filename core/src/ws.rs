use futures_util::{SinkExt, StreamExt};
use log::{error, info};
use reqwest::header::{AUTHORIZATION, HeaderValue};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async_tls_with_config,
    Connector,
    tungstenite::{client::IntoClientRequest, protocol::Message as TungsteniteMessage},
};
use native_tls::TlsConnector;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WsMessage {
    #[serde(default)]
    pub sender_uid: u32,
    #[serde(default)]
    pub sender_device_id: u32,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub target_devices: Vec<u32>,
    pub r#type: String,
    pub payload: serde_json::Value,
}

pub struct WsClient {
    pub tx: mpsc::Sender<WsMessage>,
}

impl WsClient {
    /// Connects to the WebSocket server using the provided Base URL and JWT Bearer Token
    pub async fn connect(
        base_url: &str,
        token: &str,
    ) -> Result<(Self, mpsc::Receiver<WsMessage>), Box<dyn std::error::Error + Send + Sync>> {
        let ws_url = base_url
            .replace("http://", "ws://")
            .replace("https://", "wss://");
        let url = format!("{}/api/v1/sync/ws", ws_url);

        // Construct the HTTP Upgrade request with JWT in Authorization header
        let mut request = url.into_client_request()?;
        request.headers_mut().insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", token))?,
        );

        let mut builder = TlsConnector::builder();
        builder.danger_accept_invalid_certs(true);
        let connector = Connector::NativeTls(builder.build().unwrap());

        let (ws_stream, response) = connect_async_tls_with_config(
            request,
            None,
            false,
            Some(connector),
        ).await?;
        info!(
            "WebSocket connected with HTTP status: {}",
            response.status()
        );

        // Split the stream into a sender and receiver
        let (mut ws_write, mut ws_read) = ws_stream.split();

        // Local channel to allow other parts of the app to send messages out to the WS
        let (tx, mut rx) = mpsc::channel::<WsMessage>(100);
        let (in_tx, in_rx) = mpsc::channel::<WsMessage>(100);

        // Core Read Task (Listens to NAS)
        tokio::spawn(async move {
            info!("WebSocket read daemon started.");
            while let Some(msg_result) = ws_read.next().await {
                match msg_result {
                    Ok(TungsteniteMessage::Text(text)) => {
                        if let Ok(parsed) = serde_json::from_str::<WsMessage>(&text) {
                            info!("Received WS Broadcast -> Type: {}", parsed.r#type);
                            let _ = in_tx.send(parsed).await;
                        } else {
                            error!("Failed to parse incoming WS Message: {}", text);
                        }
                    }
                    Ok(TungsteniteMessage::Ping(_)) => {
                        // tokio-tungstenite automatically handles sending PONGs for PINGs.
                    }
                    Ok(TungsteniteMessage::Close(c)) => {
                        info!("WebSocket closed by server. Reason: {:?}", c);
                        break;
                    }
                    Err(e) => {
                        error!("WebSocket read error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }
            info!("WebSocket read daemon terminated.");
        });

        // Core Write Task (Sends from Local App -> NAS)
        tokio::spawn(async move {
            info!("WebSocket write daemon started.");
            while let Some(msg) = rx.recv().await {
                if let Ok(json_str) = serde_json::to_string(&msg)
                    && let Err(e) = ws_write
                        .send(TungsteniteMessage::Text(json_str.into()))
                        .await
                    {
                        error!("WebSocket write error: {}", e);
                        break;
                    }
            }
            info!("WebSocket write daemon terminated.");
        });

        Ok((Self { tx }, in_rx))
    }

    /// Exposes a convenient method to push a message into the write queue
    pub async fn send_message(
        &self,
        msg: WsMessage,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.tx.send(msg).await?;
        Ok(())
    }
}
