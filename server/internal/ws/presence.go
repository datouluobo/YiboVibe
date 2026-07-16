package ws

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/datouluobo/YiboVibe/server/internal/pkg/config"
)

const (
	onlinePrefix = "device:online"
	ttlDuration  = 300 * time.Second // 5 minutes; refreshed on every WS message
)

// MarkDeviceOnline sets a redis key with a TTL to indicate device is active
func MarkDeviceOnline(uid, deviceID uint) error {
	if config.RDB == nil {
		return nil // Mock Mode
	}

	ctx := context.Background()
	key := fmt.Sprintf("%s:%d:%d", onlinePrefix, uid, deviceID)

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

	var onlineDeviceIDs []uint
	var cursor uint64

	for {
		var keys []string
		var err error
		keys, cursor, err = config.RDB.Scan(ctx, cursor, pattern, 50).Result()
		if err != nil {
			return nil, err
		}

		for _, k := range keys {
			var uidParsed, didParsed uint
			if _, err := fmt.Sscanf(k, onlinePrefix+":%d:%d", &uidParsed, &didParsed); err == nil {
				onlineDeviceIDs = append(onlineDeviceIDs, didParsed)
			}
		}

		if cursor == 0 {
			break
		}
	}

	return onlineDeviceIDs, nil
}

// GetOnlineCount returns the number of online devices for a user (optimized)
func GetOnlineCount(uid uint) (int, error) {
	if config.RDB == nil {
		return 1, nil
	}

	ctx := context.Background()
	pattern := fmt.Sprintf("%s:%d:*", onlinePrefix, uid)

	count := 0
	var cursor uint64
	for {
		keys, nextCursor, err := config.RDB.Scan(ctx, cursor, pattern, 50).Result()
		if err != nil {
			return 0, err
		}
		count += len(keys)
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	return count, nil
}

// keep strconv import used
var _ = strconv.Atoi
