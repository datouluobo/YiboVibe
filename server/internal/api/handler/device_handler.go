package handler

import (
	"net/http"
	"time"

	"github.com/datouluobo/YiboFlow/server/internal/api/middleware"
	"github.com/datouluobo/YiboFlow/server/internal/repo"
	"github.com/datouluobo/YiboFlow/server/internal/ws"
	"github.com/gin-gonic/gin"
)


// ListDevices handler returns a list of all devices associated with the user, indicating which are online.
func ListDevices(c *gin.Context) {
	var uid uint
	if uidAny, exists := c.Get(middleware.CtxUIDKey); exists {
		uid = uidAny.(uint)
	} else {
		uid = 1 // Mock User
	}

	// 1. Get all devices for this user
	allDevices, err := repo.GetDevicesByUID(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{
			Code: 500,
			Msg:  "Failed to query device list: " + err.Error(),
		})
		return
	}

	// 2. Get online device IDs from Redis
	onlineIDs, _ := ws.GetUserOnlineDevices(uid)

	// 3. Map to response structure
	type DeviceInfo struct {
		ID         uint      `json:"id"`
		Name       string    `json:"name"`
		Type       string    `json:"type"`
		IsOnline   bool      `json:"is_online"`
		LastSeenAt time.Time `json:"last_seen_at"`
	}

	var resData []DeviceInfo
	for _, d := range allDevices {
		isOnline := false
		for _, oid := range onlineIDs {
			if oid == d.ID {
				isOnline = true
				break
			}
		}

		resData = append(resData, DeviceInfo{
			ID:         d.ID,
			Name:       d.DeviceName,
			Type:       d.DeviceType,
			IsOnline:   isOnline,
			LastSeenAt: *d.LastSeenAt,
		})
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "Success",
		Data: resData,
	})
}

// GetOnlineDevices handler returns only a list of device IDs currently online.
func GetOnlineDevices(c *gin.Context) {
	var uid uint
	if uidAny, exists := c.Get(middleware.CtxUIDKey); exists {
		uid = uidAny.(uint)
	} else {
		uid = 1 // Mock User
	}

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
