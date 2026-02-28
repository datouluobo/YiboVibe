package config

import (
	"log"
	"os"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// InitDatabase initializes the PostgreSQL connection using GORM
func InitDatabase() error {
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		// Fallback for local testing if env is not set
		dsn = "host=localhost user=yibo_admin password=secret_password dbname=yiboflow port=5432 sslmode=disable TimeZone=Asia/Shanghai"
	}

	if dsn == "mock" {
		log.Println("Running in DB MOCK mode. Bypassing PostgreSQL.")
		return nil
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})

	if err != nil {
		log.Printf("Failed to connect to database: %v\n", err)
		return err
	}

	log.Println("Successfully connected to PostgreSQL database")

	// Get generic database object sql.DB to use its functions
	sqlDB, err := db.DB()
	if err == nil {
		// SetMaxIdleConns sets the maximum number of connections in the idle connection pool.
		sqlDB.SetMaxIdleConns(10)
		// SetMaxOpenConns sets the maximum number of open connections to the database.
		sqlDB.SetMaxOpenConns(100)
	}

	DB = db
	return nil
}

// AutoMigrate migrates all the schemas
func AutoMigrate(models ...interface{}) error {
	log.Println("Running AutoMigrate for models...")
	return DB.AutoMigrate(models...)
}
