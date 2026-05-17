package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/datouluobo/YiboVibe/server/internal/api/middleware"
	"github.com/datouluobo/YiboVibe/server/internal/ws"
)

// ListSessions returns all active sessions for the current user
func ListSessions(hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid, _ := c.Get(middleware.CtxUIDKey)
		uidVal, ok := uid.(uint)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "invalid uid"})
			return
		}

		sessions := hub.Sessions.ListByUser(uidVal)
		c.JSON(http.StatusOK, gin.H{
			"code": 200,
			"msg":  "ok",
			"data": sessions,
		})
	}
}

// GetSession returns a specific session by ID
func GetSession(hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		sess := hub.Sessions.Get(id)
		if sess == nil {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "session not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 200, "msg": "ok", "data": sess})
	}
}

// StopSession asks the owner desktop device to stop a session.
func StopSession(hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.MustGet(middleware.CtxUIDKey).(uint)
		sessionID := c.Param("id")

		sess := hub.Sessions.Get(sessionID)
		if sess == nil || sess.OwnerUID != uid {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "session not found"})
			return
		}

		hub.Broadcast <- &ws.Message{
			SenderUID:      uid,
			SenderDeviceID: 0,
			TargetDevices:  []uint{sess.OwnerDevice},
			Type:           "session:stop",
			Payload: gin.H{
				"session_id": sessionID,
				"confirmed":  true,
			},
		}

		c.JSON(http.StatusAccepted, gin.H{
			"code": 202,
			"msg":  "stop requested",
		})
	}
}

// RemoveSession asks the owner desktop device to remove a session, or deletes it
// immediately if the owner device is already offline.
func RemoveSession(hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.MustGet(middleware.CtxUIDKey).(uint)
		sessionID := c.Param("id")

		sess := hub.Sessions.Get(sessionID)
		if sess == nil || sess.OwnerUID != uid {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "session not found"})
			return
		}

		hub.Mu.RLock()
		userClients := hub.Clients[uid]
		targetOnline := false
		if userClients != nil {
			_, targetOnline = userClients[sess.OwnerDevice]
		}
		hub.Mu.RUnlock()

		if targetOnline {
			hub.Broadcast <- &ws.Message{
				SenderUID:      uid,
				SenderDeviceID: 0,
				TargetDevices:  []uint{sess.OwnerDevice},
				Type:           "session:remove",
				Payload: gin.H{
					"session_id": sessionID,
				},
			}
			c.JSON(http.StatusAccepted, gin.H{
				"code": 202,
				"msg":  "remove requested",
			})
			return
		}

		hub.Sessions.Delete(sessionID)
		select {
		case hub.Broadcast <- &ws.Message{
			SenderUID:      uid,
			SenderDeviceID: 0,
			Type:           "session:list_update",
			Payload: gin.H{
				"action":     "deleted",
				"session_id": sessionID,
			},
		}:
		default:
		}

		c.JSON(http.StatusOK, gin.H{
			"code": 200,
			"msg":  "session removed",
		})
	}
}

// GetOnlineDevices is a pass-through to the existing handler
// We extend it to also include relay diagnostics
func GetSignalDiagnostics(hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		hub.Mu.RLock()
		clientCount := 0
		for _, devs := range hub.Clients {
			clientCount += len(devs)
		}
		userCount := len(hub.Clients)
		hub.Mu.RUnlock()

		sessCount := 0
		// Rough count of all sessions
		uid, _ := c.Get(middleware.CtxUIDKey)
		if uidVal, ok := uid.(uint); ok {
			sessCount = len(hub.Sessions.ListByUser(uidVal))
		}

		c.JSON(http.StatusOK, gin.H{
			"code": 200,
			"data": gin.H{
				"active_users":   userCount,
				"active_clients": clientCount,
				"your_sessions":  sessCount,
				"mode":           "signal+session",
			},
		})
	}
}
