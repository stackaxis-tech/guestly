package stay

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/guestly/backend/internal/auth"
	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/property"
)

// ---- Check-in ----

type guestInput struct {
	ID            string `json:"id"` // set for a returning guest
	Name          string `json:"name"`
	Phone         string `json:"phone"`
	Email         string `json:"email"`
	Nationality   string `json:"nationality"`
	Gender        string `json:"gender"`
	BirthYear     *int   `json:"birthYear"`
	Address       string `json:"address"`
	PhotoUploadID string `json:"photoUploadId"`
}

type documentInput struct {
	Type          string `json:"type"`
	Number        string `json:"number"`
	FrontUploadID string `json:"frontUploadId"`
	BackUploadID  string `json:"backUploadId"`
	VisaNumber    string `json:"visaNumber"`
	VisaExpiry    string `json:"visaExpiry"`
}

type companionInput struct {
	guestInput
	Document *documentInput `json:"document"`
}

type paymentInput struct {
	Amount    int64  `json:"amount"`
	Mode      string `json:"mode"`
	Reference string `json:"reference"`
}

type checkInReq struct {
	Guest              guestInput       `json:"guest"`
	Document           *documentInput   `json:"document"` // nil = reuse the guest's document on file
	Companions         []companionInput `json:"companions"`
	RoomID             string           `json:"roomId"`
	NightlyRate        int64            `json:"nightlyRate"`
	ExpectedCheckOutAt time.Time        `json:"expectedCheckOutAt"`
	Adults             int              `json:"adults"`
	Children           int              `json:"children"`
	Purpose            string           `json:"purpose"`
	ComingFrom         string           `json:"comingFrom"`
	GoingTo            string           `json:"goingTo"`
	Notes              string           `json:"notes"`
	Advance            *paymentInput    `json:"advance"`
	WhatsAppConsent    bool             `json:"whatsappConsent"`
	ReservationID      string           `json:"reservationId"` // set when arriving on a booking
}

var docTypes = map[string]bool{"aadhaar": true, "passport": true, "driving_licence": true, "voter_id": true, "other": true}
var payModes = map[string]bool{"cash": true, "upi": true, "card": true, "bank": true, "other": true}

func (g *guestInput) normalize(f map[string]string, prefix string) {
	g.Name = strings.Join(strings.Fields(g.Name), " ")
	g.Email = strings.ToLower(strings.TrimSpace(g.Email))
	g.Nationality = strings.ToUpper(strings.TrimSpace(g.Nationality))
	g.Address = strings.TrimSpace(g.Address)
	if g.Nationality == "" {
		g.Nationality = "IN"
	}
	if g.Name == "" {
		f[prefix+"name"] = "Enter the guest's full name."
	} else if utf8.RuneCountInString(g.Name) > 120 {
		f[prefix+"name"] = "Name is too long."
	}
	if raw := g.Phone; raw != "" {
		if g.Phone = NormalizePhone(raw); g.Phone == "" {
			f[prefix+"phone"] = "Enter a 10-digit mobile number, or + country code for foreign numbers."
		}
	}
	if g.Email != "" {
		if _, err := mail.ParseAddress(g.Email); err != nil {
			f[prefix+"email"] = "Enter a valid email."
		}
	}
	if len(g.Nationality) != 2 {
		f[prefix+"nationality"] = "Choose a nationality."
	}
	if g.BirthYear != nil && (*g.BirthYear < 1900 || *g.BirthYear > time.Now().Year()) {
		f[prefix+"birthYear"] = "Enter a valid year of birth."
	}
}

// normalize validates an ID document. For Aadhaar we keep only the last four digits.
func (d *documentInput) normalize(f map[string]string, prefix, nationality string) {
	d.Number = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(d.Number), " ", ""))
	d.VisaNumber = strings.ToUpper(strings.TrimSpace(d.VisaNumber))
	if !docTypes[d.Type] {
		f[prefix+"type"] = "Choose the ID type."
		return
	}
	if nationality != "IN" && d.Type != "passport" {
		f[prefix+"type"] = "Foreign guests must show a passport."
	}
	switch d.Type {
	case "aadhaar":
		n := nonDigits.ReplaceAllString(d.Number, "")
		switch {
		case n == "":
		case len(n) == 4:
		case len(n) == 12 && ValidAadhaar(n):
		default:
			f[prefix+"number"] = "Enter the 12-digit Aadhaar number (or just the last 4 digits)."
		}
		d.Number = n
	default:
		if len(d.Number) > 30 {
			f[prefix+"number"] = "ID number is too long."
		}
	}
	if d.FrontUploadID == "" {
		f[prefix+"frontUploadId"] = "Take a photo of the front of the ID."
	}
	if d.VisaExpiry != "" {
		if _, err := time.Parse("2006-01-02", d.VisaExpiry); err != nil {
			f[prefix+"visaExpiry"] = "Enter a valid date."
		}
	}
}

func last4(s string) string {
	if len(s) <= 4 {
		return s
	}
	return s[len(s)-4:]
}

func (h *Handler) saveGuest(ctx context.Context, tx pgx.Tx, propertyID string, g guestInput, consent *bool, field string) (id string, oldPhoto *string, err error) {
	photoKey, err := claimUpload(ctx, tx, propertyID, g.PhotoUploadID, "photo", field+"photoUploadId")
	if err != nil {
		return "", nil, err
	}
	var photo *string
	if photoKey != "" {
		photo = &photoKey
	}
	var consentExpr = "whatsapp_consent_at"
	if consent != nil && *consent {
		consentExpr = "coalesce(whatsapp_consent_at, now())"
	} else if consent != nil {
		consentExpr = "NULL"
	}
	if g.ID != "" {
		err = tx.QueryRow(ctx, `
			UPDATE guests g SET name=$3, phone=$4, email=$5, nationality=$6, gender=$7, birth_year=$8, address=$9,
				photo_key = coalesce($10, g.photo_key), whatsapp_consent_at = `+consentExpr+`, updated_at = now()
			FROM (SELECT photo_key FROM guests WHERE id::text = $1) prev
			WHERE g.id::text = $1 AND g.property_id = $2
			RETURNING g.id, CASE WHEN $10::text IS NOT NULL THEN prev.photo_key END`,
			g.ID, propertyID, g.Name, g.Phone, g.Email, g.Nationality, g.Gender, g.BirthYear, g.Address, photo).Scan(&id, &oldPhoto)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil, httpx.Invalid(map[string]string{field + "id": "This guest record no longer exists. Search again."})
		}
		return id, oldPhoto, err
	}
	consentAt := (*time.Time)(nil)
	if consent != nil && *consent {
		now := time.Now()
		consentAt = &now
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO guests (property_id, name, phone, email, nationality, gender, birth_year, address, photo_key, whatsapp_consent_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
		propertyID, g.Name, g.Phone, g.Email, g.Nationality, g.Gender, g.BirthYear, g.Address, photo, consentAt).Scan(&id)
	return id, nil, err
}

func (h *Handler) saveDocument(ctx context.Context, tx pgx.Tx, propertyID, guestID string, d documentInput, field string) error {
	front, err := claimUpload(ctx, tx, propertyID, d.FrontUploadID, "id_front", field+"frontUploadId")
	if err != nil {
		return err
	}
	back, err := claimUpload(ctx, tx, propertyID, d.BackUploadID, "id_back", field+"backUploadId")
	if err != nil {
		return err
	}
	var sealed []byte
	if d.Type != "aadhaar" { // Aadhaar: never store more than the last four digits
		sealed = h.Box.SealString(d.Number)
	}
	var visaExpiry *string
	if d.VisaExpiry != "" {
		visaExpiry = &d.VisaExpiry
	}
	nz := func(s string) *string {
		if s == "" {
			return nil
		}
		return &s
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO guest_documents (guest_id, doc_type, number_encrypted, number_last4, front_key, back_key,
			visa_number_encrypted, visa_expiry, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		guestID, d.Type, sealed, last4(d.Number), nz(front), nz(back), h.Box.SealString(d.VisaNumber), visaExpiry,
		auth.FromContext(ctx).UserID)
	return err
}

func (h *Handler) CheckIn(w http.ResponseWriter, r *http.Request) error {
	var req checkInReq
	if err := httpx.Decode(r, &req); err != nil {
		return err
	}
	ctx := r.Context()
	propertyID := property.ID(ctx)
	f := map[string]string{}
	req.Guest.normalize(f, "guest.")
	if req.Guest.Phone == "" && f["guest.phone"] == "" {
		f["guest.phone"] = "Enter the guest's mobile number."
	}
	if req.Document != nil {
		req.Document.normalize(f, "document.", req.Guest.Nationality)
	} else if req.Guest.ID == "" {
		f["document.type"] = "Add the guest's ID."
	}
	if len(req.Companions) > 19 {
		f["companions"] = "Too many companions."
	}
	for i := range req.Companions {
		c := &req.Companions[i]
		p := "companions." + strconv.Itoa(i) + "."
		c.normalize(f, p)
		if c.Document != nil {
			c.Document.normalize(f, p+"document.", c.Nationality)
		}
	}
	if req.Adults == 0 {
		req.Adults = 1 + len(req.Companions)
	}
	if req.Adults < 1 || req.Adults > 20 {
		f["adults"] = "Enter the number of adults."
	}
	if req.Children < 0 || req.Children > 20 {
		f["children"] = "Enter the number of children."
	}
	if req.NightlyRate < 0 {
		f["nightlyRate"] = "Rate can't be negative."
	}
	now := time.Now()
	if !req.ExpectedCheckOutAt.After(now) {
		f["expectedCheckOutAt"] = "Checkout must be in the future."
	} else if req.ExpectedCheckOutAt.After(now.AddDate(0, 6, 0)) {
		f["expectedCheckOutAt"] = "Stays can be up to 6 months. Extend later if needed."
	}
	if a := req.Advance; a != nil && a.Amount != 0 {
		a.Reference = strings.TrimSpace(a.Reference)
		if a.Amount < 0 {
			f["advance.amount"] = "Amount can't be negative."
		}
		if !payModes[a.Mode] {
			f["advance.mode"] = "Choose how they paid."
		}
	}
	if len(f) > 0 {
		return httpx.Invalid(f)
	}

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var roomStatus string
	err = tx.QueryRow(ctx, `SELECT status FROM rooms WHERE id::text = $1 AND property_id = $2 FOR UPDATE`, req.RoomID, propertyID).Scan(&roomStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.Invalid(map[string]string{"roomId": "Choose a room."})
	}
	if err != nil {
		return err
	}
	if roomStatus != "ready" {
		return httpx.Invalid(map[string]string{"roomId": "This room isn't ready (" + roomStatus + "). Choose another or mark it ready first."})
	}

	var reservedAdvance int64
	var reservedMode *string
	var reservedRef string
	if req.ReservationID != "" {
		if err := lockBooked(ctx, tx, req.ReservationID); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT advance_amount, advance_mode, advance_reference FROM reservations WHERE id::text = $1`,
			req.ReservationID).Scan(&reservedAdvance, &reservedMode, &reservedRef); err != nil {
			return err
		}
	}
	// A walk-in can't take a room that's promised to someone else on those nights.
	occupyFrom, occupyTo := stayRange(now, req.ExpectedCheckOutAt)
	if err := roomBookedError(ctx, tx, propertyID, req.RoomID, occupyFrom, occupyTo, req.ReservationID); err != nil {
		return err
	}

	consent := req.WhatsAppConsent
	guestID, oldPhoto, err := h.saveGuest(ctx, tx, propertyID, req.Guest, &consent, "guest.")
	if err != nil {
		return err
	}
	if req.Document != nil {
		if err := h.saveDocument(ctx, tx, propertyID, guestID, *req.Document, "document."); err != nil {
			return err
		}
	} else {
		var has bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM guest_documents WHERE guest_id = $1)`, guestID).Scan(&has); err != nil {
			return err
		}
		if !has {
			return httpx.Invalid(map[string]string{"document.type": "This guest has no ID on file. Add their ID."})
		}
	}

	var stayID string
	err = tx.QueryRow(ctx, `
		INSERT INTO stays (property_id, room_id, guest_id, adults, children, nightly_rate, check_in_at, expected_check_out_at,
			purpose, coming_from, going_to, notes, checked_in_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
		propertyID, req.RoomID, guestID, req.Adults, req.Children, req.NightlyRate, now, req.ExpectedCheckOutAt,
		strings.TrimSpace(req.Purpose), strings.TrimSpace(req.ComingFrom), strings.TrimSpace(req.GoingTo), strings.TrimSpace(req.Notes),
		auth.FromContext(ctx).UserID).Scan(&stayID)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return httpx.Conflict("Someone just checked a guest into this room. Choose another room.")
	}
	if err != nil {
		return err
	}

	for i, c := range req.Companions {
		p := "companions." + strconv.Itoa(i) + "."
		cid, _, err := h.saveGuest(ctx, tx, propertyID, c.guestInput, nil, p)
		if err != nil {
			return err
		}
		if c.Document != nil {
			if err := h.saveDocument(ctx, tx, propertyID, cid, *c.Document, p+"document."); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO stay_guests (stay_id, guest_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, stayID, cid); err != nil {
			return err
		}
	}

	if a := req.Advance; a != nil && a.Amount > 0 {
		if _, err := tx.Exec(ctx, `INSERT INTO stay_payments (stay_id, amount, mode, reference, is_advance, received_by) VALUES ($1,$2,$3,$4,true,$5)`,
			stayID, a.Amount, a.Mode, a.Reference, auth.FromContext(ctx).UserID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE rooms SET status = 'occupied', updated_at = now() WHERE id::text = $1`, req.RoomID); err != nil {
		return err
	}
	if req.ReservationID != "" {
		// The advance taken at booking becomes a payment on the stay exactly once.
		if reservedAdvance > 0 && reservedMode != nil {
			if _, err := tx.Exec(ctx, `INSERT INTO stay_payments (stay_id, amount, mode, reference, is_advance, received_by) VALUES ($1,$2,$3,$4,true,$5)`,
				stayID, reservedAdvance, *reservedMode, reservedRef, auth.FromContext(ctx).UserID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE reservations SET status='checked_in', stay_id=$2, updated_at=now() WHERE id::text = $1`, req.ReservationID, stayID); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if oldPhoto != nil {
		_ = h.Store.Delete(ctx, *oldPhoto)
	}
	d, err := h.loadStay(ctx, stayID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, d)
	return nil
}

// ---- Stay reads ----

type StaySummary struct {
	ID                 string     `json:"id"`
	Status             string     `json:"status"`
	RoomID             string     `json:"roomId"`
	RoomNumber         string     `json:"roomNumber"`
	RoomType           string     `json:"roomType"`
	GuestID            string     `json:"guestId"`
	GuestName          string     `json:"guestName"`
	GuestPhone         string     `json:"guestPhone"`
	Adults             int        `json:"adults"`
	Children           int        `json:"children"`
	NightlyRate        int64      `json:"nightlyRate"`
	CheckInAt          time.Time  `json:"checkInAt"`
	ExpectedCheckOutAt time.Time  `json:"expectedCheckOutAt"`
	CheckedOutAt       *time.Time `json:"checkedOutAt"`
	Nights             *int       `json:"nights"`
	Paid               int64      `json:"paid"`
}

const staySelect = `
	SELECT s.id, s.status, r.id, r.number, t.name, g.id, g.name, g.phone, s.adults, s.children, s.nightly_rate,
		s.check_in_at, s.expected_check_out_at, s.checked_out_at, s.nights,
		(SELECT coalesce(sum(amount), 0) FROM stay_payments p WHERE p.stay_id = s.id)
	FROM stays s JOIN rooms r ON r.id = s.room_id JOIN room_types t ON t.id = r.room_type_id JOIN guests g ON g.id = s.guest_id
	WHERE s.property_id = $1 AND `

func scanSummary(row pgx.Row) (StaySummary, error) {
	var s StaySummary
	err := row.Scan(&s.ID, &s.Status, &s.RoomID, &s.RoomNumber, &s.RoomType, &s.GuestID, &s.GuestName, &s.GuestPhone,
		&s.Adults, &s.Children, &s.NightlyRate, &s.CheckInAt, &s.ExpectedCheckOutAt, &s.CheckedOutAt, &s.Nights, &s.Paid)
	return s, err
}

func (h *Handler) listStays(ctx context.Context, where string, args ...any) ([]StaySummary, error) {
	rows, err := h.DB.Query(ctx, staySelect+where+` ORDER BY s.check_in_at DESC LIMIT 200`, append([]any{property.ID(ctx)}, args...)...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (StaySummary, error) { return scanSummary(row) })
}

func (h *Handler) ListStays(w http.ResponseWriter, r *http.Request) error {
	var out []StaySummary
	var err error
	switch r.URL.Query().Get("status") {
	case "", "in_house":
		out, err = h.listStays(r.Context(), `s.status = 'in_house'`)
	case "checked_out":
		out, err = h.listStays(r.Context(), `s.status = 'checked_out'`)
	default:
		return httpx.BadRequest("status must be in_house or checked_out")
	}
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

type Charge struct {
	ID          string    `json:"id"`
	Description string    `json:"description"`
	Quantity    int       `json:"quantity"`
	UnitPrice   int64     `json:"unitPrice"`
	GSTRate     float64   `json:"gstRate"`
	ChargedOn   time.Time `json:"chargedOn"`
}

type Payment struct {
	ID         string    `json:"id"`
	Amount     int64     `json:"amount"`
	Mode       string    `json:"mode"`
	Reference  string    `json:"reference"`
	IsAdvance  bool      `json:"isAdvance"`
	ReceivedBy string    `json:"receivedBy"`
	CreatedAt  time.Time `json:"createdAt"`
}

type MessageLog struct {
	Kind      string    `json:"kind"`
	Phone     string    `json:"phone"`
	Status    string    `json:"status"`
	UserName  string    `json:"userName"`
	CreatedAt time.Time `json:"createdAt"`
}

type StayDetail struct {
	StaySummary
	Purpose    string       `json:"purpose"`
	ComingFrom string       `json:"comingFrom"`
	GoingTo    string       `json:"goingTo"`
	Notes      string       `json:"notes"`
	Guest      Guest        `json:"guest"`
	Documents  []Document   `json:"documents"`
	Companions []Guest      `json:"companions"`
	Charges    []Charge     `json:"charges"`
	Payments   []Payment    `json:"payments"`
	Bill       Bill         `json:"bill"`
	Messages   []MessageLog `json:"messages"`
	FoodPlan   string       `json:"foodPlan"` // EP, CP, MAP or AP
	BillTo     BillTo       `json:"billTo"`   // empty name = bill the guest
	// InvoiceNumber is set once the invoice has been created at checkout.
	InvoiceNumber string `json:"invoiceNumber"`
}

// BillTo is who the invoice is addressed to when that isn't the guest (a company, usually).
type BillTo struct {
	Name    string `json:"name"`
	GSTIN   string `json:"gstin"`
	Address string `json:"address"`
	State   string `json:"state"`
}

func taxConfig(p property.Property) TaxConfig {
	bp := func(pct float64) int { return int(math.Round(pct * 100)) }
	return TaxConfig{Registered: p.FrontDesk.GSTRegistered, RoomThreshold: p.FrontDesk.RoomGSTThreshold,
		RoomLowBP: bp(p.FrontDesk.RoomGSTLow), RoomHighBP: bp(p.FrontDesk.RoomGSTHigh)}
}

func (h *Handler) loadProperty(ctx context.Context) (property.Property, error) {
	return property.Scan(h.DB.QueryRow(ctx, `SELECT `+property.Columns+property.From+`WHERE p.id = $1`, property.ID(ctx)), h.Signer)
}

func (h *Handler) loadStay(ctx context.Context, id string) (StayDetail, error) {
	var d StayDetail
	s, err := scanSummary(h.DB.QueryRow(ctx, staySelect+`s.id::text = $2`, property.ID(ctx), id))
	if errors.Is(err, pgx.ErrNoRows) {
		return d, httpx.NotFound("Stay not found.")
	}
	if err != nil {
		return d, err
	}
	d.StaySummary = s
	if err := h.DB.QueryRow(ctx, `SELECT purpose, coming_from, going_to, notes, food_plan, bill_to_name, bill_to_gstin, bill_to_address, bill_to_state
		FROM stays WHERE id = $1`, s.ID).
		Scan(&d.Purpose, &d.ComingFrom, &d.GoingTo, &d.Notes, &d.FoodPlan, &d.BillTo.Name, &d.BillTo.GSTIN, &d.BillTo.Address, &d.BillTo.State); err != nil {
		return d, err
	}
	if err := h.DB.QueryRow(ctx, `SELECT number FROM invoices WHERE stay_id = $1`, s.ID).Scan(&d.InvoiceNumber); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return d, err
	}
	if d.Guest, err = h.loadGuest(ctx, s.GuestID); err != nil {
		return d, err
	}
	if d.Documents, err = h.documents(ctx, s.GuestID); err != nil {
		return d, err
	}
	rows, err := h.DB.Query(ctx, `SELECT `+guestColumns+` FROM guests g JOIN stay_guests sg ON sg.guest_id = g.id WHERE sg.stay_id = $1 ORDER BY g.name`, s.ID)
	if err != nil {
		return d, err
	}
	if d.Companions, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Guest, error) { return scanGuest(row) }); err != nil {
		return d, err
	}
	rows, err = h.DB.Query(ctx, `SELECT id, description, quantity, unit_price, gst_rate::float8, charged_on FROM stay_charges WHERE stay_id = $1 ORDER BY charged_on, created_at`, s.ID)
	if err != nil {
		return d, err
	}
	if d.Charges, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Charge, error) {
		var c Charge
		err := row.Scan(&c.ID, &c.Description, &c.Quantity, &c.UnitPrice, &c.GSTRate, &c.ChargedOn)
		return c, err
	}); err != nil {
		return d, err
	}
	rows, err = h.DB.Query(ctx, `
		SELECT p.id, p.amount, p.mode, p.reference, p.is_advance, coalesce(u.name, ''), p.created_at
		FROM stay_payments p LEFT JOIN users u ON u.id = p.received_by WHERE p.stay_id = $1 ORDER BY p.created_at`, s.ID)
	if err != nil {
		return d, err
	}
	if d.Payments, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Payment, error) {
		var p Payment
		err := row.Scan(&p.ID, &p.Amount, &p.Mode, &p.Reference, &p.IsAdvance, &p.ReceivedBy, &p.CreatedAt)
		return p, err
	}); err != nil {
		return d, err
	}
	rows, err = h.DB.Query(ctx, `
		SELECT m.kind, m.phone, m.status, coalesce(u.name, ''), m.created_at
		FROM message_log m LEFT JOIN users u ON u.id = m.user_id WHERE m.stay_id = $1 ORDER BY m.created_at DESC`, s.ID)
	if err != nil {
		return d, err
	}
	if d.Messages, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (MessageLog, error) {
		var m MessageLog
		err := row.Scan(&m.Kind, &m.Phone, &m.Status, &m.UserName, &m.CreatedAt)
		return m, err
	}); err != nil {
		return d, err
	}
	prop, err := h.loadProperty(ctx)
	if err != nil {
		return d, err
	}
	d.Bill = computeBill(d, taxConfig(prop), time.Now())
	return d, nil
}

// computeBill builds the bill. While in-house, nights are estimated from the
// later of now and the expected checkout.
func computeBill(d StayDetail, tax TaxConfig, now time.Time) Bill {
	var nights int
	estimate := d.Status == "in_house"
	if d.Nights != nil {
		nights = *d.Nights
	} else {
		end := d.ExpectedCheckOutAt
		if now.After(end) {
			end = now
		}
		nights = Nights(d.CheckInAt, end, property.IST)
	}
	label := "Room " + d.RoomNumber + " · " + d.RoomType + " · " + strconv.Itoa(nights) + " night"
	if nights != 1 {
		label += "s"
	}
	lines := []Line{MakeLine(label, nights, d.NightlyRate, tax.RoomRateBP(d.NightlyRate))}
	for _, c := range d.Charges {
		l := MakeLine(c.Description, c.Quantity, c.UnitPrice, int(math.Round(c.GSTRate*100)))
		l.ChargeID = c.ID
		lines = append(lines, l)
	}
	return Summarize(lines, d.Paid, nights, estimate)
}

// CheckoutPreview returns the bill as it would be if the guest checked out now
// (actual nights, not the booked estimate), so staff collect the right amount.
func (h *Handler) CheckoutPreview(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	d, err := h.loadStay(ctx, chi.URLParam(r, "stayID"))
	if err != nil {
		return err
	}
	if d.Status != "in_house" {
		return httpx.Conflict("This guest has already checked out.")
	}
	prop, err := h.loadProperty(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	n := Nights(d.CheckInAt, now, property.IST)
	d.Nights = &n
	d.Status = "checked_out" // compute as final
	bill := computeBill(d, taxConfig(prop), now)
	httpx.JSON(w, http.StatusOK, bill)
	return nil
}

func (h *Handler) GetStay(w http.ResponseWriter, r *http.Request) error {
	d, err := h.loadStay(r.Context(), chi.URLParam(r, "stayID"))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, d)
	return nil
}

// lockStay locks an in-house stay row for update within tx.
func lockStay(ctx context.Context, tx pgx.Tx, id string, statuses ...string) (roomID, status string, err error) {
	err = tx.QueryRow(ctx, `SELECT room_id, status FROM stays WHERE id::text = $1 AND property_id = $2 FOR UPDATE`, id, property.ID(ctx)).Scan(&roomID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", httpx.NotFound("Stay not found.")
	}
	if err != nil {
		return "", "", err
	}
	for _, s := range statuses {
		if s == status {
			return roomID, status, nil
		}
	}
	if status == "checked_out" {
		return "", "", httpx.Conflict("This guest has already checked out.")
	}
	return "", "", httpx.Conflict("This stay was cancelled.")
}

func (h *Handler) respondStay(w http.ResponseWriter, r *http.Request, id string, status int) error {
	d, err := h.loadStay(r.Context(), id)
	if err != nil {
		return err
	}
	httpx.JSON(w, status, d)
	return nil
}

// ---- Stay updates ----

type updateReq struct {
	ExpectedCheckOutAt time.Time `json:"expectedCheckOutAt"`
	NightlyRate        int64     `json:"nightlyRate"`
	Adults             int       `json:"adults"`
	Children           int       `json:"children"`
	Notes              string    `json:"notes"`
}

func (h *Handler) UpdateStay(w http.ResponseWriter, r *http.Request) error {
	var in updateReq
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	f := map[string]string{}
	if in.NightlyRate < 0 {
		f["nightlyRate"] = "Rate can't be negative."
	}
	if in.Adults < 1 || in.Adults > 20 {
		f["adults"] = "Enter the number of adults."
	}
	if in.Children < 0 || in.Children > 20 {
		f["children"] = "Enter the number of children."
	}
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	ctx := r.Context()
	id := chi.URLParam(r, "stayID")
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, _, err := lockStay(ctx, tx, id, "in_house"); err != nil {
		return err
	}
	var checkIn time.Time
	if err := tx.QueryRow(ctx, `SELECT check_in_at FROM stays WHERE id::text = $1`, id).Scan(&checkIn); err != nil {
		return err
	}
	if !in.ExpectedCheckOutAt.After(checkIn) {
		return httpx.Invalid(map[string]string{"expectedCheckOutAt": "Checkout must be after check-in."})
	}
	// Extending a stay can't run into someone else's booking.
	var roomID string
	if err := tx.QueryRow(ctx, `SELECT room_id FROM stays WHERE id::text = $1`, id).Scan(&roomID); err != nil {
		return err
	}
	from, to := stayRange(time.Now(), in.ExpectedCheckOutAt)
	if err := roomBookedError(ctx, tx, property.ID(ctx), roomID, from, to, ""); err != nil {
		var apiErr *httpx.Error
		if errors.As(err, &apiErr) && apiErr.Fields != nil {
			return httpx.Invalid(map[string]string{"expectedCheckOutAt": apiErr.Fields["roomId"]})
		}
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE stays SET expected_check_out_at=$2, nightly_rate=$3, adults=$4, children=$5, notes=$6 WHERE id::text = $1`,
		id, in.ExpectedCheckOutAt, in.NightlyRate, in.Adults, in.Children, strings.TrimSpace(in.Notes)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return h.respondStay(w, r, id, http.StatusOK)
}

type chargeReq struct {
	Description string `json:"description"`
	Quantity    int    `json:"quantity"`
	UnitPrice   int64  `json:"unitPrice"`
}

func (h *Handler) AddCharge(w http.ResponseWriter, r *http.Request) error {
	var in chargeReq
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	in.Description = strings.TrimSpace(in.Description)
	f := map[string]string{}
	if in.Description == "" || len(in.Description) > 120 {
		f["description"] = "Describe the service, like Breakfast."
	}
	if in.Quantity < 1 || in.Quantity > 999 {
		f["quantity"] = "Quantity should be 1 or more."
	}
	if in.UnitPrice <= 0 {
		f["unitPrice"] = "Enter the price."
	}
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	ctx := r.Context()
	id := chi.URLParam(r, "stayID")
	prop, err := h.loadProperty(ctx)
	if err != nil {
		return err
	}
	rate := 0.0
	if prop.FrontDesk.GSTRegistered {
		rate = prop.FrontDesk.ServiceGSTRate
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, _, err := lockStay(ctx, tx, id, "in_house"); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO stay_charges (stay_id, description, quantity, unit_price, gst_rate, charged_on, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, in.Description, in.Quantity, in.UnitPrice, rate, property.Today(), auth.FromContext(ctx).UserID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return h.respondStay(w, r, id, http.StatusCreated)
}

func (h *Handler) DeleteCharge(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := chi.URLParam(r, "stayID")
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, _, err := lockStay(ctx, tx, id, "in_house"); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM stay_charges WHERE id::text = $1 AND stay_id::text = $2`, chi.URLParam(r, "chargeID"), id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Charge not found.")
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return h.respondStay(w, r, id, http.StatusOK)
}

func (in *paymentInput) validate(f map[string]string, prefix string) {
	in.Reference = strings.TrimSpace(in.Reference)
	if in.Amount <= 0 {
		f[prefix+"amount"] = "Enter the amount received."
	}
	if !payModes[in.Mode] {
		f[prefix+"mode"] = "Choose how they paid."
	}
}

func (h *Handler) AddPayment(w http.ResponseWriter, r *http.Request) error {
	var in paymentInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	f := map[string]string{}
	in.validate(f, "")
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	ctx := r.Context()
	id := chi.URLParam(r, "stayID")
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Payments are allowed after checkout too, to settle a balance left due.
	if _, _, err := lockStay(ctx, tx, id, "in_house", "checked_out"); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO stay_payments (stay_id, amount, mode, reference, received_by) VALUES ($1,$2,$3,$4,$5)`,
		id, in.Amount, in.Mode, in.Reference, auth.FromContext(ctx).UserID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return h.respondStay(w, r, id, http.StatusCreated)
}

type checkoutReq struct {
	Payment     *paymentInput `json:"payment"` // money collected now
	Refund      *paymentInput `json:"refund"`  // money returned when the guest overpaid
	SettleLater bool          `json:"settleLater"`
	Billing     *billingInput `json:"billing"` // bill-to details given at the desk while checking out
}

// Checkout fixes the night count, takes the final payment, and sends the room to cleaning.
func (h *Handler) Checkout(w http.ResponseWriter, r *http.Request) error {
	var in checkoutReq
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	f := map[string]string{}
	if in.Payment != nil && in.Payment.Amount != 0 {
		in.Payment.validate(f, "payment.")
	}
	if in.Refund != nil && in.Refund.Amount != 0 {
		in.Refund.validate(f, "refund.")
	}
	if in.Billing != nil {
		in.Billing.validate(f, "billing.")
	}
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	ctx := r.Context()
	id := chi.URLParam(r, "stayID")
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	roomID, _, err := lockStay(ctx, tx, id, "in_house")
	if err != nil {
		return err
	}
	if in.Billing != nil {
		if err := saveBilling(ctx, tx, id, *in.Billing); err != nil {
			return err
		}
	}
	user := auth.FromContext(ctx).UserID
	if in.Payment != nil && in.Payment.Amount > 0 {
		if _, err := tx.Exec(ctx, `INSERT INTO stay_payments (stay_id, amount, mode, reference, received_by) VALUES ($1,$2,$3,$4,$5)`,
			id, in.Payment.Amount, in.Payment.Mode, in.Payment.Reference, user); err != nil {
			return err
		}
	}
	now := time.Now()
	var checkIn time.Time
	var nightly int64
	if err := tx.QueryRow(ctx, `SELECT check_in_at, nightly_rate FROM stays WHERE id::text = $1`, id).Scan(&checkIn, &nightly); err != nil {
		return err
	}
	nights := Nights(checkIn, now, property.IST)

	// Work out the final balance inside the transaction, before anything is committed.
	prop, err := h.loadProperty(ctx)
	if err != nil {
		return err
	}
	lines := []Line{MakeLine("room", nights, nightly, taxConfig(prop).RoomRateBP(nightly))}
	rows, err := tx.Query(ctx, `SELECT quantity, unit_price, gst_rate::float8 FROM stay_charges WHERE stay_id::text = $1`, id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var q int
		var unit int64
		var rate float64
		if err := rows.Scan(&q, &unit, &rate); err != nil {
			rows.Close()
			return err
		}
		lines = append(lines, MakeLine("", q, unit, int(math.Round(rate*100))))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	var paid int64
	if err := tx.QueryRow(ctx, `SELECT coalesce(sum(amount), 0) FROM stay_payments WHERE stay_id::text = $1`, id).Scan(&paid); err != nil {
		return err
	}
	bal := Summarize(lines, paid, nights, false).Balance
	if in.Refund != nil && in.Refund.Amount > 0 {
		if in.Refund.Amount > -bal {
			return httpx.Invalid(map[string]string{"refund.amount": "Refund can't be more than the extra paid (" + rupeeText(max(-bal, 0)) + ")."})
		}
		if _, err := tx.Exec(ctx, `INSERT INTO stay_payments (stay_id, amount, mode, reference, received_by) VALUES ($1,$2,$3,$4,$5)`,
			id, -in.Refund.Amount, in.Refund.Mode, in.Refund.Reference, user); err != nil {
			return err
		}
		bal += in.Refund.Amount
	}
	if bal > 0 && !in.SettleLater {
		return &httpx.Error{Status: http.StatusUnprocessableEntity, Code: "balance_due",
			Message: "The guest still owes " + rupeeText(bal) + ". Collect it, or choose to settle later."}
	}

	if _, err := tx.Exec(ctx, `UPDATE stays SET status='checked_out', checked_out_at=$2, nights=$3, checked_out_by=$4 WHERE id::text = $1`,
		id, now, nights, user); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE rooms SET status='cleaning', updated_at=now() WHERE id = $1`, roomID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	h.tryIssueInvoice(ctx, id) // the GST invoice is created at checkout
	return h.respondStay(w, r, id, http.StatusOK)
}

func rupeeText(paise int64) string {
	r := paise / 100
	s := strconv.FormatInt(r, 10)
	// Indian digit grouping: 1,23,456
	if len(s) > 3 {
		head, tail := s[:len(s)-3], s[len(s)-3:]
		var parts []string
		for len(head) > 2 {
			parts = append([]string{head[len(head)-2:]}, parts...)
			head = head[:len(head)-2]
		}
		if head != "" {
			parts = append([]string{head}, parts...)
		}
		s = strings.Join(parts, ",") + "," + tail
	}
	if p := paise % 100; p != 0 {
		return "₹" + s + "." + strconv.FormatInt(100+p, 10)[1:]
	}
	return "₹" + s
}

// Cancel undoes a mistaken check-in. Only allowed before any payment is taken.
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := chi.URLParam(r, "stayID")
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	roomID, _, err := lockStay(ctx, tx, id, "in_house")
	if err != nil {
		return err
	}
	var paid bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM stay_payments WHERE stay_id::text = $1)`, id).Scan(&paid); err != nil {
		return err
	}
	if paid {
		return httpx.Conflict("A payment was taken for this stay, so it can't be cancelled. Check the guest out instead.")
	}
	if _, err := tx.Exec(ctx, `UPDATE stays SET status='cancelled' WHERE id::text = $1`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE rooms SET status='ready', updated_at=now() WHERE id = $1`, roomID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
