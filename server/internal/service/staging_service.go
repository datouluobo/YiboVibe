package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/datouluobo/YiboFlow/server/internal/model"
	"github.com/datouluobo/YiboFlow/server/internal/repo"
)

var (
	ErrStagingDisabled        = errors.New("NAS staging is currently disabled by administrator policy")
	ErrStageTTLTooLarge       = errors.New("requested TTL exceeds the administrator maximum")
	ErrStageObjectTooLarge    = errors.New("object exceeds the administrator size limit")
	ErrStageUserQuotaExceeded = errors.New("user staging quota exceeded")
	ErrStageObjectNotFound    = errors.New("staged object not found")
	ErrStageObjectExpired     = errors.New("staged object has expired")
	ErrStageObjectIncomplete  = errors.New("staged object is not ready yet")
	ErrShareLinksDisabled     = errors.New("external share links are currently disabled by administrator policy")
	ErrShareLinkTTLTooLarge   = errors.New("requested share-link TTL exceeds the administrator maximum")
	ErrShareLinkNotFound      = errors.New("share link not found")
	ErrShareLinkExpired       = errors.New("share link has expired")
	ErrShareLinkDisabled      = errors.New("share link has been disabled")
	ErrShareLinkLimitReached  = errors.New("share link has reached its download limit")
)

const (
	defaultStageTTLSeconds         = 24 * 60 * 60
	defaultStageMaxTTLSeconds      = 7 * 24 * 60 * 60
	defaultStageMaxObjectSizeBytes = 100 * 1024 * 1024
	defaultStageUserQuotaBytes     = 5 * 1024 * 1024 * 1024
	defaultStageGCIntervalSeconds  = 60 * 60
)

func ensureStagingPolicy() (*model.StagingPolicy, error) {
	policy, err := repo.GetStagingPolicy()
	if err != nil {
		return nil, err
	}
	if policy != nil {
		return policy, nil
	}
	policy = &model.StagingPolicy{
		ID:                        1,
		StagingEnabled:            true,
		DefaultTTLSeconds:         defaultStageTTLSeconds,
		MaxTTLSeconds:             defaultStageMaxTTLSeconds,
		MaxObjectSizeBytes:        defaultStageMaxObjectSizeBytes,
		UserQuotaBytes:            defaultStageUserQuotaBytes,
		ExternalLinksEnabled:      false,
		ExternalLinkMaxTTLSeconds: defaultStageTTLSeconds,
		GCIntervalSeconds:         defaultStageGCIntervalSeconds,
	}
	return policy, repo.SaveStagingPolicy(policy)
}

func GetStagingPolicy() (*model.StagingPolicy, error) {
	return ensureStagingPolicy()
}

func UpdateStagingPolicy(next model.StagingPolicy) (*model.StagingPolicy, error) {
	policy, err := ensureStagingPolicy()
	if err != nil {
		return nil, err
	}
	policy.StagingEnabled = next.StagingEnabled
	policy.DefaultTTLSeconds = next.DefaultTTLSeconds
	policy.MaxTTLSeconds = next.MaxTTLSeconds
	policy.MaxObjectSizeBytes = next.MaxObjectSizeBytes
	policy.UserQuotaBytes = next.UserQuotaBytes
	policy.ExternalLinksEnabled = next.ExternalLinksEnabled
	policy.ExternalLinkMaxTTLSeconds = next.ExternalLinkMaxTTLSeconds
	policy.GCIntervalSeconds = next.GCIntervalSeconds
	if policy.DefaultTTLSeconds <= 0 {
		policy.DefaultTTLSeconds = defaultStageTTLSeconds
	}
	if policy.MaxTTLSeconds < policy.DefaultTTLSeconds {
		policy.MaxTTLSeconds = policy.DefaultTTLSeconds
	}
	if policy.MaxObjectSizeBytes <= 0 {
		policy.MaxObjectSizeBytes = defaultStageMaxObjectSizeBytes
	}
	if policy.UserQuotaBytes <= 0 {
		policy.UserQuotaBytes = defaultStageUserQuotaBytes
	}
	if policy.ExternalLinkMaxTTLSeconds <= 0 {
		policy.ExternalLinkMaxTTLSeconds = policy.DefaultTTLSeconds
	}
	if policy.GCIntervalSeconds <= 0 {
		policy.GCIntervalSeconds = defaultStageGCIntervalSeconds
	}
	return policy, repo.SaveStagingPolicy(policy)
}

func GetUserStagingDefaultTTL(uid uint) (int, error) {
	user, err := repo.GetUserByID(uid)
	if err != nil {
		return 0, err
	}
	if user == nil {
		return 0, errors.New("user not found")
	}
	return user.FlowSyncStageDefaultTTLSeconds, nil
}

func SetUserStagingDefaultTTL(uid uint, ttlSeconds int) error {
	policy, err := ensureStagingPolicy()
	if err != nil {
		return err
	}
	if ttlSeconds < 0 {
		return errors.New("default TTL must be zero or a positive value")
	}
	if ttlSeconds > 0 && ttlSeconds > policy.MaxTTLSeconds {
		return ErrStageTTLTooLarge
	}
	return repo.UpdateUserFlowSyncStageDefaultTTL(uid, ttlSeconds)
}

func CreateStagedObject(uid uint, kind, rootHash, title, manifestJSON string, sizeBytes int64, chunkCount int, requestedTTLSeconds int) (*model.StagedObject, error) {
	if err := maybeRunStagingGC(); err != nil {
		return nil, err
	}
	policy, err := ensureStagingPolicy()
	if err != nil {
		return nil, err
	}
	if !policy.StagingEnabled {
		return nil, ErrStagingDisabled
	}
	if sizeBytes > policy.MaxObjectSizeBytes {
		return nil, ErrStageObjectTooLarge
	}
	if chunkCount <= 0 {
		chunkCount = 1
	}
	ttlSeconds := requestedTTLSeconds
	if ttlSeconds <= 0 {
		if userTTL, err := GetUserStagingDefaultTTL(uid); err == nil && userTTL > 0 {
			ttlSeconds = userTTL
		} else {
			ttlSeconds = policy.DefaultTTLSeconds
		}
	}
	if ttlSeconds > policy.MaxTTLSeconds {
		return nil, ErrStageTTLTooLarge
	}
	now := time.Now()
	usedBytes, err := repo.SumActiveStagedBytesByUID(uid, now)
	if err != nil {
		return nil, err
	}
	if usedBytes+sizeBytes > policy.UserQuotaBytes {
		return nil, ErrStageUserQuotaExceeded
	}
	stageID, err := generateStageID()
	if err != nil {
		return nil, err
	}
	stagingDir := resolveStagingDir()
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		return nil, err
	}
	storagePath := filepath.Join(stagingDir, stageID+".bin")
	file, err := os.Create(storagePath)
	if err != nil {
		return nil, err
	}
	_ = file.Close()
	object := &model.StagedObject{
		ID:           stageID,
		UID:          uid,
		Kind:         kind,
		RootHash:     rootHash,
		Title:        title,
		ManifestJSON: manifestJSON,
		SizeBytes:    sizeBytes,
		ChunkCount:   chunkCount,
		TTLSeconds:   ttlSeconds,
		Status:       "uploading",
		StoragePath:  storagePath,
		ExpiresAt:    now.Add(time.Duration(ttlSeconds) * time.Second),
	}
	return object, repo.CreateStagedObject(object)
}

func AppendStagedObjectChunk(uid uint, stageID string, body io.Reader) (*model.StagedObject, int64, error) {
	object, err := repo.GetStagedObjectByID(stageID)
	if err != nil {
		return nil, 0, err
	}
	if object == nil || object.UID != uid {
		return nil, 0, ErrStageObjectNotFound
	}
	if time.Now().After(object.ExpiresAt) {
		return nil, 0, ErrStageObjectExpired
	}
	if object.Status != "uploading" {
		return nil, 0, errors.New("staged object is not accepting new chunks")
	}
	file, err := os.OpenFile(object.StoragePath, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, 0, err
	}
	defer file.Close()
	written, err := io.Copy(file, body)
	if err != nil {
		return nil, 0, err
	}
	info, err := file.Stat()
	if err != nil {
		return nil, 0, err
	}
	if info.Size() > object.SizeBytes {
		return nil, 0, ErrStageObjectTooLarge
	}
	object.UpdatedAt = time.Now()
	if err := repo.SaveStagedObject(object); err != nil {
		return nil, 0, err
	}
	return object, written, nil
}

func CompleteStagedObject(uid uint, stageID string) (*model.StagedObject, error) {
	object, err := repo.GetStagedObjectByID(stageID)
	if err != nil {
		return nil, err
	}
	if object == nil || object.UID != uid {
		return nil, ErrStageObjectNotFound
	}
	if time.Now().After(object.ExpiresAt) {
		return nil, ErrStageObjectExpired
	}
	info, err := os.Stat(object.StoragePath)
	if err != nil {
		return nil, err
	}
	if info.Size() != object.SizeBytes {
		return nil, errors.New("uploaded size does not match the declared object size")
	}
	now := time.Now()
	object.Status = "completed"
	object.CompletedAt = &now
	object.UpdatedAt = now
	return object, repo.SaveStagedObject(object)
}

func LookupStagedObject(uid uint, kind, rootHash string) (*model.StagedObject, error) {
	if err := maybeRunStagingGC(); err != nil {
		return nil, err
	}
	return repo.FindLatestCompletedStagedObject(uid, kind, rootHash, time.Now())
}

func ListUserStagedObjects(uid uint) ([]model.StagedObject, error) {
	if err := maybeRunStagingGC(); err != nil {
		return nil, err
	}
	return repo.ListStagedObjectsByUID(uid)
}

func DeleteUserStagedObject(uid uint, stageID string) error {
	object, err := repo.GetStagedObjectByID(stageID)
	if err != nil {
		return err
	}
	if object == nil || object.UID != uid {
		return ErrStageObjectNotFound
	}
	if object.StoragePath != "" {
		_ = os.Remove(object.StoragePath)
	}
	links, err := repo.ListShareLinksByStageObjectID(stageID)
	if err != nil {
		return err
	}
	now := time.Now()
	for i := range links {
		links[i].Status = "disabled"
		links[i].DisabledAt = &now
		links[i].UpdatedAt = now
		if err := repo.SaveShareLink(&links[i]); err != nil {
			return err
		}
	}
	return repo.DeleteStagedObjectByIDAndUID(stageID, uid)
}

func GetStagedObjectContent(uid uint, stageID string) (*model.StagedObject, error) {
	if err := maybeRunStagingGC(); err != nil {
		return nil, err
	}
	object, err := repo.GetStagedObjectByID(stageID)
	if err != nil {
		return nil, err
	}
	if object == nil || object.UID != uid {
		return nil, ErrStageObjectNotFound
	}
	if time.Now().After(object.ExpiresAt) {
		return nil, ErrStageObjectExpired
	}
	if object.Status != "completed" {
		return nil, ErrStageObjectIncomplete
	}
	return object, nil
}

func CreateShareLink(uid uint, stageObjectID string, requestedTTLSeconds int, maxDownloads int) (*model.ShareLink, string, error) {
	if maxDownloads < 0 {
		return nil, "", errors.New("max downloads must be zero or a positive value")
	}
	policy, err := ensureStagingPolicy()
	if err != nil {
		return nil, "", err
	}
	if !policy.ExternalLinksEnabled {
		return nil, "", ErrShareLinksDisabled
	}
	object, err := GetStagedObjectContent(uid, stageObjectID)
	if err != nil {
		return nil, "", err
	}
	ttlSeconds := requestedTTLSeconds
	if ttlSeconds <= 0 {
		ttlSeconds = minPositiveInt(object.TTLSeconds, policy.ExternalLinkMaxTTLSeconds)
	}
	if ttlSeconds <= 0 {
		ttlSeconds = policy.ExternalLinkMaxTTLSeconds
	}
	if ttlSeconds > policy.ExternalLinkMaxTTLSeconds {
		return nil, "", ErrShareLinkTTLTooLarge
	}
	remaining := int(time.Until(object.ExpiresAt).Seconds())
	if remaining <= 0 {
		return nil, "", ErrStageObjectExpired
	}
	if ttlSeconds > remaining {
		ttlSeconds = remaining
	}
	token, err := generateOpaqueToken(24)
	if err != nil {
		return nil, "", err
	}
	now := time.Now()
	link := &model.ShareLink{
		UID:           uid,
		StageObjectID: object.ID,
		Token:         token,
		TokenHash:     hashOpaqueToken(token),
		TokenPreview:  previewOpaqueToken(token),
		Status:        "active",
		TTLSeconds:    ttlSeconds,
		MaxDownloads:  maxDownloads,
		ExpiresAt:     now.Add(time.Duration(ttlSeconds) * time.Second),
	}
	return link, token, repo.CreateShareLink(link)
}

func ListShareLinks(uid uint) ([]model.ShareLink, error) {
	links, err := repo.ListShareLinksByUID(uid)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	for i := range links {
		nextStatus := links[i].Status
		if now.After(links[i].ExpiresAt) {
			nextStatus = "expired"
		} else if links[i].MaxDownloads > 0 && links[i].DownloadCount >= links[i].MaxDownloads {
			nextStatus = "limit_reached"
		}
		if nextStatus != links[i].Status {
			links[i].Status = nextStatus
			links[i].UpdatedAt = now
			if err := repo.SaveShareLink(&links[i]); err != nil {
				return nil, err
			}
		}
	}
	return links, nil
}

func DisableShareLink(uid uint, linkID uint) (*model.ShareLink, error) {
	link, err := repo.GetShareLinkByIDAndUID(linkID, uid)
	if err != nil {
		return nil, err
	}
	if link == nil {
		return nil, ErrShareLinkNotFound
	}
	now := time.Now()
	link.Status = "disabled"
	link.DisabledAt = &now
	link.UpdatedAt = now
	return link, repo.SaveShareLink(link)
}

func ResolveShareLink(token string) (*model.ShareLink, *model.StagedObject, error) {
	if err := maybeRunStagingGC(); err != nil {
		return nil, nil, err
	}
	link, err := repo.GetShareLinkByTokenHash(hashOpaqueToken(token))
	if err != nil {
		return nil, nil, err
	}
	if link == nil {
		return nil, nil, ErrShareLinkNotFound
	}
	now := time.Now()
	if now.After(link.ExpiresAt) {
		link.Status = "expired"
		link.UpdatedAt = now
		_ = repo.SaveShareLink(link)
		return nil, nil, ErrShareLinkExpired
	}
	if link.Status == "disabled" {
		return nil, nil, ErrShareLinkDisabled
	}
	if link.MaxDownloads > 0 && link.DownloadCount >= link.MaxDownloads {
		link.Status = "limit_reached"
		link.UpdatedAt = now
		_ = repo.SaveShareLink(link)
		return nil, nil, ErrShareLinkLimitReached
	}
	object, err := repo.GetStagedObjectByID(link.StageObjectID)
	if err != nil {
		return nil, nil, err
	}
	if object == nil {
		return nil, nil, ErrStageObjectNotFound
	}
	if now.After(object.ExpiresAt) {
		return nil, nil, ErrStageObjectExpired
	}
	if object.Status != "completed" {
		return nil, nil, ErrStageObjectIncomplete
	}
	return link, object, nil
}

func MarkShareLinkDownloaded(link *model.ShareLink) error {
	now := time.Now()
	link.DownloadCount++
	link.LastDownloadedAt = &now
	link.UpdatedAt = now
	if link.MaxDownloads > 0 && link.DownloadCount >= link.MaxDownloads {
		link.Status = "limit_reached"
	}
	return repo.SaveShareLink(link)
}

func maybeRunStagingGC() error {
	policy, err := ensureStagingPolicy()
	if err != nil {
		return err
	}
	now := time.Now()
	if policy.LastGCAt != nil && now.Sub(*policy.LastGCAt) < time.Duration(policy.GCIntervalSeconds)*time.Second {
		return nil
	}
	expired, err := repo.ListExpiredStagedObjects(now)
	if err != nil {
		return err
	}
	for _, object := range expired {
		if object.StoragePath != "" {
			_ = os.Remove(object.StoragePath)
		}
		if err := repo.DeleteStagedObjectByIDAndUID(object.ID, object.UID); err != nil {
			return err
		}
	}
	policy.LastGCAt = &now
	return repo.SaveStagingPolicy(policy)
}

func resolveStagingDir() string {
	if v := os.Getenv("YIBOFLOW_STAGING_DIR"); v != "" {
		return v
	}
	return filepath.Join(os.TempDir(), "yiboflow_staging")
}

func generateStageID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func generateOpaqueToken(byteLen int) (string, error) {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func hashOpaqueToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func previewOpaqueToken(token string) string {
	if len(token) <= 12 {
		return token
	}
	return token[:6] + "..." + token[len(token)-6:]
}

func minPositiveInt(values ...int) int {
	best := 0
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if best == 0 || value < best {
			best = value
		}
	}
	return best
}
