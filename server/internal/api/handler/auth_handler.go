package handler

import (
	"errors"
	"log"
	"net/http"

	"github.com/datouluobo/YiboFlow/server/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

// RegisterRequest represents the JSON payload for user registration
type RegisterRequest struct {
	Username     string `json:"username" binding:"required,min=3,max=50"`
	Password     string `json:"password" binding:"required,min=8"`
	KdfSalt      string `json:"kdf_salt" binding:"required"`
	PasswordHint string `json:"password_hint"`
}

// LoginRequest represents the JSON payload to login a user and register a device
type LoginRequest struct {
	Username          string `json:"username" binding:"required"`
	Password          string `json:"password" binding:"required"`
	DeviceName        string `json:"device_name" binding:"required"`
	DeviceType        string `json:"device_type" binding:"required"`
	DeviceFingerprint string `json:"device_fingerprint" binding:"required"`
}

// ChangePasswordRequest represents the JSON payload for user self password change
type ChangePasswordRequest struct {
	OldPassword     string `json:"old_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=8"`
	NewKdfSalt      string `json:"new_kdf_salt" binding:"required"`
	NewPasswordHint string `json:"new_password_hint"`
}

// GeneralResponse for standard JSON replies
type GeneralResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data any    `json:"data,omitempty"`
}

func formatValidationError(err error) string {
	var validationErrs validator.ValidationErrors
	if !errors.As(err, &validationErrs) {
		return "Invalid request payload. Please check the submitted fields and try again."
	}

	for _, fieldErr := range validationErrs {
		switch fieldErr.Field() {
		case "Username":
			switch fieldErr.Tag() {
			case "required":
				return "Username is required."
			case "min":
				return "Username must be at least 3 characters long."
			case "max":
				return "Username must be 50 characters or fewer."
			}
		case "Password":
			switch fieldErr.Tag() {
			case "required":
				return "Master password is required."
			case "min":
				return "Master password must be at least 8 characters long. Use a longer password to better protect your encrypted data."
			}
		case "KdfSalt":
			if fieldErr.Tag() == "required" {
				return "Missing key-derivation salt. Please retry the registration request."
			}
		case "DeviceName":
			if fieldErr.Tag() == "required" {
				return "Device name is required."
			}
		case "DeviceType":
			if fieldErr.Tag() == "required" {
				return "Device type is required."
			}
		case "DeviceFingerprint":
			if fieldErr.Tag() == "required" {
				return "Device fingerprint is required."
			}
		case "OldPassword":
			if fieldErr.Tag() == "required" {
				return "Current password is required."
			}
		case "NewPassword":
			switch fieldErr.Tag() {
			case "required":
				return "New password is required."
			case "min":
				return "New password must be at least 8 characters long."
			}
		case "NewKdfSalt":
			if fieldErr.Tag() == "required" {
				return "Missing new key-derivation salt."
			}
		}
	}

	return "Invalid request payload. Please check the submitted fields and try again."
}

// Register as a handler function for `POST /api/v1/user/register`
func Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: formatValidationError(err)})
		return
	}

	user, err := service.RegisterUser(req.Username, req.Password, req.KdfSalt, req.PasswordHint)
	if err != nil {
		if err == service.ErrUserAlreadyExists {
			c.JSON(http.StatusConflict, GeneralResponse{Code: 409, Msg: err.Error()})
			return
		}
		log.Printf("Registration Error: %v", err)
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Registration failed: " + err.Error()})
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
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: formatValidationError(err)})
		return
	}

	payload := service.LoginPayload{
		Username:          req.Username,
		Password:          req.Password,
		DeviceName:        req.DeviceName,
		DeviceType:        req.DeviceType,
		DeviceFingerprint: req.DeviceFingerprint,
	}

	res, fail, err := service.Authenticate(payload)
	if err != nil {
		if err == service.ErrAccountDisabled {
			c.JSON(http.StatusForbidden, GeneralResponse{Code: 403, Msg: "Account is disabled"})
			return
		}
		if err == service.ErrInvalidCredentials {
			data := gin.H{}
			if fail != nil {
				data["attempts"] = fail.Attempts
				if fail.PasswordHint != "" {
					data["password_hint"] = fail.PasswordHint
				}
			}
			c.JSON(http.StatusUnauthorized, GeneralResponse{Code: 401, Msg: err.Error(), Data: data})
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
			"device_id":     res.DeviceID,
			"username":      res.User.Username,
			"role":          res.User.Role,
			"kdf_salt":      res.User.KdfSalt,
			"access_token":  res.AccessToken,
			"refresh_token": res.RefreshToken,
		},
	})
}

// ChangePassword as a handler function for `PUT /api/v1/user/password`
func ChangePassword(c *gin.Context) {
	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: formatValidationError(err)})
		return
	}

	uidRaw, exists := c.Get("UID")
	if !exists {
		c.JSON(http.StatusUnauthorized, GeneralResponse{Code: 401, Msg: "Unauthorized"})
		return
	}
	uid := uidRaw.(uint)

	if err := service.ChangePassword(uid, req.OldPassword, req.NewPassword, req.NewKdfSalt, req.NewPasswordHint); err != nil {
		if err == service.ErrInvalidCredentials {
			c.JSON(http.StatusUnauthorized, GeneralResponse{Code: 401, Msg: "Current password is incorrect"})
			return
		}
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Failed to change password: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "Password changed successfully. All other sessions have been logged out.",
	})
}

// GetMe returns the current user's profile
func GetMe(c *gin.Context) {
	uidRaw, exists := c.Get("UID")
	if !exists {
		c.JSON(http.StatusUnauthorized, GeneralResponse{Code: 401, Msg: "Unauthorized"})
		return
	}
	uid := uidRaw.(uint)

	user, err := service.GetUserByID(uid)
	if err != nil || user == nil {
		c.JSON(http.StatusNotFound, GeneralResponse{Code: 404, Msg: "User not found"})
		return
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Msg:  "Success",
		Data: gin.H{
			"uid":      user.UID,
			"username": user.Username,
			"role":     user.Role,
			"status":   user.Status,
		},
	})
}
