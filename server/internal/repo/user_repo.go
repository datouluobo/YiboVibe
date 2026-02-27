package repo

import (
	"errors"

	"github.com/datouluobo/YiboFlow/server/internal/model"
	"github.com/datouluobo/YiboFlow/server/internal/pkg/config"
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
