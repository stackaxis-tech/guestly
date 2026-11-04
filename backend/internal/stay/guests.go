// Package stay covers guests, their ID documents, check-in, the running bill,
// payments, checkout, and WhatsApp messages to guests.
package stay

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/guestly/backend/internal/auth"
	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/property"
	"github.com/guestly/backend/internal/secure"
	"github.com/guestly/backend/internal/storage"
)

type Handler struct {
	DB     *pgxpool.Pool
	Store  storage.Store
	Signer storage.Signer
	Box    *secure.Box
}

const maxIDImage = 3 << 20 // 3 MB; the app compresses photos to well under this

// ---- Staged uploads ----

// Upload encrypts and stores a guest photo or ID image before check-in is submitted.
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) error {
	data, _, err := storage.ReadImageMax(r, "file", maxIDImage)
	if err != nil {
		return err
	}
	kind := r.FormValue("kind")
	if kind != "photo" && kind != "id_front" && kind != "id_back" {
		return httpx.BadRequest("kind must be photo, id_front or id_back")
	}
	key := storage.NewKey("guests", "enc")
	if err := h.Store.Put(r.Context(), key, bytes.NewReader(h.Box.Seal(data)), ""); err != nil {
		return err
	}
	var id string
	if err := h.DB.QueryRow(r.Context(),
		`INSERT INTO staged_uploads (property_id, object_key, kind, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
		property.ID(r.Context()), key, kind, auth.FromContext(r.Context()).UserID).Scan(&id); err != nil {
		_ = h.Store.Delete(r.Context(), key)
		return err
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": id})
	return nil
}

// claimUpload attaches a staged upload and returns its object key. Empty id → "".
func claimUpload(ctx context.Context, tx pgx.Tx, propertyID, uploadID, kind, field string) (string, error) {
	if uploadID == "" {
		return "", nil
	}
	var key string
	err := tx.QueryRow(ctx, `
		UPDATE staged_uploads SET attached_at = now()
		WHERE id::text = $1 AND property_id = $2 AND kind = $3 AND attached_at IS NULL
			AND created_at > now() - interval '24 hours'
		RETURNING object_key`, uploadID, propertyID, kind).Scan(&key)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.Invalid(map[string]string{field: "This photo expired or was already used. Please take it again."})
	}
	return key, err
}

// ---- Guests ----

type Guest struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Phone           string     `json:"phone"`
	Email           string     `json:"email"`
	Nationality     string     `json:"nationality"`
	Gender          string     `json:"gender"`
	BirthYear       *int       `json:"birthYear"`
	Address         string     `json:"address"`
	HasPhoto        bool       `json:"hasPhoto"`
	WhatsAppConsent bool       `json:"whatsappConsent"`
	StayCount       int        `json:"stayCount"`
	LastStayAt      *time.Time `json:"lastStayAt"`
	CreatedAt       time.Time  `json:"createdAt"`
}

const guestColumns = `g.id, g.name, g.phone, g.email, g.nationality, g.gender, g.birth_year, g.address,
	g.photo_key IS NOT NULL, g.whatsapp_consent_at IS NOT NULL,
	(SELECT count(*) FROM stays s WHERE s.guest_id = g.id AND s.status <> 'cancelled')
	  + (SELECT count(*) FROM stay_guests sg JOIN stays s ON s.id = sg.stay_id WHERE sg.guest_id = g.id AND s.status <> 'cancelled'),
	(SELECT max(s.check_in_at) FROM stays s WHERE (s.guest_id = g.id OR s.id IN (SELECT stay_id FROM stay_guests WHERE guest_id = g.id)) AND s.status <> 'cancelled'),
	g.created_at`

func scanGuest(row pgx.Row) (Guest, error) {
	var g Guest
	err := row.Scan(&g.ID, &g.Name, &g.Phone, &g.Email, &g.Nationality, &g.Gender, &g.BirthYear, &g.Address,
		&g.HasPhoto, &g.WhatsAppConsent, &g.StayCount, &g.LastStayAt, &g.CreatedAt)
	return g, err
}

type Document struct {
	ID          string     `json:"id"`
	Type        string     `json:"type"`
	NumberLast4 string     `json:"numberLast4"`
	HasNumber   bool       `json:"hasNumber"`
	HasFront    bool       `json:"hasFront"`
	HasBack     bool       `json:"hasBack"`
	VisaExpiry  *time.Time `json:"visaExpiry"`
	CreatedAt   time.Time  `json:"createdAt"`
}

func (h *Handler) documents(ctx context.Context, guestID string) ([]Document, error) {
	rows, err := h.DB.Query(ctx, `
		SELECT id, doc_type, number_last4, number_encrypted IS NOT NULL, front_key IS NOT NULL, back_key IS NOT NULL, visa_expiry, created_at
		FROM guest_documents WHERE guest_id = $1 ORDER BY created_at DESC`, guestID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Document, error) {
		var d Document
		err := row.Scan(&d.ID, &d.Type, &d.NumberLast4, &d.HasNumber, &d.HasFront, &d.HasBack, &d.VisaExpiry, &d.CreatedAt)
		return d, err
	})
}

// Lookup finds a returning guest by phone so check-in can be prefilled.
func (h *Handler) Lookup(w http.ResponseWriter, r *http.Request) error {
	phone := NormalizePhone(r.URL.Query().Get("phone"))
	if phone == "" {
		return httpx.Invalid(map[string]string{"phone": "Enter a valid mobile number."})
	}
	g, err := scanGuest(h.DB.QueryRow(r.Context(), `SELECT `+guestColumns+` FROM guests g
		WHERE g.property_id = $1 AND g.phone = $2 ORDER BY g.updated_at DESC LIMIT 1`, property.ID(r.Context()), phone))
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.JSON(w, http.StatusOK, map[string]any{"phone": phone, "guest": nil})
		return nil
	}
	if err != nil {
		return err
	}
	docs, err := h.documents(r.Context(), g.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"phone": phone, "guest": g, "documents": docs})
	return nil
}

func (h *Handler) SearchGuests(w http.ResponseWriter, r *http.Request) error {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	digits := nonDigits.ReplaceAllString(q, "")
	rows, err := h.DB.Query(r.Context(), `
		SELECT `+guestColumns+` FROM guests g
		WHERE g.property_id = $1
		  AND ($2 = '' OR g.name ILIKE '%' || $2 || '%' OR ($3 <> '' AND length($3) >= 4 AND g.phone LIKE '%' || $3 || '%'))
		ORDER BY g.updated_at DESC LIMIT 100`, property.ID(r.Context()), q, digits)
	if err != nil {
		return err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Guest, error) { return scanGuest(row) })
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

func (h *Handler) loadGuest(ctx context.Context, guestID string) (Guest, error) {
	g, err := scanGuest(h.DB.QueryRow(ctx, `SELECT `+guestColumns+` FROM guests g WHERE g.id::text = $1 AND g.property_id = $2`,
		guestID, property.ID(ctx)))
	if errors.Is(err, pgx.ErrNoRows) {
		return g, httpx.NotFound("Guest not found.")
	}
	return g, err
}

func (h *Handler) GetGuest(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	g, err := h.loadGuest(ctx, chi.URLParam(r, "guestID"))
	if err != nil {
		return err
	}
	docs, err := h.documents(ctx, g.ID)
	if err != nil {
		return err
	}
	stays, err := h.listStays(ctx, `(s.guest_id = $2 OR s.id IN (SELECT stay_id FROM stay_guests WHERE guest_id = $2)) AND s.status <> 'cancelled'`, g.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"guest": g, "documents": docs, "stays": stays})
	return nil
}

// ---- Sensitive files ----

func (h *Handler) logAccess(ctx context.Context, guestID, what string) {
	_, _ = h.DB.Exec(context.WithoutCancel(ctx), `INSERT INTO id_access_log (property_id, guest_id, user_id, what) VALUES ($1,$2,$3,$4)`,
		property.ID(ctx), guestID, auth.FromContext(ctx).UserID, what)
}

func (h *Handler) serveEncrypted(w http.ResponseWriter, r *http.Request, key string) error {
	f, _, err := h.Store.Open(r.Context(), key)
	if err != nil {
		return httpx.NotFound("Image not found.")
	}
	defer f.Close()
	sealed, err := io.ReadAll(f)
	if err != nil {
		return err
	}
	plain, err := h.Box.Open(sealed)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", http.DetectContentType(plain))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(plain)
	return nil
}

func (h *Handler) GuestPhoto(w http.ResponseWriter, r *http.Request) error {
	var key *string
	err := h.DB.QueryRow(r.Context(), `SELECT photo_key FROM guests WHERE id::text = $1 AND property_id = $2`,
		chi.URLParam(r, "guestID"), property.ID(r.Context())).Scan(&key)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && key == nil) {
		return httpx.NotFound("No photo.")
	}
	if err != nil {
		return err
	}
	return h.serveEncrypted(w, r, *key)
}

func (h *Handler) DocumentImage(w http.ResponseWriter, r *http.Request) error {
	side := chi.URLParam(r, "side")
	if side != "front" && side != "back" {
		return httpx.NotFound("Image not found.")
	}
	var guestID string
	var front, back *string
	err := h.DB.QueryRow(r.Context(), `
		SELECT d.guest_id, d.front_key, d.back_key FROM guest_documents d JOIN guests g ON g.id = d.guest_id
		WHERE d.id::text = $1 AND g.id::text = $2 AND g.property_id = $3`,
		chi.URLParam(r, "docID"), chi.URLParam(r, "guestID"), property.ID(r.Context())).Scan(&guestID, &front, &back)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Document not found.")
	}
	if err != nil {
		return err
	}
	key := front
	if side == "back" {
		key = back
	}
	if key == nil {
		return httpx.NotFound("No image for this side.")
	}
	h.logAccess(r.Context(), guestID, "viewed ID image ("+side+")")
	return h.serveEncrypted(w, r, *key)
}

// DocumentNumber reveals a full ID number (never available for Aadhaar). Logged.
func (h *Handler) DocumentNumber(w http.ResponseWriter, r *http.Request) error {
	var guestID string
	var sealed, visa []byte
	err := h.DB.QueryRow(r.Context(), `
		SELECT d.guest_id, d.number_encrypted, d.visa_number_encrypted FROM guest_documents d JOIN guests g ON g.id = d.guest_id
		WHERE d.id::text = $1 AND g.id::text = $2 AND g.property_id = $3`,
		chi.URLParam(r, "docID"), chi.URLParam(r, "guestID"), property.ID(r.Context())).Scan(&guestID, &sealed, &visa)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Document not found.")
	}
	if err != nil {
		return err
	}
	num, err := h.Box.OpenString(sealed)
	if err != nil {
		return err
	}
	visaNum, err := h.Box.OpenString(visa)
	if err != nil {
		return err
	}
	h.logAccess(r.Context(), guestID, "viewed ID number")
	httpx.JSON(w, http.StatusOK, map[string]string{"number": num, "visaNumber": visaNum})
	return nil
}
