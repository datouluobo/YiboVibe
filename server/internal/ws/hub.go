package ws

import (
	"log"
	"sync"
)

// Hub maintains the set of active clients and broadcasts messages to the
// clients directly over memory. We will eventually bridge this with Redis Pub/Sub
// to allow horizontal scale, but for Private NAS (single node), this is sufficient.
type Hub struct {
	// Registered clients split by UID to quickly broadcast to user's devices
	// uid -> deviceId -> *Client
	Clients map[uint]map[uint]*Client

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
	return &Hub{
		Broadcast:  make(chan *Message),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Clients:    make(map[uint]map[uint]*Client),
	}
}

func (h *Hub) Run() {
	log.Println("WebSocket Hub started.")
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

			_ = MarkDeviceOffline(client.UID, client.DeviceID)
			log.Printf("Client Unregistered: UID %d / Device %d\n", client.UID, client.DeviceID)

		case message := <-h.Broadcast:
			h.Mu.RLock()
			devices, ok := h.Clients[message.SenderUID]

			// Broadcast only if there are target devices
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
						// Send buffer full, kick out dead client
						close(c.Send)
						delete(h.Clients[message.SenderUID], did)
					}
				}
			}
			h.Mu.RUnlock()
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
