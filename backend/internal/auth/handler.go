package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
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
	err := h.DB.QueryRow(r.Context(), `
		SELECT u.id, u.organization_id, u.name, u.email, u.role, u.password_hash, o.status
		FROM users u JOIN organizations o ON o.id = u.organization_id
		WHERE lower(u.email) = lower($1)`,
		strings.TrimSpace(req.Email)).Scan(&u.ID, &u.OrgID, &u.Name, &u.Email, &u.Role, &hash, &orgStatus)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if errors.Is(err, pgx.ErrNoRows) || hash == nil {
		_ = bcrypt.CompareHashAndPassword(DummyHash, []byte(req.Password))
		return httpx.Unauthorized("Email or password is incorrect.")
	}
	if bcrypt.CompareHashAndPassword([]byte(*hash), []byte(req.Password)) != nil {
		return httpx.Unauthorized("Email or password is incorrect.")
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
