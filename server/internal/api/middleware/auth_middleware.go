package middleware

import (
	"net/http"
	"strings"

	"github.com/datouluobo/YiboFlow/server/internal/api/handler"
	"github.com/datouluobo/YiboFlow/server/internal/pkg/utils"
	"github.com/gin-gonic/gin"
)

const (
	authorizationHeader = "Authorization"
	bearerPrefix        = "Bearer "
	CtxUIDKey           = "UID"
	CtxDeviceIDKey      = "DeviceID"
)

// JWTAuth middleware ensures that a valid JWT Token is present in the Authorization header
func JWTAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader(authorizationHeader)
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, handler.GeneralResponse{
				Code: 401,
				Msg:  "Authorization header is missing",
			})
			return
		}

		if !strings.HasPrefix(authHeader, bearerPrefix) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, handler.GeneralResponse{
				Code: 401,
				Msg:  "Authorization header format must be Bearer {token}",
			})
			return
		}

		tokenString := strings.TrimPrefix(authHeader, bearerPrefix)

		claims, err := utils.ParseAccessToken(tokenString)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, handler.GeneralResponse{
				Code: 401,
				Msg:  "Invalid or expired access token: " + err.Error(),
			})
			return
		}

		// Set UID and DeviceID into gin.Context for subsequent handlers to use
		c.Set(CtxUIDKey, claims.UID)
		c.Set(CtxDeviceIDKey, claims.DeviceID)

		c.Next()
	}
}
