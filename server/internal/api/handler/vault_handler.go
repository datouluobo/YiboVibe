package handler

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"

	"github.com/datouluobo/YiboFlow/server/internal/api/middleware"
)

// Use a persistent storage path. In Docker, this maps to a volume mount.
// Falls back to temp dir if VAULT_DATA_DIR env is not set.
var vaultStorageDir = func() string {
	if dir := os.Getenv("VAULT_DATA_DIR"); dir != "" {
		return dir
	}
	return filepath.Join(os.TempDir(), "yiboflow_vault")
}()

func init() {
	_ = os.MkdirAll(vaultStorageDir, 0755)
}

func UploadVaultFile(c *gin.Context) {
	uidRaw, _ := c.Get(middleware.CtxUIDKey)
	uid := fmt.Sprintf("%v", uidRaw)
	if uid == "" || uid == "0" {
		c.JSON(http.StatusUnauthorized, GeneralResponse{Code: 401, Msg: "Unauthorized"})
		return
	}

	encodedFilename := c.Param("filename")
	filename, err := url.PathUnescape(encodedFilename)
	if err != nil {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Invalid filename encoding"})
		return
	}

	if filename == "" {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Filename missing"})
		return
	}

	userVaultDir := filepath.Join(vaultStorageDir, uid)
	if err := os.MkdirAll(userVaultDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Failed to create user vault directory"})
		return
	}

	dst := filepath.Join(userVaultDir, filename)

	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Failed to create subdirectory"})
		return
	}

	outFile, err := os.Create(dst)
	if err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Create failed"})
		return
	}
	defer outFile.Close()

	if _, err := io.Copy(outFile, c.Request.Body); err != nil {
		c.JSON(http.StatusInternalServerError, GeneralResponse{Code: 500, Msg: "Copy failed"})
		return
	}

	c.JSON(http.StatusOK, GeneralResponse{
		Code: 200,
		Data: gin.H{"status": "ok"},
	})
}

func DownloadVaultFile(c *gin.Context) {
	uidRaw, _ := c.Get(middleware.CtxUIDKey)
	uid := fmt.Sprintf("%v", uidRaw)
	if uid == "" || uid == "0" {
		c.JSON(http.StatusUnauthorized, GeneralResponse{Code: 401, Msg: "Unauthorized"})
		return
	}

	encodedFilename := c.Param("filename")
	filename, err := url.PathUnescape(encodedFilename)
	if err != nil || filename == "" {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "Filename missing or invalid"})
		return
	}

	userVaultDir := filepath.Join(vaultStorageDir, uid)
	dst := filepath.Join(userVaultDir, filename)

	if _, err := os.Stat(dst); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, GeneralResponse{Code: 404, Msg: "Vault file not found"})
		return
	}

	c.File(dst)
}
