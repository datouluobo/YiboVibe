package ws

import "testing"

func TestValidateCodexMessageAllowsTurnCancelWithConversationID(t *testing.T) {
	msg := &Message{
		Type: "codex:turn:cancel",
		Payload: map[string]interface{}{
			"conversation_id": "thread-1",
			"turn_id":         "turn-42",
		},
	}

	if !validateCodexMessage(msg) {
		t.Fatal("expected codex:turn:cancel payload to pass validation")
	}
}

func TestValidateCodexMessageRejectsTurnCancelWithoutConversationID(t *testing.T) {
	msg := &Message{
		Type:    "codex:turn:cancel",
		Payload: map[string]interface{}{"turn_id": "turn-42"},
	}

	if validateCodexMessage(msg) {
		t.Fatal("expected codex:turn:cancel payload without conversation_id to be rejected")
	}
}
