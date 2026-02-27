package handler

import (
	"net/http"

	"github.com/datouluobo/YiboFlow/server/internal/api/middleware"
	"github.com/datouluobo/YiboFlow/server/internal/ws"
	"github.com/gin-gonic/gin"
)

// GetOnlineDevices handler returns a list of device IDs belonging to the user that are currently online.
func GetOnlineDevices(c *gin.Context) {
	uidAny, _ := c.Get(middleware.CtxUIDKey)
	uid := uidAny.(uint)

	onlineDevices, err := ws.GetUserOnlineDevices(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{
			Code: 500,
			Msg:  "Failed to query online devices: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "Success",
		Data: gin.H{
			"online_devices": onlineDevices,
		},
	})
}
