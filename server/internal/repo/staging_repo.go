package repo

import (
	"errors"
	"time"

	"github.com/datouluobo/YiboVibe/server/internal/model"
	"github.com/datouluobo/YiboVibe/server/internal/pkg/config"
	"gorm.io/gorm"
)

func GetStagingPolicy() (*model.StagingPolicy, error) {
	var policy model.StagingPolicy
	result := config.DB.First(&policy, 1)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, result.Error
	}
	return &policy, nil
}

func SaveStagingPolicy(policy *model.StagingPolicy) error {
	return config.DB.Save(policy).Error
}

func CreateStagedObject(object *model.StagedObject) error {
	return config.DB.Create(object).Error
}

func GetStagedObjectByID(id string) (*model.StagedObject, error) {
	var object model.StagedObject
	result := config.DB.Where("id = ?", id).First(&object)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, result.Error
	}
	return &object, nil
}

func SaveStagedObject(object *model.StagedObject) error {
	return config.DB.Save(object).Error
}

func ListStagedObjectsByUID(uid uint) ([]model.StagedObject, error) {
	var objects []model.StagedObject
	result := config.DB.Where("uid = ?", uid).Order("created_at desc").Find(&objects)
	return objects, result.Error
}

func DeleteStagedObjectByIDAndUID(id string, uid uint) error {
	return config.DB.Where("id = ? AND uid = ?", id, uid).Delete(&model.StagedObject{}).Error
}

func FindLatestCompletedStagedObject(uid uint, kind, rootHash string, now time.Time) (*model.StagedObject, error) {
	var object model.StagedObject
	result := config.DB.
		Where("uid = ? AND kind = ? AND root_hash = ? AND status = ? AND expires_at > ?", uid, kind, rootHash, "completed", now).
		Order("created_at desc").
		First(&object)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, result.Error
	}
	return &object, nil
}

func SumActiveStagedBytesByUID(uid uint, now time.Time) (int64, error) {
	var total int64
	err := config.DB.Model(&model.StagedObject{}).
		Where("uid = ? AND status IN ? AND expires_at > ?", uid, []string{"uploading", "completed"}, now).
		Select("COALESCE(SUM(size_bytes), 0)").
		Scan(&total).Error
	return total, err
}

func ListExpiredStagedObjects(now time.Time) ([]model.StagedObject, error) {
	var objects []model.StagedObject
	result := config.DB.Where("expires_at <= ?", now).Find(&objects)
	return objects, result.Error
}

func UpdateUserFlowSyncStageDefaultTTL(uid uint, ttlSeconds int) error {
	return config.DB.Model(&model.User{}).
		Where("uid = ?", uid).
		Update("flow_sync_stage_default_ttl_seconds", ttlSeconds).
		Error
}

func CreateShareLink(link *model.ShareLink) error {
	return config.DB.Create(link).Error
}

func SaveShareLink(link *model.ShareLink) error {
	return config.DB.Save(link).Error
}

func ListShareLinksByUID(uid uint) ([]model.ShareLink, error) {
	var links []model.ShareLink
	result := config.DB.Where("uid = ?", uid).Order("created_at desc").Find(&links)
	return links, result.Error
}

func GetShareLinkByIDAndUID(id uint, uid uint) (*model.ShareLink, error) {
	var link model.ShareLink
	result := config.DB.Where("id = ? AND uid = ?", id, uid).First(&link)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, result.Error
	}
	return &link, nil
}

func GetShareLinkByTokenHash(tokenHash string) (*model.ShareLink, error) {
	var link model.ShareLink
	result := config.DB.Where("token_hash = ?", tokenHash).First(&link)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, result.Error
	}
	return &link, nil
}

func ListShareLinksByStageObjectID(stageObjectID string) ([]model.ShareLink, error) {
	var links []model.ShareLink
	result := config.DB.Where("stage_object_id = ?", stageObjectID).Find(&links)
	return links, result.Error
}
