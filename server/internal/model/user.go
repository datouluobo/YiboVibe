package model

import (
	"time"
)

// User represents the users table in the database
type User struct {
	UID          uint      `gorm:"primaryKey;autoIncrement;column:uid" json:"uid"`
	Username     string    `gorm:"type:varchar(50);uniqueIndex;not null" json:"username"`
	PasswordHash string    `gorm:"type:text;not null" json:"-"`        // never return password hash in JSON
	KdfSalt      string    `gorm:"type:text;not null" json:"kdf_salt"` // Argon2id salt for deriving MK
	CreatedAt    time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt    time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updated_at"`

	// Relationships
	Devices []Device `gorm:"foreignKey:UID;references:UID;constraint:OnDelete:CASCADE" json:"devices,omitempty"`
}

// TableName overrides the table name used by User to `users`
func (User) TableName() string {
	return "users"
}
