package ws

import (
	"log"
	"sync"
	"time"

	"github.com/datouluobo/YiboVibe/server/internal/relay"
	"github.com/datouluobo/YiboVibe/server/internal/session"
)

// Hub maintains the set of active clients and broadcasts messages to the
// clients directly over memory.
type Hub struct {
	// Registered clients split by UID to quickly broadcast to user's devices
	// uid -> deviceId -> *Client
	Clients map[uint]map[uint]*Client

	// Session store for active session metadata
	Sessions *session.SessionStore

	// Command relay for inter-device routing
	Rly *relay.Relay

	// Heartbeat relay channel
	Heartbeat chan *relay.RelayMessage

	// Alert relay channel
	Alert chan *relay.RelayMessage

	// Locks for safely mutating Clients
	Mu sync.RWMutex

	// Inbound messages from the clients
	Broadcast chan *Message

	// Register requests from the clients
	Register chan *Client

	// Unregister requests from clients
	Unregister chan *Client
}

// Message schema used inside Hub for internal routing
type Message struct {
	SenderUID      uint   `json:"sender_uid"`
	SenderDeviceID uint   `json:"sender_device_id"`
	TargetDevices  []uint `json:"target_devices,omitempty"` // If empty, broadcast to all user's devices
	Type           string `json:"type"`                     // E.g., "clipboard_update", "ping"
	Payload        any    `json:"payload"`
}

func NewHub() *Hub {
	sessStore := session.NewSessionStore()
	rly := relay.NewRelay()
	return &Hub{
		Broadcast:  make(chan *Message),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Clients:    make(map[uint]map[uint]*Client),
		Sessions:   sessStore,
		Rly:        rly,
		Heartbeat:  make(chan *relay.RelayMessage, 256),
		Alert:      make(chan *relay.RelayMessage, 64),
	}
}

func (h *Hub) Run() {
	log.Println("WebSocket Hub started (Signal+Session mode).")
	go h.Rly.Run()
	// Heartbeat relay consumer
	go func() {
		for msg := range h.Heartbeat {
			h.routeSignalMessage(msg)
		}
	}()
	// Alert relay consumer
	go func() {
		for msg := range h.Alert {
			log.Printf("[SignalHub] Alert: type=%s session=%s", msg.Type, msg.SessionID)
			h.routeSignalMessage(msg)
		}
	}()

	// Periodic session TTL cleanup — every 60 seconds
	cleanupTicker := time.NewTicker(60 * time.Second)
	defer cleanupTicker.Stop()

	for {
		select {
		case client := <-h.Register:
			h.Mu.Lock()
			if h.Clients[client.UID] == nil {
				h.Clients[client.UID] = make(map[uint]*Client)
			}
			h.Clients[client.UID][client.DeviceID] = client
			h.Mu.Unlock()

			// Set online in Redis
			_ = MarkDeviceOnline(client.UID, client.DeviceID)
			log.Printf("Client Registered: UID %d / Device %d\n", client.UID, client.DeviceID)

		case client := <-h.Unregister:
			h.Mu.Lock()
			if _, ok := h.Clients[client.UID]; ok {
				if _, ok := h.Clients[client.UID][client.DeviceID]; ok {
					delete(h.Clients[client.UID], client.DeviceID)
					close(client.Send)

					// If no more devices for user, clean up map to save mem
					if len(h.Clients[client.UID]) == 0 {
						delete(h.Clients, client.UID)
					}
				}
			}
			h.Mu.Unlock()

			h.Sessions.DeleteByOwnerDevice(client.UID, client.DeviceID)
			_ = MarkDeviceOffline(client.UID, client.DeviceID)
			log.Printf("Client Unregistered: UID %d / Device %d\n", client.UID, client.DeviceID)

		case message := <-h.Broadcast:
			h.Mu.RLock()
			devices, ok := h.Clients[message.SenderUID]

			// Collect clients that need to be kicked (send buffer full)
			var deadClients []*Client

			if ok {
				for did, c := range devices {
					// Skip sender itself or check if we must filter by target device ID
					if did == message.SenderDeviceID {
						continue
					}

					if len(message.TargetDevices) > 0 && !contains(message.TargetDevices, did) {
						continue
					}

					select {
					case c.Send <- message:
					default:
						// Send buffer full - collect for removal outside read lock
						deadClients = append(deadClients, c)
					}
				}
			}
			h.Mu.RUnlock()

			// Remove dead clients with a write lock (separated from read operation)
			if len(deadClients) > 0 {
				h.Mu.Lock()
				for _, c := range deadClients {
					// Double-check the client still exists before closing
					if devs, ok := h.Clients[message.SenderUID]; ok {
						if _, ok := devs[c.DeviceID]; ok {
							delete(devs, c.DeviceID)
							close(c.Send)
						}
					}
				}
				// Clean up empty user map
				if devs, ok := h.Clients[message.SenderUID]; ok && len(devs) == 0 {
					delete(h.Clients, message.SenderUID)
				}
				h.Mu.Unlock()
			}

		case <-cleanupTicker.C:
			h.Sessions.CleanupStaleSessions()
		}
	}
}

func (h *Hub) routeSignalMessage(msg *relay.RelayMessage) {
	// Route a signal message to the target device or all user's devices
	h.Mu.RLock()
	defer h.Mu.RUnlock()

	// Determine target UID
	targetUID := msg.TargetUID
	if targetUID == 0 {
		targetUID = msg.SenderUID
	}

	devices, hasUser := h.Clients[targetUID]
	if !hasUser {
		log.Printf("[SignalHub] No active clients for UID %d, dropping signal", targetUID)
		return
	}

	data, err := msg.Marshal()
	if err != nil {
		log.Printf("[SignalHub] Failed to marshal signal: %v", err)
		return
	}

	wsMsg := &Message{
		SenderUID:      msg.SenderUID,
		SenderDeviceID: msg.SenderDev,
		Type:           string(msg.Type),
		Payload:        string(data),
	}

	for did, client := range devices {
		if msg.TargetDev > 0 && did != msg.TargetDev {
			continue
		}
		if did == msg.SenderDev && msg.TargetDev == 0 {
			// Skip sender unless explicitly targeted
			continue
		}
		select {
		case client.Send <- wsMsg:
		default:
			log.Printf("[SignalHub] Client buffer full for UID %d Dev %d", targetUID, did)
		}
	}
}

func contains(arr []uint, trg uint) bool {
	for _, v := range arr {
		if v == trg {
			return true
		}
	}
	return false
}
