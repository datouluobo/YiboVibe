package service

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/datouluobo/YiboFlow/server/internal/model"
	"github.com/datouluobo/YiboFlow/server/internal/pkg/config"
	"github.com/datouluobo/YiboFlow/server/internal/pkg/utils"
	"github.com/datouluobo/YiboFlow/server/internal/repo"
)

var (
	ErrUserAlreadyExists  = errors.New("username already taken")
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrAccountDisabled    = errors.New("account is disabled")
)

const (
	loginFailPrefix    = "login_fail:"
	loginFailThreshold = 3
	loginFailTTL       = 30 * time.Minute
)

// ──────────────────── Login Fail Counter ────────────────────

func getLoginFailCount(username string) int {
	if config.RDB == nil {
		return 0
	}
	val, err := config.RDB.Get(context.Background(), loginFailPrefix+username).Result()
	if err != nil {
		return 0
	}
	count, _ := strconv.Atoi(val)
	return count
}

func incrLoginFailCount(username string) int {
	if config.RDB == nil {
		return 0
	}
	key := loginFailPrefix + username
	ctx := context.Background()
	count, _ := config.RDB.Incr(ctx, key).Result()
	config.RDB.Expire(ctx, key, loginFailTTL)
	return int(count)
}

func clearLoginFailCount(username string) {
	if config.RDB == nil {
		return
	}
	config.RDB.Del(context.Background(), loginFailPrefix+username)
}

// ──────────────────── Register ────────────────────

func RegisterUser(username, password, kdfSalt, passwordHint string) (*model.User, error) {
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
		KdfSalt:      kdfSalt,
		Role:         "user",
		Status:       "active",
		PasswordHint: passwordHint,
	}

	if err := repo.CreateUser(user); err != nil {
		return nil, err
	}

	return user, nil
}

// ──────────────────── Login ────────────────────

type LoginPayload struct {
	Username          string
	Password          string
	DeviceName        string
	DeviceType        string
	DeviceFingerprint string
}

type LoginResult struct {
	User         *model.User
	DeviceID     uint
	AccessToken  string
	RefreshToken string
}

type LoginFailResult struct {
	PasswordHint string
	Attempts     int
}

func Authenticate(payload LoginPayload) (*LoginResult, *LoginFailResult, error) {
	user, err := repo.GetUserByUsername(payload.Username)
	if err != nil || user == nil {
		count := incrLoginFailCount(payload.Username)
		return nil, &LoginFailResult{Attempts: count}, ErrInvalidCredentials
	}

	if user.Status == "disabled" {
		return nil, nil, ErrAccountDisabled
	}

	if !utils.CheckPasswordHash(payload.Password, user.PasswordHash) {
		count := incrLoginFailCount(payload.Username)
		fail := &LoginFailResult{Attempts: count}
		if count >= loginFailThreshold && user.PasswordHint != "" {
			fail.PasswordHint = user.PasswordHint
		}
		return nil, fail, ErrInvalidCredentials
	}

	// Password correct — clear fail counter
	clearLoginFailCount(payload.Username)

	device := &model.Device{
		UID:               user.UID,
		DeviceName:        payload.DeviceName,
		DeviceType:        payload.DeviceType,
		DeviceFingerprint: payload.DeviceFingerprint,
	}

	rawRefreshToken, err := utils.GenerateOpaqueToken()
	if err != nil {
		return nil, nil, err
	}

	rtHash, err := utils.HashPassword(rawRefreshToken)
	if err != nil {
		return nil, nil, err
	}
	device.RefreshTokenHash = rtHash

	if err := repo.UpsertDevice(device); err != nil {
		return nil, nil, err
	}

	latestDevice, err := repo.GetDeviceByFingerprint(payload.DeviceFingerprint)
	if err != nil || latestDevice == nil {
		return nil, nil, errors.New("failed to retrieve device ID after upsert")
	}

	accessToken, err := utils.GenerateAccessToken(user.UID, latestDevice.ID, user.Role, user.Status)
	if err != nil {
		return nil, nil, err
	}

	return &LoginResult{
		User:         user,
		DeviceID:     latestDevice.ID,
		AccessToken:  accessToken,
		RefreshToken: rawRefreshToken,
	}, nil, nil
}

// ──────────────────── Change Password ────────────────────

func ChangePassword(uid uint, oldPassword, newPassword, newKdfSalt, newHint string) error {
	user, err := repo.GetUserByID(uid)
	if err != nil || user == nil {
		return errors.New("user not found")
	}

	if !utils.CheckPasswordHash(oldPassword, user.PasswordHash) {
		return ErrInvalidCredentials
	}

	hash, err := utils.HashPassword(newPassword)
	if err != nil {
		return err
	}

	if err := repo.UpdateUserPassword(uid, hash, newKdfSalt, newHint); err != nil {
		return err
	}

	// Kick all other devices — force re-login with new password
	_ = repo.DeleteDevicesByUID(uid)

	return nil
}

// ──────────────────── User Profile ────────────────────

func GetUserByID(uid uint) (*model.User, error) {
	return repo.GetUserByID(uid)
}

// ──────────────────── Admin Operations ────────────────────

func AdminGetAllUsers() ([]model.User, error) {
	return repo.ListUsers()
}

func ensureProtectedAdminUserIsMutable(uid uint) error {
	user, err := repo.GetUserByID(uid)
	if err != nil {
		return err
	}
	if user == nil {
		return errors.New("user not found")
	}
	if user.Username == "admin" {
		return errors.New("admin account cannot be disabled or deleted")
	}
	return nil
}

func AdminSetUserStatus(uid uint, status string) error {
	if status != "active" && status != "disabled" {
		return errors.New("invalid status: must be 'active' or 'disabled'")
	}
	if err := ensureProtectedAdminUserIsMutable(uid); err != nil {
		return err
	}
	return repo.UpdateUserStatus(uid, status)
}

func AdminDeleteUser(uid uint) error {
	if err := ensureProtectedAdminUserIsMutable(uid); err != nil {
		return err
	}
	return repo.DeleteUser(uid)
}

func AdminResetPassword(uid uint, newPassword, newHint string) error {
	hash, err := utils.HashPassword(newPassword)
	if err != nil {
		return err
	}

	if err := repo.ResetUserPassword(uid, hash, newHint); err != nil {
		return err
	}

	_ = repo.DeleteDevicesByUID(uid)
	return nil
}

func AdminGetAllDevices() ([]model.Device, []model.User, error) {
	users, err := repo.ListUsers()
	if err != nil {
		return nil, nil, err
	}

	var allDevices []model.Device
	for _, u := range users {
		devices, err := repo.GetDevicesByUID(u.UID)
		if err != nil {
			continue
		}
		allDevices = append(allDevices, devices...)
	}

	return allDevices, users, nil
}

func AdminKickDevice(deviceID uint) error {
	return repo.DeleteDevice(deviceID)
}
