// Package property manages hotels/properties, their logos, and per-property
// access (including read-only mode once the Gustlog subscription lapses).
package property

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/guestly/backend/internal/auth"
	"github.com/guestly/backend/internal/billing"
	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/storage"
)

// Querier is satisfied by both *pgxpool.Pool and pgx.Tx.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Property struct {
	ID              string                `json:"id"`
	Name            string                `json:"name"`
	Address         string                `json:"address"`
	City            string                `json:"city"`
	State           string                `json:"state"`
	Pincode         string                `json:"pincode"`
	Phone           string                `json:"phone"`
	Email           string                `json:"email"`
	GSTIN           string                `json:"gstin"`
	GoogleReviewURL string                `json:"googleReviewUrl"`
	InvoicePrefix   string                `json:"invoicePrefix"`
	CheckInTime     string                `json:"checkInTime"`
	CheckOutTime    string                `json:"checkOutTime"`
	LogoURL         string                `json:"logoUrl"`
	CreatedAt       time.Time             `json:"createdAt"`
	FrontDesk       FrontDesk             `json:"frontDesk"`
	Subscription    *billing.Subscription `json:"subscription,omitempty"`
	Billing         *billing.Status       `json:"billing,omitempty"`
	EntryUsage      *EntryUsage           `json:"entryUsage,omitempty"`

	logoKey *string
}

const FreeEntryLimit = 9

type EntryUsage struct {
	Rooms        int  `json:"rooms"`
	Stays        int  `json:"stays"`
	Reservations int  `json:"reservations"`
	Total        int  `json:"total"`
	Limit        int  `json:"limit"`
	Exceeded     bool `json:"exceeded"`
}

func GetEntryUsage(ctx context.Context, q Querier, propertyID string) (EntryUsage, error) {
	var u EntryUsage
	u.Limit = FreeEntryLimit
	err := q.QueryRow(ctx, `
		SELECT 
			(SELECT count(*) FROM rooms WHERE property_id = $1),
			(SELECT count(*) FROM stays WHERE property_id = $1),
			(SELECT count(*) FROM reservations WHERE property_id = $1)
	`, propertyID).Scan(&u.Rooms, &u.Stays, &u.Reservations)
	if err != nil {
		return u, err
	}
	u.Total = u.Rooms + u.Stays + u.Reservations
	u.Exceeded = u.Total >= FreeEntryLimit
	return u, nil
}

func EnforceFreeEntryLimit(ctx context.Context, q Querier, propertyID string) error {
	var isTrial *bool
	var amount *int64
	err := q.QueryRow(ctx, `SELECT is_trial, amount FROM subscriptions WHERE property_id = $1`, propertyID).Scan(&isTrial, &amount)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	// Paid subscription active
	if isTrial != nil && !*isTrial && amount != nil && *amount > 0 {
		return nil
	}
	usage, err := GetEntryUsage(ctx, q, propertyID)
	if err != nil {
		return err
	}
	if usage.Total >= FreeEntryLimit {
		return &httpx.Error{
			Status:  http.StatusPaymentRequired,
			Code:    "SUBSCRIPTION_REQUIRED",
			Message: "The first 9 entries (rooms, check-ins, and reservations) are free. From the 10th entry onwards, your account requires a subscription.",
		}
	}
	return nil
}

// Columns selects a property joined with its subscription; alias `p` for properties, `s` for subscriptions.
const Columns = `p.id, p.name, p.address, p.city, p.state, p.pincode, p.phone, p.email, p.gstin, p.google_review_url,
	p.invoice_prefix, to_char(p.check_in_time, 'HH24:MI'), to_char(p.check_out_time, 'HH24:MI'), p.created_at, p.logo_key,
	s.id, s.plan, s.amount, s.period_months, s.is_trial, s.starts_on, s.ends_on, s.grace_days,
	p.whatsapp_number, p.whatsapp_open_in, p.wifi_name, p.wifi_password, p.gst_registered,
	p.room_gst_threshold, p.room_gst_low::float8, p.room_gst_high::float8, p.service_gst_rate::float8,
	p.legal_name, p.invoice_footer,
	p.checkout_policy, to_char(p.early_arrival_cutoff, 'HH24:MI'), p.late_checkout_grace`

const From = ` FROM properties p LEFT JOIN subscriptions s ON s.property_id = p.id `

// Scan reads a row selected with Columns. Logo URLs are signed with signer.
func Scan(row pgx.Row, signer storage.Signer) (Property, error) {
	var p Property
	var subID, plan *string
	var amount *int64
	var months, grace *int
	var trial *bool
	var starts, ends *time.Time
	err := row.Scan(&p.ID, &p.Name, &p.Address, &p.City, &p.State, &p.Pincode, &p.Phone, &p.Email,
		&p.GSTIN, &p.GoogleReviewURL, &p.InvoicePrefix, &p.CheckInTime, &p.CheckOutTime, &p.CreatedAt, &p.logoKey,
		&subID, &plan, &amount, &months, &trial, &starts, &ends, &grace,
		&p.FrontDesk.WhatsAppNumber, &p.FrontDesk.WhatsAppOpenIn, &p.FrontDesk.WifiName, &p.FrontDesk.WifiPassword,
		&p.FrontDesk.GSTRegistered, &p.FrontDesk.RoomGSTThreshold, &p.FrontDesk.RoomGSTLow, &p.FrontDesk.RoomGSTHigh,
		&p.FrontDesk.ServiceGSTRate, &p.FrontDesk.LegalName, &p.FrontDesk.InvoiceFooter,
		&p.FrontDesk.CheckoutPolicy, &p.FrontDesk.EarlyArrivalCutoff, &p.FrontDesk.LateCheckoutGrace)
	if err != nil {
		return p, err
	}
	if p.logoKey != nil {
		p.LogoURL = signer.URL(*p.logoKey, 24*time.Hour)
	}
	if subID != nil {
		s := billing.Subscription{ID: *subID, PropertyID: p.ID, Plan: *plan, Amount: *amount, PeriodMonths: *months,
			IsTrial: *trial, StartsOn: *starts, EndsOn: *ends, GraceDays: *grace}
		st := s.StatusOn(Today())
		p.Subscription, p.Billing = &s, &st
	}
	return p, nil
}

// Today is the business date in India, which decides subscription expiry.
func Today() time.Time {
	return time.Now().In(IST)
}

var IST = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		return time.FixedZone("IST", 5*3600+1800)
	}
	return loc
}()

// accessFilter limits rows to properties the principal may see:
// owners see every property in their organization, others only where they're members.
const accessFilter = `p.organization_id = $1 AND ($2 = 'owner' OR EXISTS (
	SELECT 1 FROM property_members m WHERE m.property_id = p.id AND m.user_id = $3))`

type Handler struct {
	DB     *pgxpool.Pool
	Store  storage.Store
	Signer storage.Signer
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) error {
	p := auth.FromContext(r.Context())
	rows, err := h.DB.Query(r.Context(),
		`SELECT `+Columns+From+`WHERE `+accessFilter+` ORDER BY p.created_at`, p.OrgID, p.Role, p.UserID)
	if err != nil {
		return err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Property, error) { return Scan(row, h.Signer) })
	if err != nil {
		return err
	}
	for i := range out {
		if u, err := GetEntryUsage(r.Context(), h.DB, out[i].ID); err == nil {
			out[i].EntryUsage = &u
		}
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) error {
	prop, err := Scan(h.DB.QueryRow(r.Context(), `SELECT `+Columns+From+`WHERE p.id = $1`, ID(r.Context())), h.Signer)
	if err != nil {
		return err
	}
	if u, err := GetEntryUsage(r.Context(), h.DB, prop.ID); err == nil {
		prop.EntryUsage = &u
	}
	httpx.JSON(w, http.StatusOK, prop)
	return nil
}

// Input is the editable profile of a property, shared by hotel and admin handlers.
type Input struct {
	Name            string `json:"name"`
	Address         string `json:"address"`
	City            string `json:"city"`
	State           string `json:"state"`
	Pincode         string `json:"pincode"`
	Phone           string `json:"phone"`
	Email           string `json:"email"`
	GSTIN           string `json:"gstin"`
	GoogleReviewURL string `json:"googleReviewUrl"`
	InvoicePrefix   string `json:"invoicePrefix"`
	CheckInTime     string `json:"checkInTime"`
	CheckOutTime    string `json:"checkOutTime"`
}

var (
	GSTINRe   = regexp.MustCompile(`^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`)
	pincodeRe = regexp.MustCompile(`^[1-9][0-9]{5}$`)
	timeRe    = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)
	prefixRe  = regexp.MustCompile(`^[A-Z0-9-]{1,10}$`)
)

// Normalize trims and defaults fields and returns per-field validation errors.
func (in *Input) Normalize() map[string]string {
	in.Name = strings.TrimSpace(in.Name)
	in.GSTIN = strings.ToUpper(strings.TrimSpace(in.GSTIN))
	in.Pincode = strings.TrimSpace(in.Pincode)
	in.InvoicePrefix = strings.ToUpper(strings.TrimSpace(in.InvoicePrefix))
	if in.InvoicePrefix == "" {
		in.InvoicePrefix = "INV"
	}
	if in.CheckInTime == "" {
		in.CheckInTime = "12:00"
	}
	if in.CheckOutTime == "" {
		in.CheckOutTime = "11:00"
	}
	f := map[string]string{}
	if in.Name == "" {
		f["name"] = "Enter the property name."
	}
	if in.GSTIN != "" && !GSTINRe.MatchString(in.GSTIN) {
		f["gstin"] = "GSTIN should be 15 characters, like 29ABCDE1234F1Z5."
	}
	if in.Pincode != "" && !pincodeRe.MatchString(in.Pincode) {
		f["pincode"] = "PIN code should be 6 digits."
	}
	if !prefixRe.MatchString(in.InvoicePrefix) {
		f["invoicePrefix"] = "Use up to 10 letters, numbers, or dashes."
	}
	if !timeRe.MatchString(in.CheckInTime) {
		f["checkInTime"] = "Use 24-hour time, like 12:00."
	}
	if !timeRe.MatchString(in.CheckOutTime) {
		f["checkOutTime"] = "Use 24-hour time, like 11:00."
	}
	if in.GoogleReviewURL != "" && !strings.HasPrefix(in.GoogleReviewURL, "https://") {
		f["googleReviewUrl"] = "Paste the full https:// link."
	}
	return f
}

// Insert creates a property for an organization and returns its ID. Call Normalize first.
func Insert(ctx context.Context, q Querier, orgID string, in Input) (string, error) {
	var id string
	err := q.QueryRow(ctx, `
		INSERT INTO properties (organization_id, name, address, city, state, pincode, phone, email, gstin,
			google_review_url, invoice_prefix, check_in_time, check_out_time)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
		orgID, in.Name, in.Address, in.City, in.State, in.Pincode, in.Phone, in.Email, in.GSTIN,
		in.GoogleReviewURL, in.InvoicePrefix, in.CheckInTime, in.CheckOutTime).Scan(&id)
	return id, err
}

// UpdateProfile saves a property's profile. Call Normalize first.
func UpdateProfile(ctx context.Context, q Querier, id string, in Input) error {
	tag, err := q.Exec(ctx, `
		UPDATE properties SET name=$2, address=$3, city=$4, state=$5, pincode=$6, phone=$7, email=$8, gstin=$9,
			google_review_url=$10, invoice_prefix=$11, check_in_time=$12, check_out_time=$13, updated_at=now()
		WHERE id = $1`,
		id, in.Name, in.Address, in.City, in.State, in.Pincode, in.Phone, in.Email, in.GSTIN,
		in.GoogleReviewURL, in.InvoicePrefix, in.CheckInTime, in.CheckOutTime)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Property not found.")
	}
	return nil
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) error {
	var in Input
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if f := in.Normalize(); len(f) > 0 {
		return httpx.Invalid(f)
	}
	if err := UpdateProfile(r.Context(), h.DB, ID(r.Context()), in); err != nil {
		return err
	}
	return h.Get(w, r)
}

// SaveLogo stores an uploaded logo for a property, replacing (and deleting) any previous one.
func SaveLogo(ctx context.Context, db Querier, store storage.Store, propertyID string, data []byte, ext string) error {
	key := storage.NewKey("logos", ext)
	if err := store.Put(ctx, key, bytes.NewReader(data), ""); err != nil {
		return err
	}
	var old *string
	err := db.QueryRow(ctx, `
		UPDATE properties p SET logo_key = $2, updated_at = now()
		FROM (SELECT logo_key FROM properties WHERE id = $1) prev
		WHERE p.id = $1 RETURNING prev.logo_key`, propertyID, key).Scan(&old)
	if err != nil {
		_ = store.Delete(ctx, key)
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.NotFound("Property not found.")
		}
		return err
	}
	if old != nil {
		_ = store.Delete(ctx, *old)
	}
	return nil
}

// RemoveLogo clears a property's logo.
func RemoveLogo(ctx context.Context, db Querier, store storage.Store, propertyID string) error {
	var old *string
	err := db.QueryRow(ctx, `
		UPDATE properties p SET logo_key = NULL, updated_at = now()
		FROM (SELECT logo_key FROM properties WHERE id = $1) prev
		WHERE p.id = $1 RETURNING prev.logo_key`, propertyID).Scan(&old)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Property not found.")
	}
	if err != nil {
		return err
	}
	if old != nil {
		_ = store.Delete(ctx, *old)
	}
	return nil
}

func (h *Handler) UploadLogo(w http.ResponseWriter, r *http.Request) error {
	data, ext, err := storage.ReadImage(r, "logo")
	if err != nil {
		return err
	}
	if err := SaveLogo(r.Context(), h.DB, h.Store, ID(r.Context()), data, ext); err != nil {
		return err
	}
	return h.Get(w, r)
}

func (h *Handler) DeleteLogo(w http.ResponseWriter, r *http.Request) error {
	if err := RemoveLogo(r.Context(), h.DB, h.Store, ID(r.Context())); err != nil {
		return err
	}
	return h.Get(w, r)
}

// FrontDesk holds settings used at check-in, in guest messages, and on bills.
type FrontDesk struct {
	WhatsAppNumber   string  `json:"whatsappNumber"`
	WhatsAppOpenIn   string  `json:"whatsappOpenIn"` // app | web
	WifiName         string  `json:"wifiName"`
	WifiPassword     string  `json:"wifiPassword"`
	GSTRegistered    bool    `json:"gstRegistered"`
	RoomGSTThreshold int64   `json:"roomGstThreshold"` // paise
	RoomGSTLow       float64 `json:"roomGstLow"`       // percent
	RoomGSTHigh      float64 `json:"roomGstHigh"`
	ServiceGSTRate   float64 `json:"serviceGstRate"`
	LegalName        string  `json:"legalName"`     // name registered under GST, printed on invoices
	InvoiceFooter    string  `json:"invoiceFooter"` // terms or thank-you line at the bottom of invoices
	// Stay rules (see migration 00008).
	CheckoutPolicy     string `json:"checkoutPolicy"`     // fixed | 24h
	EarlyArrivalCutoff string `json:"earlyArrivalCutoff"` // HH:MM; "00:00" = off
	LateCheckoutGrace  int    `json:"lateCheckoutGrace"`  // minutes
}

var allowedGST = map[float64]bool{0: true, 5: true, 12: true, 18: true, 28: true}

func (h *Handler) UpdateFrontDesk(w http.ResponseWriter, r *http.Request) error {
	var in FrontDesk
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	f := map[string]string{}
	in.WhatsAppNumber = strings.TrimSpace(in.WhatsAppNumber)
	in.WifiName = strings.TrimSpace(in.WifiName)
	in.LegalName = strings.TrimSpace(in.LegalName)
	in.InvoiceFooter = strings.TrimSpace(in.InvoiceFooter)
	if len(in.LegalName) > 120 {
		f["legalName"] = "Keep this under 120 characters."
	}
	if len(in.InvoiceFooter) > 300 {
		f["invoiceFooter"] = "Keep this under 300 characters."
	}
	if in.WhatsAppOpenIn != "app" && in.WhatsAppOpenIn != "web" {
		f["whatsappOpenIn"] = "Choose WhatsApp app or WhatsApp Web."
	}
	if in.RoomGSTThreshold < 0 {
		f["roomGstThreshold"] = "Enter a valid amount."
	}
	for k, v := range map[string]float64{"roomGstLow": in.RoomGSTLow, "roomGstHigh": in.RoomGSTHigh, "serviceGstRate": in.ServiceGSTRate} {
		if !allowedGST[v] {
			f[k] = "Use a GST rate of 0, 5, 12, 18 or 28%."
		}
	}
	if in.CheckoutPolicy != "fixed" && in.CheckoutPolicy != "24h" {
		f["checkoutPolicy"] = "Choose a checkout rule."
	}
	if !timeRe.MatchString(in.EarlyArrivalCutoff) || in.EarlyArrivalCutoff > "12:00" {
		f["earlyArrivalCutoff"] = "Use a time between 12:00 AM and 12:00 PM."
	}
	if in.LateCheckoutGrace < 0 || in.LateCheckoutGrace > 360 {
		f["lateCheckoutGrace"] = "Use 0 to 360 minutes."
	}
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	if _, err := h.DB.Exec(r.Context(), `
		UPDATE properties SET whatsapp_number=$2, whatsapp_open_in=$3, wifi_name=$4, wifi_password=$5, gst_registered=$6,
			room_gst_threshold=$7, room_gst_low=$8, room_gst_high=$9, service_gst_rate=$10, legal_name=$11, invoice_footer=$12,
			checkout_policy=$13, early_arrival_cutoff=$14, late_checkout_grace=$15, updated_at=now()
		WHERE id = $1`, ID(r.Context()), in.WhatsAppNumber, in.WhatsAppOpenIn, in.WifiName, in.WifiPassword, in.GSTRegistered,
		in.RoomGSTThreshold, in.RoomGSTLow, in.RoomGSTHigh, in.ServiceGSTRate, in.LegalName, in.InvoiceFooter,
		in.CheckoutPolicy, in.EarlyArrivalCutoff, in.LateCheckoutGrace); err != nil {
		return err
	}
	return h.Get(w, r)
}

type ctxKey struct{}

// WithID returns a context carrying a property ID, for code that runs outside a request (the seed command).
func WithID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// ID returns the property ID resolved by Access.
func ID(ctx context.Context) string {
	id, _ := ctx.Value(ctxKey{}).(string)
	return id
}

// Access resolves {propertyID} from the URL, rejects principals who can't access it,
// and blocks writes once the property's Gustlog subscription is past its grace period.
func (h *Handler) Access(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "propertyID")
		p := auth.FromContext(r.Context())
		var orgStatus string
		var ends *time.Time
		var grace *int
		var trial *bool
		err := h.DB.QueryRow(r.Context(), `
			SELECT o.status, s.ends_on, s.grace_days, s.is_trial
			FROM properties p
			JOIN organizations o ON o.id = p.organization_id
			LEFT JOIN subscriptions s ON s.property_id = p.id
			WHERE p.id::text = $4 AND `+accessFilter, p.OrgID, p.Role, p.UserID, id).Scan(&orgStatus, &ends, &grace, &trial)
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, r, httpx.NotFound("Property not found."))
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if orgStatus == "suspended" {
			httpx.WriteError(w, r, httpx.Forbidden("This account is paused. Please contact Gustlog support."))
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			readOnly := ends == nil // no subscription at all: treat as lapsed
			var st billing.Status
			if ends != nil {
				st = billing.Subscription{EndsOn: *ends, GraceDays: *grace, IsTrial: *trial}.StatusOn(Today())
				readOnly = st.ReadOnly
			}
			if readOnly {
				code := "subscription_expired"
				msg := "Your Gustlog plan for this property has expired, so it's read-only. Renew to make changes."
				if trial != nil && *trial {
					code = "SUBSCRIPTION_REQUIRED"
					msg = "Your free trial has ended. Subscribe to continue."
				}
				httpx.WriteError(w, r, &httpx.Error{Status: http.StatusPaymentRequired, Code: code, Message: msg})
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
	})
}

// ---- Staff Attendance & Profile ----

type AttendanceRecord struct {
	ID         string     `json:"id"`
	PropertyID string     `json:"propertyId"`
	UserID     string     `json:"userId"`
	StaffName  string     `json:"staffName"`
	StaffEmail string     `json:"staffEmail"`
	StaffPhone string     `json:"staffPhone"`
	StaffRole  string     `json:"staffRole"`
	Date       string     `json:"date"`
	ClockInAt  time.Time  `json:"clockInAt"`
	ClockOutAt *time.Time `json:"clockOutAt"`
	Status     string     `json:"status"` // "present", "half_day", "on_leave", "absent"
	Notes      string     `json:"notes"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type AttendanceSummary struct {
	TotalStaff   int `json:"totalStaff"`
	PresentToday int `json:"presentToday"`
	TotalRecords int `json:"totalRecords"`
}

type AttendanceReport struct {
	Records []AttendanceRecord `json:"records"`
	Summary AttendanceSummary  `json:"summary"`
}

type StaffMember struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Email           string            `json:"email"`
	Phone           string            `json:"phone"`
	Role            string            `json:"role"`
	CreatedAt       time.Time         `json:"createdAt"`
	AttendanceToday *AttendanceRecord `json:"attendanceToday,omitempty"`
	DaysPresent     int               `json:"daysPresent"`
}

func (h *Handler) ListAttendance(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	propID := ID(ctx)
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	userID := r.URL.Query().Get("userId")

	if from == "" {
		from = Today().AddDate(0, -1, 0).Format("2006-01-02")
	}
	if to == "" {
		to = Today().Format("2006-01-02")
	}

	query := `
		SELECT a.id, a.property_id, a.user_id, u.name, u.email, coalesce(u.phone, ''), u.role,
		       to_char(a.date, 'YYYY-MM-DD'), a.clock_in_at, a.clock_out_at, a.status, a.notes, a.created_at
		FROM staff_attendance a
		JOIN users u ON u.id = a.user_id
		WHERE a.property_id = $1 AND a.date >= $2::date AND a.date <= $3::date`
	args := []any{propID, from, to}

	if userID != "" {
		args = append(args, userID)
		query += fmt.Sprintf(" AND a.user_id = $%d", len(args))
	}
	query += " ORDER BY a.date DESC, a.clock_in_at DESC"

	rows, err := h.DB.Query(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	var records []AttendanceRecord
	for rows.Next() {
		var rec AttendanceRecord
		if err := rows.Scan(&rec.ID, &rec.PropertyID, &rec.UserID, &rec.StaffName, &rec.StaffEmail, &rec.StaffPhone, &rec.StaffRole,
			&rec.Date, &rec.ClockInAt, &rec.ClockOutAt, &rec.Status, &rec.Notes, &rec.CreatedAt); err != nil {
			return err
		}
		records = append(records, rec)
	}

	var totalStaff, presentToday int
	_ = h.DB.QueryRow(ctx, `
		SELECT 
			(SELECT count(*) FROM users u JOIN properties p ON p.organization_id = u.organization_id WHERE p.id = $1),
			(SELECT count(*) FROM staff_attendance WHERE property_id = $1 AND date = (now() AT TIME ZONE 'Asia/Kolkata')::date AND status = 'present')
	`, propID).Scan(&totalStaff, &presentToday)

	httpx.JSON(w, http.StatusOK, AttendanceReport{
		Records: records,
		Summary: AttendanceSummary{
			TotalStaff:   totalStaff,
			PresentToday: presentToday,
			TotalRecords: len(records),
		},
	})
	return nil
}

type attendanceInput struct {
	UserID string `json:"userId"`
	Date   string `json:"date"`
	Status string `json:"status"`
	Notes  string `json:"notes"`
	Action string `json:"action"` // "clock_in", "clock_out"
}

func (h *Handler) RecordAttendance(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	propID := ID(ctx)
	p := auth.FromContext(ctx)

	var in attendanceInput
	_ = httpx.Decode(r, &in)

	targetUserID := in.UserID
	if targetUserID == "" {
		targetUserID = p.UserID
	}
	dateStr := in.Date
	if dateStr == "" {
		dateStr = Today().Format("2006-01-02")
	}
	status := in.Status
	if status == "" {
		status = "present"
	}

	var rec AttendanceRecord
	err := h.DB.QueryRow(ctx, `
		INSERT INTO staff_attendance (property_id, user_id, date, clock_in_at, status, notes)
		VALUES ($1, $2, $3::date, now(), $4, $5)
		ON CONFLICT (property_id, user_id, date) DO UPDATE 
		SET status = EXCLUDED.status, notes = CASE WHEN EXCLUDED.notes <> '' THEN EXCLUDED.notes ELSE staff_attendance.notes END, updated_at = now()
		RETURNING id, property_id, user_id, to_char(date, 'YYYY-MM-DD'), clock_in_at, clock_out_at, status, notes, created_at`,
		propID, targetUserID, dateStr, status, in.Notes).Scan(
		&rec.ID, &rec.PropertyID, &rec.UserID, &rec.Date, &rec.ClockInAt, &rec.ClockOutAt, &rec.Status, &rec.Notes, &rec.CreatedAt)
	if err != nil {
		return err
	}

	_ = h.DB.QueryRow(ctx, `SELECT name, email, phone, role FROM users WHERE id = $1`, rec.UserID).Scan(
		&rec.StaffName, &rec.StaffEmail, &rec.StaffPhone, &rec.StaffRole)

	httpx.JSON(w, http.StatusOK, rec)
	return nil
}

func (h *Handler) UpdateAttendance(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	propID := ID(ctx)
	attID := chi.URLParam(r, "attendanceID")

	var in attendanceInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}

	var clockOutExpr string
	if in.Action == "clock_out" {
		clockOutExpr = ", clock_out_at = now()"
	}

	var rec AttendanceRecord
	err := h.DB.QueryRow(ctx, fmt.Sprintf(`
		UPDATE staff_attendance
		SET status = coalesce(nullif($2, ''), status),
		    notes = coalesce(nullif($3, ''), notes),
		    updated_at = now() %s
		WHERE id::text = $1 AND property_id = $4
		RETURNING id, property_id, user_id, to_char(date, 'YYYY-MM-DD'), clock_in_at, clock_out_at, status, notes, created_at`, clockOutExpr),
		attID, in.Status, in.Notes, propID).Scan(
		&rec.ID, &rec.PropertyID, &rec.UserID, &rec.Date, &rec.ClockInAt, &rec.ClockOutAt, &rec.Status, &rec.Notes, &rec.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Attendance record not found.")
	}
	if err != nil {
		return err
	}

	_ = h.DB.QueryRow(ctx, `SELECT name, email, phone, role FROM users WHERE id = $1`, rec.UserID).Scan(
		&rec.StaffName, &rec.StaffEmail, &rec.StaffPhone, &rec.StaffRole)

	httpx.JSON(w, http.StatusOK, rec)
	return nil
}

func (h *Handler) ListStaff(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	propID := ID(ctx)

	rows, err := h.DB.Query(ctx, `
		SELECT u.id, u.name, u.email, coalesce(u.phone, ''), u.role, u.created_at,
		       (SELECT count(*) FROM staff_attendance WHERE user_id = u.id AND property_id = $1 AND status = 'present') as days_present
		FROM users u
		JOIN properties p ON p.organization_id = u.organization_id
		WHERE p.id = $1
		ORDER BY u.name`, propID)
	if err != nil {
		return err
	}
	defer rows.Close()

	var staff []StaffMember
	for rows.Next() {
		var s StaffMember
		if err := rows.Scan(&s.ID, &s.Name, &s.Email, &s.Phone, &s.Role, &s.CreatedAt, &s.DaysPresent); err != nil {
			return err
		}
		var att AttendanceRecord
		err := h.DB.QueryRow(ctx, `
			SELECT id, property_id, user_id, to_char(date, 'YYYY-MM-DD'), clock_in_at, clock_out_at, status, notes, created_at
			FROM staff_attendance
			WHERE property_id = $1 AND user_id = $2 AND date = (now() AT TIME ZONE 'Asia/Kolkata')::date`, propID, s.ID).Scan(
			&att.ID, &att.PropertyID, &att.UserID, &att.Date, &att.ClockInAt, &att.ClockOutAt, &att.Status, &att.Notes, &att.CreatedAt)
		if err == nil {
			att.StaffName, att.StaffRole = s.Name, s.Role
			s.AttendanceToday = &att
		}
		staff = append(staff, s)
	}

	httpx.JSON(w, http.StatusOK, staff)
	return nil
}

func (h *Handler) StaffProfile(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	propID := ID(ctx)
	p := auth.FromContext(ctx)

	var s StaffMember
	err := h.DB.QueryRow(ctx, `
		SELECT u.id, u.name, u.email, coalesce(u.phone, ''), u.role, u.created_at,
		       (SELECT count(*) FROM staff_attendance WHERE user_id = u.id AND property_id = $1 AND status = 'present') as days_present
		FROM users u WHERE u.id = $2`, propID, p.UserID).Scan(&s.ID, &s.Name, &s.Email, &s.Phone, &s.Role, &s.CreatedAt, &s.DaysPresent)
	if err != nil {
		return err
	}

	var att AttendanceRecord
	err = h.DB.QueryRow(ctx, `
		SELECT id, property_id, user_id, to_char(date, 'YYYY-MM-DD'), clock_in_at, clock_out_at, status, notes, created_at
		FROM staff_attendance
		WHERE property_id = $1 AND user_id = $2 AND date = (now() AT TIME ZONE 'Asia/Kolkata')::date`, propID, s.ID).Scan(
		&att.ID, &att.PropertyID, &att.UserID, &att.Date, &att.ClockInAt, &att.ClockOutAt, &att.Status, &att.Notes, &att.CreatedAt)
	if err == nil {
		att.StaffName, att.StaffRole = s.Name, s.Role
		s.AttendanceToday = &att
	}

	// Recent 30 days attendance records for this staff member
	rows, err := h.DB.Query(ctx, `
		SELECT id, property_id, user_id, to_char(date, 'YYYY-MM-DD'), clock_in_at, clock_out_at, status, notes, created_at
		FROM staff_attendance
		WHERE property_id = $1 AND user_id = $2 AND date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - interval '30 days'
		ORDER BY date DESC`, propID, s.ID)
	var records []AttendanceRecord
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var r AttendanceRecord
			if err := rows.Scan(&r.ID, &r.PropertyID, &r.UserID, &r.Date, &r.ClockInAt, &r.ClockOutAt, &r.Status, &r.Notes, &r.CreatedAt); err == nil {
				r.StaffName, r.StaffRole = s.Name, s.Role
				records = append(records, r)
			}
		}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"staff":   s,
		"history": records,
	})
	return nil
}

type CreateStaffInput struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Role     string `json:"role"`
	Password string `json:"password"`
}

type UpdateStaffInput struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Role     string `json:"role"`
	Password string `json:"password,omitempty"`
}

func cleanPhone(raw string) string {
	raw = strings.TrimSpace(raw)
	digits := ""
	for _, c := range raw {
		if c >= '0' && c <= '9' {
			digits += string(c)
		}
	}
	if len(digits) == 12 && strings.HasPrefix(digits, "91") {
		return digits[2:]
	}
	if len(digits) == 11 && strings.HasPrefix(digits, "0") {
		return digits[1:]
	}
	if len(digits) == 10 {
		return digits
	}
	return raw
}

func (h *Handler) CreateStaff(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	propID := ID(ctx)

	var in CreateStaffInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}

	f := map[string]string{}
	in.Name = strings.TrimSpace(in.Name)
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	in.Phone = cleanPhone(in.Phone)
	in.Role = strings.TrimSpace(in.Role)
	in.Password = strings.TrimSpace(in.Password)

	if len(in.Name) < 2 || len(in.Name) > 80 {
		f["name"] = "Staff name must be between 2 and 80 characters."
	}
	if in.Email == "" {
		f["email"] = "Enter an email or login ID."
	}
	if in.Role != "manager" && in.Role != "front_desk" && in.Role != "housekeeping" {
		f["role"] = "Choose a valid role: Manager, Front desk, or Housekeeping."
	}
	if len(in.Password) < 6 {
		f["password"] = "Password must be at least 6 characters."
	}
	if len(f) > 0 {
		return httpx.Invalid(f)
	}

	var orgID string
	err := h.DB.QueryRow(ctx, `SELECT organization_id FROM properties WHERE id = $1`, propID).Scan(&orgID)
	if err != nil {
		return err
	}

	var existing string
	err = h.DB.QueryRow(ctx, `SELECT email FROM users WHERE lower(email) = lower($1)`, in.Email).Scan(&existing)
	if err == nil {
		return httpx.Conflict("A staff member with this login ID or email already exists.")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	var member StaffMember
	member.Name = in.Name
	member.Email = in.Email
	member.Phone = in.Phone
	member.Role = in.Role
	err = h.DB.QueryRow(ctx, `
		INSERT INTO users (organization_id, name, email, phone, role, password_hash)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at`,
		orgID, in.Name, in.Email, in.Phone, in.Role, string(hash)).Scan(&member.ID, &member.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return httpx.Conflict("A staff member with this login ID or email already exists.")
		}
		return err
	}

	// Add membership to this property so the staff member can access their workspace
	_, err = h.DB.Exec(ctx, `
		INSERT INTO property_members (property_id, user_id)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, propID, member.ID)
	if err != nil {
		return err
	}

	httpx.JSON(w, http.StatusCreated, member)
	return nil
}

func (h *Handler) UpdateStaff(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	propID := ID(ctx)
	staffID := chi.URLParam(r, "staffID")

	var in UpdateStaffInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}

	var orgID string
	err := h.DB.QueryRow(ctx, `SELECT organization_id FROM properties WHERE id = $1`, propID).Scan(&orgID)
	if err != nil {
		return err
	}

	var currentRole string
	err = h.DB.QueryRow(ctx, `SELECT role FROM users WHERE id::text = $1 AND organization_id = $2`, staffID, orgID).Scan(&currentRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Staff member not found.")
	}
	if err != nil {
		return err
	}
	if currentRole == "owner" && in.Role != "" && in.Role != "owner" {
		return httpx.Forbidden("Cannot change the owner's role.")
	}

	var setClauses []string
	args := []any{staffID, orgID}

	if in.Name != "" {
		args = append(args, strings.TrimSpace(in.Name))
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", len(args)))
	}
	if in.Phone != "" {
		args = append(args, cleanPhone(in.Phone))
		setClauses = append(setClauses, fmt.Sprintf("phone = $%d", len(args)))
	}
	if in.Role != "" && currentRole != "owner" {
		args = append(args, strings.TrimSpace(in.Role))
		setClauses = append(setClauses, fmt.Sprintf("role = $%d", len(args)))
	}
	if in.Password != "" {
		if len(in.Password) < 6 {
			return httpx.Invalid(map[string]string{"password": "Password must be at least 6 characters."})
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		args = append(args, string(hash))
		setClauses = append(setClauses, fmt.Sprintf("password_hash = $%d", len(args)))
	}

	if len(setClauses) > 0 {
		query := fmt.Sprintf(`UPDATE users SET %s WHERE id::text = $1 AND organization_id = $2`, strings.Join(setClauses, ", "))
		_, err = h.DB.Exec(ctx, query, args...)
		if err != nil {
			return err
		}
	}

	var s StaffMember
	err = h.DB.QueryRow(ctx, `
		SELECT u.id, u.name, u.email, coalesce(u.phone, ''), u.role, u.created_at,
		       (SELECT count(*) FROM staff_attendance WHERE user_id = u.id AND property_id = $1 AND status = 'present') as days_present
		FROM users u WHERE u.id::text = $2`, propID, staffID).Scan(&s.ID, &s.Name, &s.Email, &s.Phone, &s.Role, &s.CreatedAt, &s.DaysPresent)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, s)
	return nil
}

func (h *Handler) DeleteStaff(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	propID := ID(ctx)
	staffID := chi.URLParam(r, "staffID")

	var orgID string
	err := h.DB.QueryRow(ctx, `SELECT organization_id FROM properties WHERE id = $1`, propID).Scan(&orgID)
	if err != nil {
		return err
	}

	var role string
	err = h.DB.QueryRow(ctx, `SELECT role FROM users WHERE id::text = $1 AND organization_id = $2`, staffID, orgID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Staff member not found.")
	}
	if role == "owner" {
		return httpx.Forbidden("Cannot delete the property owner.")
	}

	_, _ = h.DB.Exec(ctx, `DELETE FROM staff_attendance WHERE user_id::text = $1`, staffID)
	_, err = h.DB.Exec(ctx, `DELETE FROM users WHERE id::text = $1 AND organization_id = $2`, staffID, orgID)
	if err != nil {
		return err
	}

	w.WriteHeader(http.StatusNoContent)
	return nil
}
