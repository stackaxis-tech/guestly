// Command createadmin creates (or resets the password of) a Guestly platform admin.
//
//	ADMIN_EMAIL=a@b.com ADMIN_PASSWORD=... ADMIN_NAME="Guestly Admin" createadmin
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"github.com/guestly/backend/internal/config"
	"github.com/guestly/backend/internal/db"
)

func main() {
	email := strings.ToLower(strings.TrimSpace(os.Getenv("ADMIN_EMAIL")))
	password := os.Getenv("ADMIN_PASSWORD")
	name := os.Getenv("ADMIN_NAME")
	if name == "" {
		name = "Guestly Admin"
	}
	if email == "" || len(password) < 12 {
		log.Fatal("set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters)")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, config.Load().DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if err := db.Migrate(pool); err != nil {
		log.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO platform_admins (name, email, password_hash) VALUES ($1, $2, $3)
		ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name`,
		name, email, string(hash))
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("Platform admin ready:", email)
}
