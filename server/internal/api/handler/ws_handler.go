package handler

import (
	"github.com/datouluobo/YiboVibe/server/internal/api/middleware"
	"github.com/datouluobo/YiboVibe/server/internal/ws"
	"github.com/gin-gonic/gin"
)

// WsEndpoint is the handler required to establish websocket connection with authentication.
// It leverages gin's context to extract UID and DeviceID populated by the JWT middleware.
func WsEndpoint(hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		var uid, deviceID uint

		if uidAny, exists := c.Get(middleware.CtxUIDKey); exists {
			uid = uidAny.(uint)
		} else {
			uid = 1 // Mock User
		}

		if deviceIdAny, exists := c.Get(middleware.CtxDeviceIDKey); exists {
			deviceID = deviceIdAny.(uint)
		} else {
			deviceID = 101 // Mock Device
		}

		// Upgrade HTTP to WS and register client to the Hub
		ws.ServeWs(hub, c.Writer, c.Request, uid, deviceID)
	}
}
