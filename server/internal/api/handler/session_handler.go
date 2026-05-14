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
				"active_users":  userCount,
				"active_clients": clientCount,
				"your_sessions":  sessCount,
				"mode":          "signal+session",
			},
		})
	}
}

