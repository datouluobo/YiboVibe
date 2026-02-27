package service

import (
	"errors"

	"github.com/datouluobo/YiboFlow/server/internal/model"
	"github.com/datouluobo/YiboFlow/server/internal/pkg/utils"
	"github.com/datouluobo/YiboFlow/server/internal/repo"
)

var (
	ErrUserAlreadyExists  = errors.New("用户名已被占用")
	ErrInvalidCredentials = errors.New("用户名或密码错误")
)

// RegisterUser handles the business logic of creating a new user entity
func RegisterUser(username, password, kdfSalt string) (*model.User, error) {
	existing, _ := repo.GetUserByUsername(username)
	if existing != nil {
		return nil, ErrUserAlreadyExists
	}

	hash, err := utils.HashPassword(password)
	if err != nil {
		return nil, err
	}

	user := &model.User{
		Username:     username,
		PasswordHash: hash,
		KdfSalt:      kdfSalt, // Given from client gen
	}

	if err := repo.CreateUser(user); err != nil {
		return nil, err
	}

	return user, nil
}

// LoginPayload encapsulates the info a client must provide when authenticating
type LoginPayload struct {
	Username          string
	Password          string
	DeviceName        string
	DeviceType        string
	DeviceFingerprint string
}

// LoginResult encapsulates the tokens and user details needed to return
type LoginResult struct {
	User         *model.User
	AccessToken  string
	RefreshToken string
}

// Authenticate verifies credentials, registers/updates the device, and generates tokens.
func Authenticate(payload LoginPayload) (*LoginResult, error) {
	user, err := repo.GetUserByUsername(payload.Username)
	if err != nil || user == nil {
		return nil, ErrInvalidCredentials
	}

	if !utils.CheckPasswordHash(payload.Password, user.PasswordHash) {
		return nil, ErrInvalidCredentials
	}

	// Create or update device (Upsert) using fingerprint
	device := &model.Device{
		UID:               user.UID,
		DeviceName:        payload.DeviceName,
		DeviceType:        payload.DeviceType,
		DeviceFingerprint: payload.DeviceFingerprint,
	}

	// Issue a new random refresh token
	rawRefreshToken, err := utils.GenerateOpaqueToken()
	if err != nil {
		return nil, err
	}

	// We hash the refresh token so that DB compromisation doesn't reveal direct token values
	rtHash, err := utils.HashPassword(rawRefreshToken)
	if err != nil {
		return nil, err
	}
	device.RefreshTokenHash = rtHash

	if err := repo.UpsertDevice(device); err != nil {
		return nil, err
	}

	// Ensure we retrieve the latest ID from the DB if it was created
	// Since Upsert returns it mapped if auto increment
	latestDevice, err := repo.GetDeviceByFingerprint(payload.DeviceFingerprint)
	if err != nil || latestDevice == nil {
		return nil, errors.New("failed to retrieve device ID after upsert")
	}

	// Issue standard JWT access token with user sub & device scope
	accessToken, err := utils.GenerateAccessToken(user.UID, latestDevice.ID)
	if err != nil {
		return nil, err
	}

	return &LoginResult{
		User:         user,
		AccessToken:  accessToken,
		RefreshToken: rawRefreshToken, // Server only hashes it, client gets plain
	}, nil
}
