package model

import "time"

type StagingPolicy struct {
	ID                        uint       `gorm:"primaryKey" json:"id"`
	StagingEnabled            bool       `gorm:"not null;default:true" json:"staging_enabled"`
	DefaultTTLSeconds         int        `gorm:"not null;default:86400" json:"default_ttl_seconds"`
	MaxTTLSeconds             int        `gorm:"not null;default:604800" json:"max_ttl_seconds"`
	MaxObjectSizeBytes        int64      `gorm:"not null;default:104857600" json:"max_object_size_bytes"`
	UserQuotaBytes            int64      `gorm:"not null;default:5368709120" json:"user_quota_bytes"`
	ExternalLinksEnabled      bool       `gorm:"not null;default:false" json:"external_links_enabled"`
	ExternalLinkMaxTTLSeconds int        `gorm:"not null;default:86400" json:"external_link_max_ttl_seconds"`
	GCIntervalSeconds         int        `gorm:"not null;default:3600" json:"gc_interval_seconds"`
	LastGCAt                  *time.Time `json:"last_gc_at,omitempty"`
	CreatedAt                 time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt                 time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updated_at"`
}

func (StagingPolicy) TableName() string {
	return "staging_policies"
}

type StagedObject struct {
	ID           string     `gorm:"primaryKey;type:varchar(64)" json:"id"`
	UID          uint       `gorm:"index;not null" json:"uid"`
	Kind         string     `gorm:"type:varchar(20);not null;index" json:"kind"`
	RootHash     string     `gorm:"type:varchar(128);not null;index" json:"root_hash"`
	Title        string     `gorm:"type:varchar(255);not null;default:''" json:"title"`
	ManifestJSON string     `gorm:"type:text" json:"manifest_json"`
	SizeBytes    int64      `gorm:"not null;default:0" json:"size_bytes"`
	ChunkCount   int        `gorm:"not null;default:1" json:"chunk_count"`
	TTLSeconds   int        `gorm:"not null" json:"ttl_seconds"`
	Status       string     `gorm:"type:varchar(20);not null;default:'uploading';index" json:"status"`
	StoragePath  string     `gorm:"type:text;not null" json:"storage_path"`
	ExpiresAt    time.Time  `gorm:"index;not null" json:"expires_at"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
	CreatedAt    time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt    time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updated_at"`
}

func (StagedObject) TableName() string {
	return "staged_objects"
}

type ShareLink struct {
	ID               uint       `gorm:"primaryKey" json:"id"`
	UID              uint       `gorm:"index;not null" json:"uid"`
	StageObjectID    string     `gorm:"type:varchar(64);index;not null" json:"stage_object_id"`
	Token            string     `gorm:"type:varchar(64);uniqueIndex;not null" json:"-"`
	TokenHash        string     `gorm:"type:varchar(64);uniqueIndex;not null" json:"-"`
	TokenPreview     string     `gorm:"type:varchar(32);not null" json:"token_preview"`
	Status           string     `gorm:"type:varchar(20);index;not null;default:'active'" json:"status"`
	TTLSeconds       int        `gorm:"not null" json:"ttl_seconds"`
	MaxDownloads     int        `gorm:"not null;default:0" json:"max_downloads"`
	DownloadCount    int        `gorm:"not null;default:0" json:"download_count"`
	LastDownloadedAt *time.Time `json:"last_downloaded_at,omitempty"`
	DisabledAt       *time.Time `json:"disabled_at,omitempty"`
	ExpiresAt        time.Time  `gorm:"index;not null" json:"expires_at"`
	CreatedAt        time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt        time.Time  `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updated_at"`
}

func (ShareLink) TableName() string {
	return "share_links"
}
