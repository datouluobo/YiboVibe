package session

import (
	"log"
	"sync"
	"time"
)

// SessionState represents the current state of a remote agent session
type SessionState string

const (
	StateRunning SessionState = "running"
	StatePaused  SessionState = "paused"
	StateStopped SessionState = "stopped"
	StateCrashed SessionState = "crashed"
)

// Session represents a remote agent session managed through the Signal Hub
type Session struct {
	ID           string       `json:"id"`
	OwnerUID     uint         `json:"owner_uid"`
	OwnerDevice  uint         `json:"owner_device"`
	Label        string       `json:"label"`
	State        SessionState `json:"state"`
	ShellKind    string       `json:"shell_kind,omitempty"`
	CWD          string       `json:"cwd,omitempty"`
	StartedAt    int64        `json:"started_at"`
	LastActiveAt int64        `json:"last_active_at"`
}

// SessionStore manages active session metadata in memory
type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*Session // session_id -> session
	userSess map[uint]map[string]bool // uid -> set of session_ids
}

func NewSessionStore() *SessionStore {
	return &SessionStore{
		sessions: make(map[string]*Session),
		userSess: make(map[uint]map[string]bool),
	}
}

func (s *SessionStore) Upsert(sess *Session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess.LastActiveAt = time.Now().Unix()
	s.sessions[sess.ID] = sess
	if s.userSess[sess.OwnerUID] == nil {
		s.userSess[sess.OwnerUID] = make(map[string]bool)
	}
	s.userSess[sess.OwnerUID][sess.ID] = true
	log.Printf("[SessionStore] Upserted session %s for UID %d (state=%s)", sess.ID, sess.OwnerUID, sess.State)
}

func (s *SessionStore) Get(id string) *Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.sessions[id]
}

func (s *SessionStore) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sess, ok := s.sessions[id]; ok {
		delete(s.sessions, id)
		if s.userSess[sess.OwnerUID] != nil {
			delete(s.userSess[sess.OwnerUID], id)
		}
		log.Printf("[SessionStore] Deleted session %s", id)
	}
}

func (s *SessionStore) ListByUser(uid uint) []*Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*Session
	for id := range s.userSess[uid] {
		if sess, ok := s.sessions[id]; ok {
			result = append(result, sess)
		}
	}
	return result
}

func (s *SessionStore) UpdateState(id string, state SessionState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sess, ok := s.sessions[id]; ok {
		sess.State = state
		sess.LastActiveAt = time.Now().Unix()
	}
}
