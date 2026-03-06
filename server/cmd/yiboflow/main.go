package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/datouluobo/YiboFlow/server/internal/api/handler"
	"github.com/datouluobo/YiboFlow/server/internal/api/middleware"
	"github.com/datouluobo/YiboFlow/server/internal/model"
	"github.com/datouluobo/YiboFlow/server/internal/pkg/config"
	"github.com/datouluobo/YiboFlow/server/internal/ws"
)

func main() {
	log.Println("--- YiboFlow Server Start ---")

	// Initialize Database and Redis connections
	if err := config.InitDatabase(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	if err := config.InitRedis(); err != nil {
		log.Fatalf("Failed to initialize redis: %v", err)
	}

	// Auto-migrate standard schema if not mocked
	if config.DB != nil {
		err1 := config.DB.AutoMigrate(&model.User{})
		if err1 != nil {
			log.Fatalf("AutoMigrate User failed: %v", err1)
		}

		err2 := config.DB.AutoMigrate(&model.Device{})
		if err2 != nil {
			log.Fatalf("AutoMigrate Device failed: %v", err2)
		}
	}

	// Start the WebSocket Central Hub
	hub := ws.NewHub()
	go hub.Run()

	r := gin.Default()
	r.UseRawPath = true
	r.UnescapePathValues = false

	// Base API route
	api := r.Group("/api/v1")
	{
		api.GET("/ping", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"message": "pong",
				"version": "v1.4",
			})
		})

		userGrp := api.Group("/user")
		{
			userGrp.POST("/register", handler.Register)
			userGrp.POST("/login", handler.Login)
		}

		// Protected endpoints example
		protectedGrp := api.Group("/sync")
		if config.DB != nil {
			protectedGrp.Use(middleware.JWTAuth())
		}
		{
			// Try hitting this to verify your Bearer Token works!
			protectedGrp.GET("/me", func(c *gin.Context) {
				uid, _ := c.Get(middleware.CtxUIDKey)
				deviceID, _ := c.Get(middleware.CtxDeviceIDKey)

				c.JSON(http.StatusOK, handler.GeneralResponse{
					Code: 200,
					Msg:  "You have successfully reached a protected endpoint",
					Data: gin.H{
						"uid":       uid,
						"device_id": deviceID,
					},
				})
			})

			// Establish a WebSocket Connection
			protectedGrp.GET("/ws", handler.WsEndpoint(hub))

			// Handle E2EE large objects (e.g. image clips, files)
			protectedGrp.POST("/blob", handler.UploadBlob)
			protectedGrp.GET("/blob/:uuid", handler.DownloadBlob)

			// Query online devices
			protectedGrp.GET("/online", handler.GetOnlineDevices)
		}

		// Vault Advanced Sync Endpoint (Match client: /api/v1/vault/)
		vaultGrp := api.Group("/vault")
		if config.DB != nil {
			vaultGrp.Use(middleware.JWTAuth())
		}
		{
			vaultGrp.GET("/:filename", handler.DownloadVaultFile)
			vaultGrp.PUT("/:filename", handler.UploadVaultFile)
		}
	}

	// Read port from env or default to 8080
	port := "8080"
	log.Printf("Server listening on :%s", port)

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
