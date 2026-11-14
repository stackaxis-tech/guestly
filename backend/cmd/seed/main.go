// Command seed creates a demo owner account and property for local development.
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/guestly/backend/internal/config"
	"github.com/guestly/backend/internal/db"
	"github.com/guestly/backend/internal/property"
	"github.com/guestly/backend/internal/stay"
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

	// Gustlog platform admin (super admin console at /admin).
	adminHash, _ := bcrypt.GenerateFromPassword([]byte(adminPassword), bcrypt.DefaultCost)
	if _, err := pool.Exec(ctx, `INSERT INTO platform_admins (name, email, password_hash)
		SELECT 'Gustlog Admin', $1, $2 WHERE NOT EXISTS (SELECT 1 FROM platform_admins WHERE email = $1)`,
		adminEmail, string(adminHash)); err != nil {
		log.Fatal(err)
	}
	fmt.Println("Super admin login:", adminEmail, "/", adminPassword)

	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE email = $1)`, demoEmail).Scan(&exists); err != nil {
		log.Fatal(err)
	}
	if exists {
		seedInvoices(ctx, pool)
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
	seedInvoices(ctx, pool)
	fmt.Println("Seeded The Harbour House with 15 rooms. Login:", demoEmail, "/", demoPassword)
}

type demoCharge struct {
	desc  string
	qty   int
	price int64 // paise, before GST
}

type demoStay struct {
	guest, phone, address, room string
	rate                        int64
	nights, daysAgo             int
	foodPlan                    string
	billName, billGSTIN         string
	billAddress, billState      string
	charges                     []demoCharge
	dueRupees                   int64 // left unpaid, to show a balance
	mode                        string
}

// seedInvoices turns on GST for the demo hotel and adds three checked-out stays with invoices,
// so the invoice, print and WhatsApp screens have something to show. Safe to run again.
func seedInvoices(ctx context.Context, pool *pgxpool.Pool) {
	var propID string
	if err := pool.QueryRow(ctx, `SELECT id FROM properties WHERE name = 'The Harbour House' LIMIT 1`).Scan(&propID); err != nil {
		return
	}
	_, err := pool.Exec(ctx, `UPDATE properties SET gst_registered = true, legal_name = 'Harbour Hospitality Pvt Ltd',
		invoice_footer = 'Thank you for staying with us. We hope to welcome you again.' WHERE id = $1`, propID)
	must(err)
	var n int
	must(pool.QueryRow(ctx, `SELECT count(*) FROM invoices WHERE property_id = $1`, propID).Scan(&n))
	if n > 0 {
		return
	}

	h := &stay.Handler{DB: pool, AppURL: config.Load().AppURL}
	now := time.Now().In(property.IST)
	for _, d := range []demoStay{
		{guest: "Priya Nair", phone: "+919847012001", address: "12 Lake Road, Thrissur, Kerala", room: "101", rate: 3500_00,
			nights: 2, daysAgo: 1, foodPlan: "CP", mode: "upi",
			charges: []demoCharge{{"Breakfast", 2, 250_00}}},
		{guest: "Rahul Mehta", phone: "+919847012002", address: "Bandra West, Mumbai", room: "201", rate: 3500_00,
			nights: 3, daysAgo: 3, foodPlan: "MAP", mode: "bank",
			billName: "Northwind Traders Pvt Ltd", billGSTIN: "27AABCN1234F1Z5", billAddress: "Plot 4, Andheri East, Mumbai 400069", billState: "Maharashtra",
			charges: []demoCharge{{"Dinner", 3, 450_00}, {"Laundry", 1, 300_00}}},
		{guest: "Anita Roy", phone: "+919847012003", address: "Salt Lake, Kolkata", room: "301", rate: 8000_00,
			nights: 1, daysAgo: 0, foodPlan: "EP", mode: "cash", dueRupees: 2000,
			charges: []demoCharge{{"Airport pickup", 1, 1200_00}}},
	} {
		in := time.Date(now.Year(), now.Month(), now.Day()-d.daysAgo-d.nights, 14, 0, 0, 0, property.IST)
		out := in.AddDate(0, 0, d.nights).Add(-3 * time.Hour) // 11:00 on the last day
		if out.After(now) {
			out = now.Add(-time.Minute)
		}
		var guestID, roomID, stayID string
		must(pool.QueryRow(ctx, `INSERT INTO guests (property_id, name, phone, address, whatsapp_consent_at) VALUES ($1,$2,$3,$4,now()) RETURNING id`,
			propID, d.guest, d.phone, d.address).Scan(&guestID))
		must(pool.QueryRow(ctx, `SELECT id FROM rooms WHERE property_id = $1 AND number = $2`, propID, d.room).Scan(&roomID))
		must(pool.QueryRow(ctx, `
			INSERT INTO stays (property_id, room_id, guest_id, status, adults, nightly_rate, check_in_at, expected_check_out_at,
				checked_out_at, nights, food_plan, bill_to_name, bill_to_gstin, bill_to_address, bill_to_state)
			VALUES ($1,$2,$3,'checked_out',2,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
			propID, roomID, guestID, d.rate, in, out, d.nights, d.foodPlan, d.billName, d.billGSTIN, d.billAddress, d.billState).Scan(&stayID))

		roomBP := 500
		if d.rate > 7500_00 {
			roomBP = 1800
		}
		total := stay.MakeLine("room", d.nights, d.rate, roomBP).Total
		for _, c := range d.charges {
			_, err := pool.Exec(ctx, `INSERT INTO stay_charges (stay_id, description, quantity, unit_price, gst_rate, charged_on) VALUES ($1,$2,$3,$4,5,$5)`,
				stayID, c.desc, c.qty, c.price, in.Format("2006-01-02"))
			must(err)
			total += stay.MakeLine(c.desc, c.qty, c.price, 500).Total
		}
		if paid := total - d.dueRupees*100; paid > 0 {
			_, err := pool.Exec(ctx, `INSERT INTO stay_payments (stay_id, amount, mode, created_at) VALUES ($1,$2,$3,$4)`, stayID, paid, d.mode, out)
			must(err)
		}
		must(h.IssueInvoiceFor(ctx, propID, stayID))
	}
	fmt.Println("Added 3 demo invoices (Priya Nair, Rahul Mehta, Anita Roy). Open Guests → a guest → their stay → Invoice.")
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
