package config

import (
	"context"
	"log"
	"os"

	"github.com/redis/go-redis/v9"
)

var RDB *redis.Client

// InitRedis initializes the connection to Redis
func InitRedis() error {
	redisUrl := os.Getenv("REDIS_URL")
	if redisUrl == "" {
		redisUrl = "redis://:secret_redis_pass@localhost:6379/0"
	}

	opts, err := redis.ParseURL(redisUrl)
	if err != nil {
		log.Printf("Failed to parse Redis URL: %v\n", err)
		return err
	}

	rdb := redis.NewClient(opts)

	// Ensure connection is valid
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Printf("Failed to ping Redis server: %v\n", err)
		return err
	}

	log.Println("Successfully connected to Redis instance")
	RDB = rdb
	return nil
}
