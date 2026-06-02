package ws

import (
	"log"
)

// validateCodexMessage checks the schema of a codex:* or workbench:* message.
// Returns true if the message is valid, false if it should be dropped.
// Invalid messages are logged as warnings and discarded without relay.
func validateCodexMessage(msg *Message) bool {
	if msg == nil {
		return false
	}

	// Only validate codex:* and workbench:* prefixed types
	if !isCodexFamilyType(msg.Type) {
		return true // non-codex messages pass through
	}

	payload, ok := msg.Payload.(map[string]interface{})
	if !ok {
		log.Printf("[CodexValidator] WARN: payload must be object, got %T for type=%s", msg.Payload, msg.Type)
		return false
	}

	switch msg.Type {
	case "codex:turn:start":
		return validateRequiredString(payload, "conversation_id", msg.Type) &&
			validateRequiredString(payload, "text", msg.Type)

	case "codex:approval:decision":
		return validateRequiredString(payload, "conversation_id", msg.Type) &&
			validateRequiredString(payload, "request_id", msg.Type) &&
			validateRequiredString(payload, "approval_id", msg.Type) &&
			validateRequiredBool(payload, "approved", msg.Type) &&
			validateRequiredString(payload, "kind", msg.Type)

	case "codex:thread:archive":
		return validateRequiredString(payload, "conversation_id", msg.Type)

	case "codex:project:branch:switch":
		return validateRequiredString(payload, "cwd", msg.Type) &&
			validateRequiredString(payload, "branch", msg.Type)

	case "codex:config:update":
		// All fields are optional — just need valid object payload
		return true

	case "workbench:snapshot:request":
		// No required fields
		return true

	case "workbench:changed":
		// Informational event, loosely validated
		return true

	default:
		// Unknown codex:* / workbench:* type — let it pass (forward compatibility)
		log.Printf("[CodexValidator] INFO: unknown codex family type=%s, allowing relay", msg.Type)
		return true
	}
}

// isCodexFamilyType returns true for codex:* and workbench:* message types
func isCodexFamilyType(msgType string) bool {
	if len(msgType) < 7 {
		return false
	}
	return (len(msgType) >= 6 && msgType[:6] == "codex:") ||
		(len(msgType) >= 10 && msgType[:10] == "workbench:")
}

func validateRequiredString(payload map[string]interface{}, key string, msgType string) bool {
	v, ok := payload[key]
	if !ok {
		log.Printf("[CodexValidator] WARN: missing required field %q for type=%s", key, msgType)
		return false
	}
	s, ok := v.(string)
	if !ok {
		log.Printf("[CodexValidator] WARN: field %q must be string for type=%s, got %T", key, msgType, v)
		return false
	}
	if s == "" {
		log.Printf("[CodexValidator] WARN: field %q must be non-empty string for type=%s", key, msgType)
		return false
	}
	return true
}

func validateRequiredBool(payload map[string]interface{}, key string, msgType string) bool {
	v, ok := payload[key]
	if !ok {
		log.Printf("[CodexValidator] WARN: missing required field %q for type=%s", key, msgType)
		return false
	}
	_, ok = v.(bool)
	if !ok {
		log.Printf("[CodexValidator] WARN: field %q must be bool for type=%s, got %T", key, msgType, v)
		return false
	}
	return true
}
