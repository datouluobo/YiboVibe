package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/datouluobo/YiboFlow/server/internal/api/handler"
	"github.com/datouluobo/YiboFlow/server/internal/model"
	"github.com/datouluobo/YiboFlow/server/internal/pkg/config"
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

	// Auto-migrate standard schema
	config.AutoMigrate(
		&model.User{},
		&model.Device{},
	)

	r := gin.Default()

	// Base API route
	api := r.Group("/api/v1")
	{
		api.GET("/ping", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"message": "pong",
				"version": "v1.3",
			})
		})

		userGrp := api.Group("/user")
		{
			userGrp.POST("/register", handler.Register)
			userGrp.POST("/login", handler.Login)
		}
	}

	// Read port from env or default to 8080
	port := "8080"
	log.Printf("Server listening on :%s", port)

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
