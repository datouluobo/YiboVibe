package handler

import (
	"github.com/datouluobo/YiboFlow/server/internal/api/middleware"
	"github.com/datouluobo/YiboFlow/server/internal/ws"
	"github.com/gin-gonic/gin"
)

// WsEndpoint is the handler required to establish websocket connection with authentication.
// It leverages gin's context to extract UID and DeviceID populated by the JWT middleware.
func WsEndpoint(hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		uidAny, _ := c.Get(middleware.CtxUIDKey)
		deviceIdAny, _ := c.Get(middleware.CtxDeviceIDKey)

		uid := uidAny.(uint)
		deviceID := deviceIdAny.(uint)

		// Upgrade HTTP to WS and register client to the Hub
		ws.ServeWs(hub, c.Writer, c.Request, uid, deviceID)
	}
}
