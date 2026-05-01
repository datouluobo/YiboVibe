package repo

import (
	"errors"
	"time"

	"github.com/datouluobo/YiboFlow/server/internal/model"
	"github.com/datouluobo/YiboFlow/server/internal/pkg/config"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UpsertDevice creates a new device or updates an existing one by device_fingerprint
func UpsertDevice(device *model.Device) error {
	now := time.Now()
	device.LastSeenAt = &now

	// Use GORM's clause for INSERT ... ON CONFLICT (Upsert)
	result := config.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "device_fingerprint"}},
		DoUpdates: clause.AssignmentColumns([]string{"device_name", "device_type", "refresh_token_hash", "last_seen_at"}),
	}).Create(device)

	return result.Error
}

// GetDeviceByFingerprint retrieves a device using its unique hardware fingerprint
func GetDeviceByFingerprint(fingerprint string) (*model.Device, error) {
	var device model.Device
	result := config.DB.Where("device_fingerprint = ?", fingerprint).First(&device)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, result.Error
	}
	return &device, nil
}

// GetDeviceByID retrieves a device by its primary ID
func GetDeviceByID(id uint) (*model.Device, error) {
	var device model.Device
	result := config.DB.First(&device, id)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil // Not found
		}
		return nil, result.Error
	}
	return &device, nil
}

// DeleteDevice removes a device by ID, usually triggered via remote logout
func DeleteDevice(id uint) error {
	result := config.DB.Delete(&model.Device{}, id)
	return result.Error
}

// GetDevicesByUID retrieves all active sessions/devices for a single user
func GetDevicesByUID(uid uint) ([]model.Device, error) {
	var devices []model.Device
	result := config.DB.Where("uid = ?", uid).Find(&devices)
	return devices, result.Error
}

// DeleteDevicesByUID removes all devices for a user
func DeleteDevicesByUID(uid uint) error {
	return config.DB.Where("uid = ?", uid).Delete(&model.Device{}).Error
}
