package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	log.Println("--- YiboFlow Server Start ---")

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
	}

	// Read port from env or default to 8080
	port := "8080"
	log.Printf("Server listening on :%s", port)
	
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
