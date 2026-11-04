// Command seed creates a demo owner account and property for local development.
package main

import (
	"context"
	"fmt"
	"log"

	"golang.org/x/crypto/bcrypt"

	"github.com/guestly/backend/internal/config"
	"github.com/guestly/backend/internal/db"
)

const (
	demoEmail     = "owner@guestly.dev"
	demoPassword  = "guestly123"
	adminEmail    = "admin@guestly.dev"
	adminPassword = "guestly-admin"
)

func main() {
	ctx := context.Background()
	pool, err := db.Connect(ctx, config.Load().DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if err := db.Migrate(pool); err != nil {
		log.Fatal(err)
	}

	// Guestly platform admin (super admin console at /admin).
	adminHash, _ := bcrypt.GenerateFromPassword([]byte(adminPassword), bcrypt.DefaultCost)
	if _, err := pool.Exec(ctx, `INSERT INTO platform_admins (name, email, password_hash)
		SELECT 'Guestly Admin', $1, $2 WHERE NOT EXISTS (SELECT 1 FROM platform_admins WHERE email = $1)`,
		adminEmail, string(adminHash)); err != nil {
		log.Fatal(err)
	}
	fmt.Println("Super admin login:", adminEmail, "/", adminPassword)

	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE email = $1)`, demoEmail).Scan(&exists); err != nil {
		log.Fatal(err)
	}
	if exists {
		fmt.Println("Demo data already present. Login:", demoEmail, "/", demoPassword)
		return
	}

	hash, _ := bcrypt.GenerateFromPassword([]byte(demoPassword), bcrypt.DefaultCost)
	tx, err := pool.Begin(ctx)
	if err != nil {
		log.Fatal(err)
	}
	defer tx.Rollback(ctx)

	var orgID, propID string
	must(tx.QueryRow(ctx, `INSERT INTO organizations (name) VALUES ('Harbour Hospitality') RETURNING id`).Scan(&orgID))
	_, err = tx.Exec(ctx, `INSERT INTO users (organization_id, name, email, password_hash, role) VALUES ($1,'Demo Owner',$2,$3,'owner')`,
		orgID, demoEmail, string(hash))
	must(err)
	must(tx.QueryRow(ctx, `
		INSERT INTO properties (organization_id, name, address, city, state, pincode, phone, email, gstin, invoice_prefix)
		VALUES ($1, 'The Harbour House', '18 Marine Drive, Fort Kochi', 'Kochi', 'Kerala', '682001',
			'+91 98470 12345', 'stay@harbourhouse.in', '32ABCDE1234F1Z5', 'HH')
		RETURNING id`, orgID).Scan(&propID))

	types := map[string]string{}
	for _, t := range []struct {
		name, bed string
		rate      int64
		guests    int
	}{
		{"Standard", "Queen bed", 2200_00, 2},
		{"Deluxe", "Queen bed", 3500_00, 3},
		{"Suite", "King bed", 6500_00, 4},
	} {
		var id string
		must(tx.QueryRow(ctx, `INSERT INTO room_types (property_id, name, bed_type, base_rate, max_guests) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
			propID, t.name, t.bed, t.rate, t.guests).Scan(&id))
		types[t.name] = id
	}

	rooms := []struct {
		num, typ, status string
		floor            int
	}{
		{"101", "Deluxe", "ready", 1}, {"102", "Deluxe", "ready", 1}, {"103", "Standard", "ready", 1},
		{"104", "Standard", "ready", 1}, {"105", "Standard", "cleaning", 1},
		{"201", "Deluxe", "ready", 2}, {"202", "Deluxe", "ready", 2}, {"203", "Standard", "cleaning", 2},
		{"204", "Standard", "ready", 2}, {"205", "Standard", "maintenance", 2},
		{"301", "Suite", "ready", 3}, {"302", "Suite", "ready", 3}, {"303", "Deluxe", "ready", 3},
		{"304", "Deluxe", "cleaning", 3}, {"305", "Deluxe", "ready", 3},
	}
	for _, rm := range rooms {
		_, err := tx.Exec(ctx, `INSERT INTO rooms (property_id, room_type_id, number, floor, status) VALUES ($1,$2,$3,$4,$5)`,
			propID, types[rm.typ], rm.num, rm.floor, rm.status)
		must(err)
	}
	_, err = tx.Exec(ctx, `UPDATE organizations SET contact_name = 'Demo Owner', contact_phone = '+91 98470 12345',
		contact_email = $2 WHERE id = $1`, orgID, demoEmail)
	must(err)
	_, err = tx.Exec(ctx, `INSERT INTO subscriptions (property_id, plan, amount, period_months, is_trial, starts_on, ends_on)
		VALUES ($1, 'annual', 89900, 12, true, current_date, current_date + 13)`, propID)
	must(err)
	must(tx.Commit(ctx))
	fmt.Println("Seeded The Harbour House with 15 rooms. Login:", demoEmail, "/", demoPassword)
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
