package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512 * 1024 // 512 KB payload max (good enough for text E2EE payloads)
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// In production, configure CheckOrigin securely for web domains. Since we use desktop clients, we allow all
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Client struct {
	Hub      *Hub
	Conn     *websocket.Conn
	Send     chan *Message
	UID      uint
	DeviceID uint
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		// Extend read deadline on Pong receipt, and refresh Redis TTL presence
		_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		_ = MarkDeviceOnline(c.UID, c.DeviceID)
		return nil
	})

	for {
		_, messageData, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WS read err: %v", err)
			}
			break
		}

		var msg Message
		if err := json.Unmarshal(messageData, &msg); err != nil {
			log.Printf("WS json unmarshal err: %v. Raw: %s\n", err, string(messageData))
			continue
		}

		// Security guard: force server to overwrite Sender to prevent spoofing
		msg.SenderUID = c.UID
		msg.SenderDeviceID = c.DeviceID

		c.Hub.Broadcast <- &msg
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			err = json.NewEncoder(w).Encode(message)
			if err != nil {
				log.Printf("WS JSON encode err: %v\n", err)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ServeWs handles websocket requests from the peer.
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request, uid uint, deviceID uint) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade failed:", err)
		return
	}

	client := &Client{
		Hub:      hub,
		Conn:     conn,
		Send:     make(chan *Message, 256), // Buffered channel per client
		UID:      uid,
		DeviceID: deviceID,
	}
	client.Hub.Register <- client

	// Allow collection of memory referenced by the caller by doing all work in new goroutines.
	go client.WritePump()
	go client.ReadPump()
}
