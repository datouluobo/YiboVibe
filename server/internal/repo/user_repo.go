package repo

import (
	"errors"

	"github.com/datouluobo/YiboVibe/server/internal/model"
	"github.com/datouluobo/YiboVibe/server/internal/pkg/config"
	"gorm.io/gorm"
)

// CreateUser inserts a new user into the database
func CreateUser(user *model.User) error {
	result := config.DB.Create(user)
	return result.Error
}

// GetUserByUsername retrieves a user by their username
func GetUserByUsername(username string) (*model.User, error) {
	var user model.User
	result := config.DB.Where("username = ?", username).First(&user)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil // Not found
		}
		return nil, result.Error
	}
	return &user, nil
}

// GetUserByID retrieves a user by their UID
func GetUserByID(uid uint) (*model.User, error) {
	var user model.User
	result := config.DB.First(&user, uid)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, result.Error
	}
	return &user, nil
}

// ListUsers returns all users ordered by creation time
func ListUsers() ([]model.User, error) {
	var users []model.User
	result := config.DB.Order("created_at asc").Find(&users)
	return users, result.Error
}

// UpdateUserRole updates a user's role
func UpdateUserRole(uid uint, role string) error {
	return config.DB.Model(&model.User{}).Where("uid = ?", uid).Update("role", role).Error
}

// UpdateUserStatus updates a user's status
func UpdateUserStatus(uid uint, status string) error {
	return config.DB.Model(&model.User{}).Where("uid = ?", uid).Update("status", status).Error
}

// UpdateUserPassword updates a user's password hash, kdf salt and hint
func UpdateUserPassword(uid uint, passwordHash, kdfSalt, passwordHint string) error {
	return config.DB.Model(&model.User{}).Where("uid = ?", uid).Updates(map[string]interface{}{
		"password_hash": passwordHash,
		"kdf_salt":      kdfSalt,
		"password_hint": passwordHint,
	}).Error
}

// ResetUserPassword updates only password_hash and hint (admin reset, kdf_salt is meaningless)
func ResetUserPassword(uid uint, passwordHash, passwordHint string) error {
	return config.DB.Model(&model.User{}).Where("uid = ?", uid).Updates(map[string]interface{}{
		"password_hash": passwordHash,
		"password_hint": passwordHint,
	}).Error
}

// UpdatePasswordHint updates only the password hint
func UpdatePasswordHint(uid uint, hint string) error {
	return config.DB.Model(&model.User{}).Where("uid = ?", uid).Update("password_hint", hint).Error
}

// DeleteUser deletes a user by UID (Device cascade is handled by DB constraint)
func DeleteUser(uid uint) error {
	return config.DB.Delete(&model.User{}, uid).Error
}
