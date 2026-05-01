package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/datouluobo/YiboFlow/server/internal/api/middleware"
	"github.com/datouluobo/YiboFlow/server/internal/service"
	"github.com/gin-gonic/gin"
)

// AdminListUsers returns all users with role and status
func AdminListUsers(c *gin.Context) {
	users, err := service.AdminGetAllUsers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Failed to list users: " + err.Error()})
		return
	}

	type UserInfo struct {
		UID       uint   `json:"uid"`
		Username  string `json:"username"`
		Role      string `json:"role"`
		Status    string `json:"status"`
		CreatedAt string `json:"created_at"`
	}

	var result []UserInfo
	for _, u := range users {
		result = append(result, UserInfo{
			UID:       u.UID,
			Username:  u.Username,
			Role:      u.Role,
			Status:    u.Status,
			CreatedAt: u.CreatedAt.Format("2006-01-02 15:04:05"),
		})
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "Success",
		Data: result,
	})
}

// AdminUpdateUserStatus enables or disables a user
func AdminUpdateUserStatus(c *gin.Context) {
	uid, err := strconv.ParseUint(c.Param("uid"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid user ID"})
		return
	}

	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Status is required (active/disabled)"})
		return
	}

	if err := service.AdminSetUserStatus(uint(uid), req.Status); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: err.Error()})
		return
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "User status updated",
	})
}

// AdminDeleteUser deletes a user and all associated data
func AdminDeleteUser(c *gin.Context) {
	uid, err := strconv.ParseUint(c.Param("uid"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid user ID"})
		return
	}

	// Prevent self-deletion
	callerUID, _ := c.Get(middleware.CtxUIDKey)
	if callerUID.(uint) == uint(uid) {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Cannot delete your own account"})
		return
	}

	if err := service.AdminDeleteUser(uint(uid)); err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Failed to delete user: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "User deleted successfully",
	})
}

// AdminResetPasswordRequest is the JSON payload for admin password reset
type AdminResetPasswordRequest struct {
	NewPassword     string `json:"new_password" binding:"required,min=8"`
	NewPasswordHint string `json:"new_password_hint"`
}

// AdminResetPassword resets a user's password (data will be unrecoverable via E2EE)
func AdminResetPassword(c *gin.Context) {
	uid, err := strconv.ParseUint(c.Param("uid"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid user ID"})
		return
	}

	var req AdminResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "New password is required (min 8 chars)"})
		return
	}

	if err := service.AdminResetPassword(uint(uid), req.NewPassword, req.NewPasswordHint); err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Failed to reset password: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "Password reset. All sessions invalidated. Synced data is now unrecoverable — the user must reconfigure from a client device.",
	})
}

// AdminListDevices returns all devices across all users
func AdminListDevices(c *gin.Context) {
	devices, users, err := service.AdminGetAllDevices()
	if err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Failed to list devices: " + err.Error()})
		return
	}

	userMap := make(map[uint]string)
	for _, u := range users {
		userMap[u.UID] = u.Username
	}

	type DeviceInfo struct {
		ID           uint   `json:"id"`
		UID          uint   `json:"uid"`
		Username     string `json:"username"`
		DeviceName   string `json:"device_name"`
		DeviceType   string `json:"device_type"`
		LastSeenAt   string `json:"last_seen_at"`
	}

	var result []DeviceInfo
	for _, d := range devices {
		lastSeen := ""
		if d.LastSeenAt != nil {
			lastSeen = d.LastSeenAt.Format("2006-01-02 15:04:05")
		}
		result = append(result, DeviceInfo{
			ID:         d.ID,
			UID:        d.UID,
			Username:   userMap[d.UID],
			DeviceName: d.DeviceName,
			DeviceType: d.DeviceType,
			LastSeenAt: lastSeen,
		})
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "Success",
		Data: result,
	})
}

// AdminKickDevice removes a specific device session
func AdminKickDevice(c *gin.Context) {
	deviceID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid device ID"})
		return
	}

	if err := service.AdminKickDevice(uint(deviceID)); err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Failed to kick device: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "Device session removed",
	})
}

// AdminDeleteUserVault deletes a user's vault data from disk
func AdminDeleteUserVault(c *gin.Context) {
	uid, err := strconv.ParseUint(c.Param("uid"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid user ID"})
		return
	}

	vaultDir := os.Getenv("VAULT_DATA_DIR")
	if vaultDir == "" {
		vaultDir = filepath.Join(os.TempDir(), "yiboflow_vault")
	}

	userVaultDir := filepath.Join(vaultDir, fmt.Sprintf("%d", uid))
	if err := os.RemoveAll(userVaultDir); err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Failed to delete vault data: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "Vault data deleted",
	})
}
