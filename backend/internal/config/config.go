// Package config loads runtime settings from environment variables.
package config

import (
	"os"
	"strings"
	"time"
)

type Config struct {
	Addr           string
	DatabaseURL    string
	JWTSecret      []byte
	AccessTTL      time.Duration
	RefreshTTL     time.Duration
	AllowedOrigins []string
	SecureCookies  bool
	AppURL         string // frontend origin, used to build invite links
	PublicAPIURL   string // used to build signed file URLs
	UploadDir      string
	DataKey        string // hex AES-256 key for guest ID data; required in production
	Production     bool
}

func Load() Config {
	return Config{
		Addr:           env("GUESTLY_ADDR", ":8085"),
		DatabaseURL:    env("DATABASE_URL", "postgres://guestly:guestly@localhost:5433/guestly?sslmode=disable"),
		JWTSecret:      []byte(env("JWT_SECRET", "dev-only-change-me-dev-only-change-me")),
		AccessTTL:      15 * time.Minute,
		RefreshTTL:     30 * 24 * time.Hour,
		AllowedOrigins: strings.Split(env("ALLOWED_ORIGINS", "http://localhost:5180,capacitor://localhost,https://localhost"), ","),
		SecureCookies:  env("SECURE_COOKIES", "false") == "true",
		AppURL:         env("APP_URL", "http://localhost:5180"),
		PublicAPIURL:   env("PUBLIC_API_URL", "http://localhost:8085/api/v1"),
		UploadDir:      env("UPLOAD_DIR", "var/uploads"),
		DataKey:        os.Getenv("DATA_KEY"),
		Production:     env("GUESTLY_ENV", "development") == "production",
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
