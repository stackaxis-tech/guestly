package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/guestly/backend/internal/httpx"
)

const refreshCookie = "guestly_refresh"

// DummyHash is compared against when a login can't succeed, to keep timing uniform.
var DummyHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-password"), bcrypt.DefaultCost)

var errSuspended = httpx.Forbidden("This account is paused. Please contact Gustlog support.")

// Handler serves hotel-staff authentication. Hotels can't self-register:
// accounts are created by a Gustlog admin and activated through an invite.
type Handler struct {
	DB            *pgxpool.Pool
	Tokens        *Tokens
	RefreshTTL    time.Duration
	SecureCookies bool
}

type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  Role   `json:"role"`
	OrgID string `json:"organizationId"`
}

type session struct {
	AccessToken string `json:"accessToken"`
	User        User   `json:"user"`
	// Only set for the mobile apps, which can't use the httpOnly cookie.
	RefreshToken string `json:"refreshToken,omitempty"`
}

// isMobile reports whether the request comes from the Gustlog Android/iOS app.
func isMobile(r *http.Request) bool {
	return r.Header.Get("X-Client") == "mobile"
}

// presentedRefreshToken returns the refresh token from the JSON body for the
// mobile apps, and from the httpOnly cookie for browsers. Browsers can never
// authenticate with a body token, so cookie protections can't be sidestepped.
func presentedRefreshToken(r *http.Request) string {
	if isMobile(r) {
		var body struct {
			RefreshToken string `json:"refreshToken"`
		}
		if json.NewDecoder(http.MaxBytesReader(nil, r.Body, 4096)).Decode(&body) != nil {
			return ""
		}
		return body.RefreshToken
	}
	if c, err := r.Cookie(refreshCookie); err == nil {
		return c.Value
	}
	return ""
}

var (
	phoneRe = regexp.MustCompile(`^(?:\+91)?[6-9]\d{9}$`)
)

type registerReq struct {
	HotelName     string `json:"hotelName"`
	Name          string `json:"name"`
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	Password      string `json:"password"`
	AcceptedTerms bool   `json:"acceptedTerms"`
}

func normalizeIndianPhone(raw string) string {
	digits := regexp.MustCompile(`\D`).ReplaceAllString(raw, "")
	if len(digits) == 12 && strings.HasPrefix(digits, "91") {
		return digits[2:]
	}
	return digits
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) error {
	var req registerReq
	if err := httpx.Decode(r, &req); err != nil {
		return err
	}

	req.HotelName = strings.TrimSpace(req.HotelName)
	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Phone = strings.TrimSpace(req.Phone)

	f := map[string]string{}
	if len(req.HotelName) < 2 || len(req.HotelName) > 100 {
		f["hotelName"] = "Hotel name must be between 2 and 100 characters."
	}
	if len(req.Name) < 2 || len(req.Name) > 80 {
		f["name"] = "Your name must be between 2 and 80 characters."
	}
	if req.Email == "" {
		f["email"] = "Enter a valid email address."
	} else if _, err := mail.ParseAddress(req.Email); err != nil {
		f["email"] = "Enter a valid email address."
	}
	normPhone := normalizeIndianPhone(req.Phone)
	if !phoneRe.MatchString(req.Phone) || len(normPhone) != 10 {
		f["phone"] = "Enter a valid 10-digit Indian mobile number."
	}
	if len(req.Password) < 8 {
		f["password"] = "Password must be at least 8 characters."
	}
	if !req.AcceptedTerms {
		f["acceptedTerms"] = "Please accept the Terms and Privacy Policy to continue."
	}
	if len(f) > 0 {
		return httpx.Invalid(f)
	}

	ctx := r.Context()

	// Check for duplicate email
	var existingEmail string
	err := h.DB.QueryRow(ctx, `SELECT email FROM users WHERE lower(email) = lower($1)`, req.Email).Scan(&existingEmail)
	if err == nil {
		return &httpx.Error{
			Status:  http.StatusConflict,
			Code:    "conflict",
			Message: "An account with this email already exists. Sign in instead.",
			Fields:  map[string]string{"email": "An account with this email already exists. Sign in instead."},
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	// Check for duplicate phone across users and organizations to prevent endless trial abuse (section 10)
	var existingPhone string
	err = h.DB.QueryRow(ctx, `
		SELECT phone FROM users WHERE phone = $1
		UNION
		SELECT contact_phone FROM organizations WHERE contact_phone = $1 LIMIT 1`, normPhone).Scan(&existingPhone)
	if err == nil {
		return httpx.Invalid(map[string]string{
			"phone": "A free trial has already been registered with this mobile number. Sign in or contact Gustlog.",
		})
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var orgID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO organizations (name, contact_name, contact_phone, contact_email)
		VALUES ($1, $2, $3, $4) RETURNING id`,
		req.HotelName, req.Name, normPhone, req.Email).Scan(&orgID); err != nil {
		return err
	}

	var propID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO properties (organization_id, name, phone, email, invoice_prefix)
		VALUES ($1, $2, $3, $4, 'INV') RETURNING id`,
		orgID, req.HotelName, normPhone, req.Email).Scan(&propID); err != nil {
		return err
	}

	ist, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		ist = time.FixedZone("IST", 5*3600+1800)
	}
	today := time.Now().In(ist)
	start := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	// 30 days trial: inclusive [today, today+29]
	end := start.AddDate(0, 0, 29)
	if _, err := tx.Exec(ctx, `
		INSERT INTO subscriptions (property_id, plan, amount, period_months, is_trial, starts_on, ends_on, grace_days)
		VALUES ($1, 'monthly', 0, 1, true, $2, $3, 7)`,
		propID, start, end); err != nil {
		return err
	}

	var u User
	u.OrgID = orgID
	u.Name = req.Name
	u.Email = req.Email
	u.Role = RoleOwner
	if err := tx.QueryRow(ctx, `
		INSERT INTO users (organization_id, name, email, phone, role, password_hash)
		VALUES ($1, $2, $3, $4, 'owner', $5)
		RETURNING id`,
		orgID, req.Name, req.Email, normPhone, string(hash)).Scan(&u.ID); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return &httpx.Error{
				Status:  http.StatusConflict,
				Code:    "conflict",
				Message: "An account with this email already exists. Sign in instead.",
				Fields:  map[string]string{"email": "An account with this email already exists. Sign in instead."},
			}
		}
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	return h.startSession(w, r, u, http.StatusCreated)
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) error {
	var req loginReq
	if err := httpx.Decode(r, &req); err != nil {
		return err
	}
	var u User
	var hash *string
	var orgStatus string
	loginID := strings.TrimSpace(req.Email)
	normPhone := normalizeIndianPhone(loginID)
	err := h.DB.QueryRow(r.Context(), `
		SELECT u.id, u.organization_id, u.name, u.email, u.role, u.password_hash, o.status
		FROM users u JOIN organizations o ON o.id = u.organization_id
		WHERE lower(u.email) = lower($1) OR (u.phone IS NOT NULL AND u.phone != '' AND (u.phone = $1 OR (length($2) = 10 AND u.phone = $2)))`,
		loginID, normPhone).Scan(&u.ID, &u.OrgID, &u.Name, &u.Email, &u.Role, &hash, &orgStatus)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if errors.Is(err, pgx.ErrNoRows) || hash == nil {
		_ = bcrypt.CompareHashAndPassword(DummyHash, []byte(req.Password))
		return httpx.Unauthorized("Login ID or password is incorrect.")
	}
	if bcrypt.CompareHashAndPassword([]byte(*hash), []byte(req.Password)) != nil {
		return httpx.Unauthorized("Login ID or password is incorrect.")
	}
	if orgStatus == "suspended" {
		return errSuspended
	}
	return h.startSession(w, r, u, http.StatusOK)
}

// Refresh rotates the refresh token and issues a new access token.
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) error {
	raw := presentedRefreshToken(r)
	if raw == "" {
		return httpx.Unauthorized("Please sign in.")
	}
	ctx := r.Context()
	var u User
	var orgStatus string
	err := h.DB.QueryRow(ctx, `
		UPDATE refresh_tokens rt SET revoked_at = now()
		FROM users u JOIN organizations o ON o.id = u.organization_id
		WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now() AND u.id = rt.user_id
		RETURNING u.id, u.organization_id, u.name, u.email, u.role, o.status`,
		HashToken(raw)).Scan(&u.ID, &u.OrgID, &u.Name, &u.Email, &u.Role, &orgStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		h.clearCookie(w)
		return httpx.Unauthorized("Your session has ended. Please sign in again.")
	}
	if err != nil {
		return err
	}
	if orgStatus == "suspended" {
		h.clearCookie(w)
		return errSuspended
	}
	return h.startSession(w, r, u, http.StatusOK)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) error {
	if raw := presentedRefreshToken(r); raw != "" {
		if _, err := h.DB.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, HashToken(raw)); err != nil {
			return err
		}
	}
	h.clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) error {
	p := FromContext(r.Context())
	var u User
	err := h.DB.QueryRow(r.Context(), `SELECT id, organization_id, name, email, role FROM users WHERE id = $1`, p.UserID).
		Scan(&u.ID, &u.OrgID, &u.Name, &u.Email, &u.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.Unauthorized("Account not found.")
	}
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, u)
	return nil
}

// ---- Invites ----

type inviteInfo struct {
	Name         string `json:"name"`
	Email        string `json:"email"`
	Organization string `json:"organization"`
}

const inviteLookup = `
	SELECT u.id, u.organization_id, u.name, u.email, u.role, o.name
	FROM invites i JOIN users u ON u.id = i.user_id JOIN organizations o ON o.id = u.organization_id
	WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now() AND o.status = 'active'`

const inviteGone = "This invite link has expired or was already used. Ask Gustlog for a new one."

// GetInvite lets the set-password page greet the invited person.
func (h *Handler) GetInvite(w http.ResponseWriter, r *http.Request) error {
	var u User
	var info inviteInfo
	err := h.DB.QueryRow(r.Context(), inviteLookup, HashToken(chi.URLParam(r, "token"))).
		Scan(&u.ID, &u.OrgID, &info.Name, &info.Email, &u.Role, &info.Organization)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound(inviteGone)
	}
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, info)
	return nil
}

type acceptReq struct {
	Password string `json:"password"`
}

// AcceptInvite sets the user's password, consumes the invite, and signs them in.
func (h *Handler) AcceptInvite(w http.ResponseWriter, r *http.Request) error {
	var req acceptReq
	if err := httpx.Decode(r, &req); err != nil {
		return err
	}
	if len(req.Password) < 8 {
		return httpx.Invalid(map[string]string{"password": "Use at least 8 characters."})
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var u User
	var orgName string
	err = tx.QueryRow(ctx, inviteLookup+` FOR UPDATE OF i`, HashToken(chi.URLParam(r, "token"))).
		Scan(&u.ID, &u.OrgID, &u.Name, &u.Email, &u.Role, &orgName)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound(inviteGone)
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, u.ID, string(hash)); err != nil {
		return err
	}
	// Consume every outstanding invite for this user, not just this one.
	if _, err := tx.Exec(ctx, `UPDATE invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, u.ID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return h.startSession(w, r, u, http.StatusOK)
}

func (h *Handler) startSession(w http.ResponseWriter, r *http.Request, u User, status int) error {
	access, err := h.Tokens.IssueAccess(Principal{UserID: u.ID, OrgID: u.OrgID, Role: u.Role})
	if err != nil {
		return err
	}
	raw, hash, err := NewRefreshToken()
	if err != nil {
		return err
	}
	expires := time.Now().Add(h.RefreshTTL)
	if _, err := h.DB.Exec(r.Context(),
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`, u.ID, hash, expires); err != nil {
		return err
	}
	out := session{AccessToken: access, User: u}
	if isMobile(r) {
		out.RefreshToken = raw
	} else {
		http.SetCookie(w, &http.Cookie{
			Name: refreshCookie, Value: raw, Path: "/api/v1/auth", Expires: expires,
			HttpOnly: true, Secure: h.SecureCookies, SameSite: http.SameSiteLaxMode,
		})
	}
	httpx.JSON(w, status, out)
	return nil
}

func (h *Handler) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookie, Value: "", Path: "/api/v1/auth", MaxAge: -1,
		HttpOnly: true, Secure: h.SecureCookies, SameSite: http.SameSiteLaxMode,
	})
}
