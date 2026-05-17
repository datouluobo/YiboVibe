package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"github.com/datouluobo/YiboVibe/server/internal/relay"
	"github.com/datouluobo/YiboVibe/server/internal/session"
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

		// Route session-signal messages through the Signal Hub path
		if isSignalMessage(msg.Type) {
			handleSignalMessage(c, &msg)
		} else {
			c.Hub.Broadcast <- &msg
		}
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

// isSignalMessage checks if this WS message is a Signal Hub message
type signalPayload struct {
	SessionID string `json:"session_id,omitempty"`
	State     string `json:"state,omitempty"`
}

func isSignalMessage(msgType string) bool {
	signalTypes := map[string]bool{
		"session:register": true,
		"session:update":   true,
		"session:unregister": true,
		"host:heartbeat":   true,
		"host:alert":       true,
		"host:vitals":      true,
	}
	return signalTypes[msgType]
}

func handleSignalMessage(c *Client, msg *Message) {
	var payload signalPayload
	if data, ok := msg.Payload.(string); ok {
		_ = json.Unmarshal([]byte(data), &payload)
	} else if data, ok := msg.Payload.(map[string]interface{}); ok {
		// Handle parsed JSON case
		if sid, ok := data["session_id"].(string); ok {
			payload.SessionID = sid
		}
		if state, ok := data["state"].(string); ok {
			payload.State = state
		}
	}

	switch msg.Type {
	case "session:register", "session:update":
		newState := session.StateRunning
		if payload.State == "paused" {
			newState = session.StatePaused
		} else if payload.State == "stopped" {
			newState = session.StateStopped
		} else if payload.State == "crashed" {
			newState = session.StateCrashed
		}
		s := &session.Session{
			ID:          payload.SessionID,
			OwnerUID:    c.UID,
			OwnerDevice: c.DeviceID,
			State:       newState,
		}
		// Extract additional fields from payload map
		if data, ok := msg.Payload.(map[string]interface{}); ok {
			if sk, ok := data["shell_kind"].(string); ok {
				s.ShellKind = sk
			}
			if cwd, ok := data["cwd"].(string); ok {
				s.CWD = cwd
			}
			if sa, ok := data["started_at"].(float64); ok {
				s.StartedAt = int64(sa)
			}
			if la, ok := data["last_output_at"].(float64); ok {
				s.LastActiveAt = int64(la)
			}
		}
		c.Hub.Sessions.Upsert(s)
		log.Printf("[SignalHub] Session %s state=%s from UID=%d Dev=%d",
			payload.SessionID, newState, c.UID, c.DeviceID)

		// Broadcast session update to other WS clients (mobile)
		select {
		case c.Hub.Broadcast <- &Message{
			SenderUID:      c.UID,
			SenderDeviceID: c.DeviceID,
			Type:           "session:list_update",
			Payload: map[string]interface{}{
				"action":  "upserted",
				"session": s,
			},
		}:
		default:
		}

	case "session:unregister":
		// Capture session before deleting, so we can broadcast the removal
		oldSess := c.Hub.Sessions.Get(payload.SessionID)
		c.Hub.Sessions.Delete(payload.SessionID)
		log.Printf("[SignalHub] Session %s unregistered by UID=%d", payload.SessionID, c.UID)

		// Broadcast deletion to other WS clients
		deletedPayload := map[string]interface{}{
			"action":     "deleted",
			"session_id": payload.SessionID,
		}
		if oldSess != nil {
			deletedPayload["session"] = oldSess
		}
		select {
		case c.Hub.Broadcast <- &Message{
			SenderUID:      c.UID,
			SenderDeviceID: c.DeviceID,
			Type:           "session:list_update",
			Payload:        deletedPayload,
		}:
		default:
		}

	case "host:heartbeat":
		rm := relay.NewRelayMessage(relay.CmdHeartbeat, payload.SessionID, c.UID, c.DeviceID, msg.Payload)
		select {
		case c.Hub.Heartbeat <- rm:
		default:
		}

	case "host:alert":
		rm := relay.NewRelayMessage(relay.CmdAlert, payload.SessionID, c.UID, c.DeviceID, msg.Payload)
		select {
		case c.Hub.Alert <- rm:
		default:
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
