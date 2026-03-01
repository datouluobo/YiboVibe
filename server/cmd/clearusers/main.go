package main

import (
	"log"

	"github.com/datouluobo/YiboFlow/server/internal/model"
	"github.com/datouluobo/YiboFlow/server/internal/pkg/config"
)

func main() {
	if err := config.InitDatabase(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	config.DB.Where("1 = 1").Delete(&model.User{})
	log.Println("All users deleted.")
}
