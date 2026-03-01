package model

import (
	"time"
)

// Device represents the devices table, tracking client active sessions
type Device struct {
	ID                uint       `gorm:"primaryKey;autoIncrement" json:"id"`
	UID               uint       `gorm:"index;not null" json:"uid"`
	DeviceName        string     `gorm:"type:varchar(100);not null" json:"device_name"`            // E.g., "John's iPhone"
	DeviceType        string     `gorm:"type:varchar(20);not null" json:"device_type"`             // 'windows', 'ios', 'android'
	DeviceFingerprint string     `gorm:"type:text;uniqueIndex;not null" json:"device_fingerprint"` // Unique hardware identifier
	RefreshTokenHash  string     `gorm:"type:text" json:"-"`                                       // Hash of the actively issued refresh token
	LastSeenAt        *time.Time `gorm:"" json:"last_seen_at"`
	CreatedAt         time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`

	// Foreign Key Association handled by User
}

func (Device) TableName() string {
	return "devices"
}
