package handler

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/datouluobo/YiboVibe/server/internal/api/middleware"
	"github.com/datouluobo/YiboVibe/server/internal/model"
	"github.com/datouluobo/YiboVibe/server/internal/service"
	"github.com/gin-gonic/gin"
)

type CreateStagedObjectRequest struct {
	Kind         string `json:"kind" binding:"required"`
	RootHash     string `json:"root_hash" binding:"required"`
	Title        string `json:"title"`
	ManifestJSON string `json:"manifest_json"`
	SizeBytes    int64  `json:"size_bytes" binding:"required,min=0"`
	ChunkCount   int    `json:"chunk_count"`
	TTLSeconds   int    `json:"ttl_seconds"`
}

func respondStageError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrStagingDisabled):
		c.JSON(http.StatusForbidden, GeneralResponse{Code: 403, Msg: err.Error()})
	case errors.Is(err, service.ErrStageTTLTooLarge),
		errors.Is(err, service.ErrStageObjectTooLarge),
		errors.Is(err, service.ErrStageUserQuotaExceeded):
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: err.Error()})
	case errors.Is(err, service.ErrStageObjectNotFound):
		c.JSON(http.StatusNotFound, GeneralResponse{Code: 404, Msg: err.Error()})
	case errors.Is(err, service.ErrStageObjectExpired):
		c.JSON(http.StatusGone, GeneralResponse{Code: 410, Msg: err.Error()})
	case errors.Is(err, service.ErrStageObjectIncomplete):
		c.JSON(http.StatusConflict, GeneralResponse{Code: 409, Msg: err.Error()})
	case errors.Is(err, service.ErrShareLinksDisabled):
		c.JSON(http.StatusForbidden, GeneralResponse{Code: 403, Msg: err.Error()})
	case errors.Is(err, service.ErrShareLinkTTLTooLarge):
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: err.Error()})
	case errors.Is(err, service.ErrShareLinkNotFound):
		c.JSON(http.StatusNotFound, GeneralResponse{Code: 404, Msg: err.Error()})
	case errors.Is(err, service.ErrShareLinkExpired):
		c.JSON(http.StatusGone, GeneralResponse{Code: 410, Msg: err.Error()})
	case errors.Is(err, service.ErrShareLinkDisabled),
		errors.Is(err, service.ErrShareLinkLimitReached):
		c.JSON(http.StatusConflict, GeneralResponse{Code: 409, Msg: err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: err.Error()})
	}
}

func buildShareURL(c *gin.Context, token string) string {
	scheme := c.GetHeader("X-Forwarded-Proto")
	if scheme == "" {
		if c.Request.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return fmt.Sprintf("%s://%s/share/%s", scheme, c.Request.Host, token)
}

type CreateShareLinkRequest struct {
	StageObjectID string `json:"stage_object_id" binding:"required"`
	TTLSeconds    int    `json:"ttl_seconds"`
	MaxDownloads  int    `json:"max_downloads"`
}

func shareLinkResponse(c *gin.Context, link *model.ShareLink, token string) gin.H {
	return gin.H{
		"id":                 link.ID,
		"uid":                link.UID,
		"stage_object_id":    link.StageObjectID,
		"token_preview":      link.TokenPreview,
		"status":             link.Status,
		"ttl_seconds":        link.TTLSeconds,
		"max_downloads":      link.MaxDownloads,
		"download_count":     link.DownloadCount,
		"last_downloaded_at": link.LastDownloadedAt,
		"disabled_at":        link.DisabledAt,
		"expires_at":         link.ExpiresAt,
		"created_at":         link.CreatedAt,
		"updated_at":         link.UpdatedAt,
		"share_url":          buildShareURL(c, token),
	}
}

func GetStagingPolicy(c *gin.Context) {
	policy, err := service.GetStagingPolicy()
	if err != nil {
		respondStageError(c, err)
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Success", Data: policy})
}

func UpdateStagingPolicy(c *gin.Context) {
	var req model.StagingPolicy
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid staging policy payload"})
		return
	}
	policy, err := service.UpdateStagingPolicy(req)
	if err != nil {
		respondStageError(c, err)
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Policy updated", Data: policy})
}

func GetStagingPreferences(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	defaultTTL, err := service.GetUserStagingDefaultTTL(uid)
	if err != nil {
		respondStageError(c, err)
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Success", Data: gin.H{
		"default_ttl_seconds": defaultTTL,
	}})
}

func UpdateStagingPreferences(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	var req struct {
		DefaultTTLSeconds int `json:"default_ttl_seconds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid staging preferences payload"})
		return
	}
	if err := service.SetUserStagingDefaultTTL(uid, req.DefaultTTLSeconds); err != nil {
		respondStageError(c, err)
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Preferences updated", Data: gin.H{
		"default_ttl_seconds": req.DefaultTTLSeconds,
	}})
}

func CreateStagedObject(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	var req CreateStagedObjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid staged object payload"})
		return
	}
	object, err := service.CreateStagedObject(uid, req.Kind, req.RootHash, req.Title, req.ManifestJSON, req.SizeBytes, req.ChunkCount, req.TTLSeconds)
	if err != nil {
		respondStageError(c, err)
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Staged object created", Data: object})
}

func UploadStagedObjectChunk(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	stageID := c.Param("id")
	if stageID == "" {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Stage ID is required"})
		return
	}
	if _, err := strconv.Atoi(c.DefaultQuery("index", "0")); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Chunk index must be numeric"})
		return
	}
	object, written, err := service.AppendStagedObjectChunk(uid, stageID, c.Request.Body)
	if err != nil {
		respondStageError(c, err)
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Chunk uploaded", Data: gin.H{
		"id":            object.ID,
		"bytes_written": written,
		"status":        object.Status,
	}})
}

func CompleteStagedObject(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	stageID := c.Param("id")
	object, err := service.CompleteStagedObject(uid, stageID)
	if err != nil {
		respondStageError(c, err)
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Staged object completed", Data: object})
}

func LookupStagedObject(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	kind := c.Query("kind")
	rootHash := c.Query("root_hash")
	if kind == "" || rootHash == "" {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "kind and root_hash are required"})
		return
	}
	object, err := service.LookupStagedObject(uid, kind, rootHash)
	if err != nil {
		respondStageError(c, err)
		return
	}
	if object == nil {
		c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Not found", Data: nil})
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Success", Data: object})
}

func ListMyStagedObjects(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	objects, err := service.ListUserStagedObjects(uid)
	if err != nil {
		respondStageError(c, err)
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Success", Data: objects})
}

func DeleteMyStagedObject(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	stageID := c.Param("id")
	if err := service.DeleteUserStagedObject(uid, stageID); err != nil {
		respondStageError(c, err)
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Staged object deleted"})
}

func DownloadStagedObject(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	stageID := c.Param("id")
	object, err := service.GetStagedObjectContent(uid, stageID)
	if err != nil {
		respondStageError(c, err)
		return
	}
	if _, err := os.Stat(object.StoragePath); err != nil {
		c.JSON(http.StatusNotFound, GeneralResponse{Code: 404, Msg: "Staged payload is missing"})
		return
	}
	c.Header("Content-Type", "application/octet-stream")
	c.Header("X-YiboVibe-Stage-ID", object.ID)
	c.Header("X-YiboVibe-Stage-Kind", object.Kind)
	c.File(object.StoragePath)
}

func ListMyShareLinks(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	links, err := service.ListShareLinks(uid)
	if err != nil {
		respondStageError(c, err)
		return
	}
	response := make([]gin.H, 0, len(links))
	for _, link := range links {
		linkCopy := link
		response = append(response, shareLinkResponse(c, &linkCopy, link.Token))
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Success", Data: response})
}

func CreateShareLink(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	var req CreateShareLinkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid share-link payload"})
		return
	}
	link, token, err := service.CreateShareLink(uid, req.StageObjectID, req.TTLSeconds, req.MaxDownloads)
	if err != nil {
		respondStageError(c, err)
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Share link created", Data: shareLinkResponse(c, link, token)})
}

func DisableMyShareLink(c *gin.Context) {
	uid := c.MustGet(middleware.CtxUIDKey).(uint)
	linkID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Share link ID must be numeric"})
		return
	}
	link, err := service.DisableShareLink(uid, uint(linkID))
	if err != nil {
		respondStageError(c, err)
		return
	}
	c.JSON(http.StatusOK, GeneralResponse{Code: 200, Msg: "Share link disabled", Data: shareLinkResponse(c, link, link.Token)})
}

func DownloadSharedObject(c *gin.Context) {
	token := c.Param("token")
	link, object, err := service.ResolveShareLink(token)
	if err != nil {
		respondStageError(c, err)
		return
	}
	if _, err := os.Stat(object.StoragePath); err != nil {
		c.JSON(http.StatusNotFound, GeneralResponse{Code: 404, Msg: "Staged payload is missing"})
		return
	}
	fileName := filepath.Base(object.StoragePath)
	if object.Title != "" {
		fileName = object.Title
	}
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))
	c.Header("X-YiboVibe-Share-Link-ID", fmt.Sprintf("%d", link.ID))
	c.Header("X-YiboVibe-Stage-ID", object.ID)
	if err := service.MarkShareLinkDownloaded(link); err != nil {
		respondStageError(c, err)
		return
	}
	c.File(object.StoragePath)
}

