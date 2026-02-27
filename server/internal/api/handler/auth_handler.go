package handler

import (
	"net/http"

	"github.com/datouluobo/YiboFlow/server/internal/service"
	"github.com/gin-gonic/gin"
)

// RegisterRequest represents the JSON payload for user registration
type RegisterRequest struct {
	Username string `json:"username" binding:"required,min=3,max=50"`
	Password string `json:"password" binding:"required,min=8"`
	KdfSalt  string `json:"kdf_salt" binding:"required"` // The client generates Argon2id salt
}

// LoginRequest represents the JSON payload to login a user and register a device
type LoginRequest struct {
	Username          string `json:"username" binding:"required"`
	Password          string `json:"password" binding:"required"`
	DeviceName        string `json:"device_name" binding:"required"`
	DeviceType        string `json:"device_type" binding:"required"`
	DeviceFingerprint string `json:"device_fingerprint" binding:"required"`
}

// GeneralResponse for standard JSON replies
type GeneralResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data any    `json:"data,omitempty"`
}

// Register as a handler function for `POST /api/v1/user/register`
func Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid request paylaod: " + err.Error()})
		return
	}

	user, err := service.RegisterUser(req.Username, req.Password, req.KdfSalt)
	if err != nil {
		if err == service.ErrUserAlreadyExists {
			c.JSON(http.StatusConflict, GeneralResponse{Code: 409, Msg: err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Registration failed"})
		return
	}

	c.JSON(http.StatusCreated, GeneralResponse{
		Code: 201,
		Msg:  "User registered successfully",
		Data: gin.H{
			"uid":      user.UID,
			"username": user.Username,
		},
	})
}

// Login as a handler function for `POST /api/v1/user/login`
func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid request paylaod: " + err.Error()})
		return
	}

	payload := service.LoginPayload{
		Username:          req.Username,
		Password:          req.Password,
		DeviceName:        req.DeviceName,
		DeviceType:        req.DeviceType,
		DeviceFingerprint: req.DeviceFingerprint,
	}

	res, err := service.Authenticate(payload)
	if err != nil {
		if err == service.ErrInvalidCredentials {
			c.JSON(http.StatusUnauthorized, GeneralResponse{Code: 401, Msg: err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Login processing failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "Login successful",
		Data: gin.H{
			"uid":           res.User.UID,
			"username":      res.User.Username,
			"kdf_salt":      res.User.KdfSalt, // Crucial for client deriving MK later!
			"access_token":  res.AccessToken,
			"refresh_token": res.RefreshToken,
		},
	})
}
