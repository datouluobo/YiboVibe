package ws

import (
	"context"
	"fmt"
	"time"

	"github.com/datouluobo/YiboFlow/server/internal/pkg/config"
)

const (
	onlinePrefix = "device:online"
	ttlDuration  = 60 * time.Second
)

// MarkDeviceOnline sets a redis key with a TTL to indicate device is active
func MarkDeviceOnline(uid, deviceID uint) error {
	if config.RDB == nil {
		return nil // Mock Mode
	}

	ctx := context.Background()
	key := fmt.Sprintf("%s:%d:%d", onlinePrefix, uid, deviceID)

	// Value can just be timestamp of last seen
	return config.RDB.Set(ctx, key, time.Now().Unix(), ttlDuration).Err()
}

// MarkDeviceOffline explicitly removes the online key when connection cleanly drops
func MarkDeviceOffline(uid, deviceID uint) error {
	if config.RDB == nil {
		return nil // Mock Mode
	}

	ctx := context.Background()
	key := fmt.Sprintf("%s:%d:%d", onlinePrefix, uid, deviceID)

	return config.RDB.Del(ctx, key).Err()
}

// GetUserOnlineDevices returns a list of deviceIDs that are currently online for a given user
func GetUserOnlineDevices(uid uint) ([]uint, error) {
	if config.RDB == nil {
		return []uint{101}, nil // Mock Mode: always return dummy device 101 online
	}

	ctx := context.Background()
	pattern := fmt.Sprintf("%s:%d:*", onlinePrefix, uid)

	keys, err := config.RDB.Keys(ctx, pattern).Result()
	if err != nil {
		return nil, err
	}

	var onlineDeviceIDs []uint
	for _, k := range keys {
		var uidParsed, didParsed uint
		if _, err := fmt.Sscanf(k, onlinePrefix+":%d:%d", &uidParsed, &didParsed); err == nil {
			onlineDeviceIDs = append(onlineDeviceIDs, didParsed)
		}
	}

	return onlineDeviceIDs, nil
}
