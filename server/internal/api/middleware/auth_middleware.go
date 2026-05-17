package middleware

import (
	"net/http"
	"strings"

	"github.com/datouluobo/YiboVibe/server/internal/pkg/utils"
	"github.com/gin-gonic/gin"
)

const (
	authorizationHeader = "Authorization"
	bearerPrefix        = "Bearer "
	queryTokenKey       = "token"
	CtxUIDKey           = "UID"
	CtxDeviceIDKey      = "DeviceID"
	CtxRoleKey          = "Role"
	CtxStatusKey        = "Status"
)

func extractAccessToken(c *gin.Context) (string, string) {
	authHeader := c.GetHeader(authorizationHeader)
	if authHeader != "" {
		if !strings.HasPrefix(authHeader, bearerPrefix) {
			return "", "Authorization header format must be Bearer {token}"
		}
		return strings.TrimPrefix(authHeader, bearerPrefix), ""
	}

	// WebSocket clients and browser-based debuggers commonly authenticate
	// the initial upgrade request via query string because setting headers
	// is not uniformly available across platforms.
	if token := strings.TrimSpace(c.Query(queryTokenKey)); token != "" {
		return token, ""
	}

	return "", "Authorization header is missing"
}

// JWTAuth middleware ensures that a valid JWT Token is present in the Authorization header
func JWTAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString, tokenErr := extractAccessToken(c)
		if tokenErr != "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code": 401,
				"msg":  tokenErr,
			})
			return
		}

		claims, err := utils.ParseAccessToken(tokenString)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code": 401,
				"msg":  "Invalid or expired access token: " + err.Error(),
			})
			return
		}

		// Set UID and DeviceID into gin.Context for subsequent handlers to use
		c.Set(CtxUIDKey, claims.UID)
		c.Set(CtxDeviceIDKey, claims.DeviceID)
		c.Set(CtxRoleKey, claims.Role)
		c.Set(CtxStatusKey, claims.Status)

		if claims.Status == "disabled" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"code": 403,
				"msg":  "Account is disabled",
			})
			return
		}

		c.Next()
	}
}

// RequireAdmin middleware ensures the authenticated user has the admin role
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get(CtxRoleKey)
		if !exists || role.(string) != "admin" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"code": 403,
				"msg":  "Admin access required",
			})
			return
		}
		c.Next()
	}
}
