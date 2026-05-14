package main

import (
	"flag"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"

	"github.com/datouluobo/YiboVibe/server/internal/api/handler"
	"github.com/datouluobo/YiboVibe/server/internal/api/middleware"
	"github.com/datouluobo/YiboVibe/server/internal/model"
	"github.com/datouluobo/YiboVibe/server/internal/pkg/config"
	"github.com/datouluobo/YiboVibe/server/internal/pkg/utils"
	"github.com/datouluobo/YiboVibe/server/internal/repo"
	"github.com/datouluobo/YiboVibe/server/internal/ws"
)

var (
	resetAdminUID = flag.Uint("reset-admin", 0, "UID of admin to reset password for (requires --new-pass)")
	newPass       = flag.String("new-pass", "", "New password for admin reset")
)

func main() {
	flag.Parse()
	log.Println("--- YiboVibe Server Start ---")

	// Initialize Database and Redis connections
	if err := config.InitDatabase(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	if err := config.InitRedis(); err != nil {
		log.Fatalf("Failed to initialize redis: %v", err)
	}

	// Auto-migrate standard schema if not mocked
	if config.DB != nil {
		if err := config.DB.AutoMigrate(&model.User{}); err != nil {
			log.Fatalf("AutoMigrate User failed: %v", err)
		}

		if err := config.DB.AutoMigrate(&model.Device{}); err != nil {
			log.Fatalf("AutoMigrate Device failed: %v", err)
		}
		if err := config.DB.AutoMigrate(&model.StagingPolicy{}); err != nil {
			log.Fatalf("AutoMigrate StagingPolicy failed: %v", err)
		}
		if err := config.DB.AutoMigrate(&model.StagedObject{}); err != nil {
			log.Fatalf("AutoMigrate StagedObject failed: %v", err)
		}
		if err := config.DB.AutoMigrate(&model.ShareLink{}); err != nil {
			log.Fatalf("AutoMigrate ShareLink failed: %v", err)
		}

		// Bootstrap admin: auto-promote earliest user if no admin exists
		bootstrapAdmin()

		// Handle admin password reset via CLI flags
		if *resetAdminUID > 0 && *newPass != "" {
			handleAdminReset(*resetAdminUID, *newPass)
			os.Exit(0)
		}
	}

	// Start the WebSocket Central Hub
	hub := ws.NewHub()
	go hub.Run()

	r := gin.Default()
	r.UseRawPath = true
	r.UnescapePathValues = false
	r.GET("/share/:token", handler.DownloadSharedObject)

	// Base API route
	api := r.Group("/api/v1")
	{
		api.GET("/ping", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"message": "pong",
				"version": "v2-signal",
			})
		})
		// ── Public auth endpoints ──
		userGrp := api.Group("/user")
		{
			userGrp.POST("/register", handler.Register)
			userGrp.POST("/login", handler.Login)
		}

		// ── Protected: user self-service ──
		protectedGrp := api.Group("/sync")
		if config.DB != nil {
			protectedGrp.Use(middleware.JWTAuth())
		}
		{
			protectedGrp.GET("/me", func(c *gin.Context) {
				uid, _ := c.Get(middleware.CtxUIDKey)
				deviceID, _ := c.Get(middleware.CtxDeviceIDKey)

				c.JSON(http.StatusOK, handler.GeneralResponse{
					Code: 200,
					Msg:  "You have successfully reached a protected endpoint",
					Data: gin.H{
						"uid":       uid,
						"device_id": deviceID,
					},
				})
			})

			protectedGrp.GET("/ws", handler.WsEndpoint(hub))
			protectedGrp.POST("/blob", handler.UploadBlob)
			protectedGrp.GET("/blob/:uuid", handler.DownloadBlob)
			protectedGrp.GET("/online", handler.GetOnlineDevices)
			protectedGrp.GET("/signal/diag", handler.GetSignalDiagnostics(hub))
			protectedGrp.GET("/signal/sessions", handler.ListSessions(hub))
			protectedGrp.GET("/signal/sessions/:id", handler.GetSession(hub))
			protectedGrp.GET("/devices", handler.ListDevices)
			protectedGrp.GET("/staging/policy", handler.GetStagingPolicy)
			protectedGrp.GET("/staging/preferences", handler.GetStagingPreferences)
			protectedGrp.PUT("/staging/preferences", handler.UpdateStagingPreferences)
			protectedGrp.POST("/staging/objects", handler.CreateStagedObject)
			protectedGrp.PUT("/staging/objects/:id/chunks", handler.UploadStagedObjectChunk)
			protectedGrp.POST("/staging/objects/:id/complete", handler.CompleteStagedObject)
			protectedGrp.GET("/staging/lookup", handler.LookupStagedObject)
			protectedGrp.GET("/staging/objects", handler.ListMyStagedObjects)
			protectedGrp.GET("/staging/objects/:id/content", handler.DownloadStagedObject)
			protectedGrp.DELETE("/staging/objects/:id", handler.DeleteMyStagedObject)
			protectedGrp.GET("/share-links", handler.ListMyShareLinks)
			protectedGrp.POST("/share-links", handler.CreateShareLink)
			protectedGrp.POST("/share-links/:id/disable", handler.DisableMyShareLink)
		}

		// ── Protected: user self-service (profile & password) ──
		selfGrp := api.Group("/user")
		if config.DB != nil {
			selfGrp.Use(middleware.JWTAuth())
		}
		{
			selfGrp.GET("/me", handler.GetMe)
			selfGrp.PUT("/password", handler.ChangePassword)
		}

		// ── Protected: Vault sync ──
		vaultGrp := api.Group("/vault")
		if config.DB != nil {
			vaultGrp.Use(middleware.JWTAuth())
		}
		{
			vaultGrp.GET("/:filename", handler.DownloadVaultFile)
			vaultGrp.PUT("/:filename", handler.UploadVaultFile)
		}

		// ── Protected: Admin endpoints ──
		adminGrp := api.Group("/admin")
		if config.DB != nil {
			adminGrp.Use(middleware.JWTAuth(), middleware.RequireAdmin())
		}
		{
			adminGrp.GET("/users", handler.AdminListUsers)
			adminGrp.PUT("/users/:uid/status", handler.AdminUpdateUserStatus)
			adminGrp.DELETE("/users/:uid", handler.AdminDeleteUser)
			adminGrp.POST("/users/:uid/reset-password", handler.AdminResetPassword)
			adminGrp.DELETE("/users/:uid/vault", handler.AdminDeleteUserVault)
			adminGrp.GET("/devices", handler.AdminListDevices)
			adminGrp.DELETE("/devices/:id", handler.AdminKickDevice)
			adminGrp.GET("/staging/policy", handler.GetStagingPolicy)
			adminGrp.PUT("/staging/policy", handler.UpdateStagingPolicy)
		}
	}

	// Read port from env or default to 11434 (aligned with user's NAS reverse proxy)
	port := os.Getenv("PORT")
	if port == "" {
		port = "11434"
	}
	log.Printf("Server listening on :%s", port)

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// bootstrapAdmin backfills an admin role for legacy databases that predate roles.
// If no admin exists yet, prefer the historical "admin" account and fall back to
// the earliest registered user only when that dedicated account is absent.
func bootstrapAdmin() {
	var count int64
	config.DB.Model(&model.User{}).Where("role = ?", "admin").Count(&count)
	if count > 0 {
		return
	}

	candidate, err := repo.GetUserByUsername("admin")
	if err != nil {
		log.Printf("Failed to inspect legacy admin account during bootstrap: %v", err)
		return
	}
	if candidate == nil {
		var oldest model.User
		result := config.DB.Order("created_at asc").First(&oldest)
		if result.Error != nil {
			log.Println("No users found, skipping admin bootstrap")
			return
		}
		candidate = &oldest
		log.Printf(
			"No dedicated legacy admin account found; falling back to earliest user '%s' (UID=%d)",
			candidate.Username,
			candidate.UID,
		)
	} else {
		log.Printf("Backfilling admin role for legacy account '%s' (UID=%d)", candidate.Username, candidate.UID)
	}

	if err := repo.UpdateUserRole(candidate.UID, "admin"); err != nil {
		log.Printf("Failed to promote user '%s' to admin: %v", candidate.Username, err)
		return
	}
	log.Printf("Auto-promoted user '%s' (UID=%d) to admin", candidate.Username, candidate.UID)
}

// handleAdminReset resets an admin's password and kicks all sessions (emergency recovery)
func handleAdminReset(uid uint, password string) {
	hash, err := utils.HashPassword(password)
	if err != nil {
		log.Fatalf("Failed to hash password: %v", err)
	}

	if err := repo.ResetUserPassword(uid, hash, ""); err != nil {
		log.Fatalf("Failed to reset password for UID=%d: %v", uid, err)
	}

	if err := repo.DeleteDevicesByUID(uid); err != nil {
		log.Printf("Warning: failed to clear devices for UID=%d: %v", uid, err)
	}

	log.Printf("Admin UID=%d password reset successfully. All sessions invalidated.", uid)
}
