package relay

import (
	"encoding/json"
	"log"
	"time"
)

// CommandType classifies relayed messages for routing
type CommandType string

const (
	CmdSessionStart   CommandType = "session:start"
	CmdSessionStop    CommandType = "session:stop"
	CmdSessionPause   CommandType = "session:pause"
	CmdSessionResume  CommandType = "session:resume"
	CmdStdin          CommandType = "session:stdin"
	CmdResize         CommandType = "session:resize"
	CmdVitalSigns     CommandType = "host:vitals"
	CmdAlert          CommandType = "host:alert"
	CmdHeartbeat      CommandType = "host:heartbeat"
	CmdResourcePush   CommandType = "resource:push"
	CmdConfirmAction  CommandType = "control:confirm"
	CmdRejectAction   CommandType = "control:reject"
)

// RelayMessage is the envelope for all signal hub messages
type RelayMessage struct {
	Type      CommandType `json:"type"`
	SessionID string      `json:"session_id,omitempty"`
	SenderUID uint        `json:"sender_uid"`
	SenderDev uint        `json:"sender_device"`
	TargetUID uint        `json:"target_uid,omitempty"`
	TargetDev uint        `json:"target_device,omitempty"`
	Payload   any         `json:"payload"`
	Timestamp int64       `json:"ts"`
}

// NewRelayMessage creates a timestamped relay message
func NewRelayMessage(cmdType CommandType, sessionID string, senderUID, senderDev uint, payload any) *RelayMessage {
	return &RelayMessage{
		Type:      cmdType,
		SessionID: sessionID,
		SenderUID: senderUID,
		SenderDev: senderDev,
		Payload:   payload,
		Timestamp: time.Now().UnixMilli(),
	}
}

// Marshal serializes the relay message to JSON bytes
func (m *RelayMessage) Marshal() ([]byte, error) {
	return json.Marshal(m)
}

// Relay manages inter-device command routing via the WS hub
type Relay struct {
	relayChan chan *RelayMessage
}

func NewRelay() *Relay {
	return &Relay{
		relayChan: make(chan *RelayMessage, 256),
	}
}

func (r *Relay) Submit(msg *RelayMessage) {
	select {
	case r.relayChan <- msg:
	default:
		log.Printf("[Relay] Relay buffer full, dropping message type=%s", msg.Type)
	}
}

func (r *Relay) Run() {
	log.Println("[Relay] Command relay started")
	for msg := range r.relayChan {
		log.Printf("[Relay] Routing message type=%s session=%s from=UID%d:Dev%d",
			msg.Type, msg.SessionID, msg.SenderUID, msg.SenderDev)
	}
}
