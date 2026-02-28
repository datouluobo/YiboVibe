package handler

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

// ensure storage dir exists
var storageDir = filepath.Join(os.TempDir(), "yiboflow_blobs")

func init() {
	_ = os.MkdirAll(storageDir, 0755)
}

func generateUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func UploadBlob(c *gin.Context) {
	uuid := generateUUID()
	dst := filepath.Join(storageDir, uuid)

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
		Data: gin.H{"uuid": uuid},
	})
}

func DownloadBlob(c *gin.Context) {
	uuid := c.Param("uuid")
	if uuid == "" {
		c.JSON(http.StatusBadRequest, GeneralResponse{Code: 400, Msg: "UUID missing"})
		return
	}

	// Basic path traversal protection
	if filepath.Base(uuid) != uuid {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	dst := filepath.Join(storageDir, uuid)
	if _, err := os.Stat(dst); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, GeneralResponse{Code: 404, Msg: "Blob not found"})
		return
	}

	c.File(dst)
}
