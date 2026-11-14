// Package admin is the Gustlog platform console: super admins manage hotel
// clients, their properties and logos, subscriptions, and payments.
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/guestly/backend/internal/auth"
	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/storage"
)

const refreshCookie = "guestly_admin_refresh"
const cookiePath = "/api/v1/admin/auth"

type Handler struct {
	DB            *pgxpool.Pool
	Tokens        *auth.Tokens
	Store         storage.Store
	Signer        storage.Signer
	RefreshTTL    time.Duration
	SecureCookies bool
	AppURL        string
}

type Admin struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type session struct {
	AccessToken string `json:"accessToken"`
	Admin       Admin  `json:"admin"`
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		return err
	}
	var a Admin
	var hash string
	err := h.DB.QueryRow(r.Context(), `SELECT id, name, email, password_hash FROM platform_admins WHERE lower(email) = lower($1)`,
		strings.TrimSpace(req.Email)).Scan(&a.ID, &a.Name, &a.Email, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		_ = bcrypt.CompareHashAndPassword(auth.DummyHash, []byte(req.Password))
		return httpx.Unauthorized("Email or password is incorrect.")
	}
	if err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		return httpx.Unauthorized("Email or password is incorrect.")
	}
	return h.startSession(w, r, a)
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) error {
	c, err := r.Cookie(refreshCookie)
	if err != nil || c.Value == "" {
		return httpx.Unauthorized("Please sign in.")
	}
	var a Admin
	err = h.DB.QueryRow(r.Context(), `
		UPDATE admin_refresh_tokens rt SET revoked_at = now()
		FROM platform_admins a
		WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now() AND a.id = rt.admin_id
		RETURNING a.id, a.name, a.email`, auth.HashToken(c.Value)).Scan(&a.ID, &a.Name, &a.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		h.setCookie(w, "", time.Time{})
		return httpx.Unauthorized("Your session has ended. Please sign in again.")
	}
	if err != nil {
		return err
	}
	return h.startSession(w, r, a)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) error {
	if c, err := r.Cookie(refreshCookie); err == nil && c.Value != "" {
		if _, err := h.DB.Exec(r.Context(), `UPDATE admin_refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
			auth.HashToken(c.Value)); err != nil {
			return err
		}
	}
	h.setCookie(w, "", time.Time{})
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handler) startSession(w http.ResponseWriter, r *http.Request, a Admin) error {
	access, err := h.Tokens.IssueAdmin(a.ID)
	if err != nil {
		return err
	}
	raw, hash, err := auth.NewRefreshToken()
	if err != nil {
		return err
	}
	// Admin sessions are shorter-lived than hotel sessions.
	expires := time.Now().Add(min(h.RefreshTTL, 7*24*time.Hour))
	if _, err := h.DB.Exec(r.Context(), `INSERT INTO admin_refresh_tokens (admin_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
		a.ID, hash, expires); err != nil {
		return err
	}
	h.setCookie(w, raw, expires)
	httpx.JSON(w, http.StatusOK, session{AccessToken: access, Admin: a})
	return nil
}

func (h *Handler) setCookie(w http.ResponseWriter, value string, expires time.Time) {
	c := &http.Cookie{Name: refreshCookie, Value: value, Path: cookiePath, HttpOnly: true,
		Secure: h.SecureCookies, SameSite: http.SameSiteStrictMode}
	if value == "" {
		c.MaxAge = -1
	} else {
		c.Expires = expires
	}
	http.SetCookie(w, c)
}

// ---- Audit log ----

// audit records an admin action. It never fails the request; errors are logged.
func (h *Handler) audit(ctx context.Context, action, targetType, targetID string, details map[string]any) {
	adminID := auth.FromContext(ctx).UserID
	b, _ := json.Marshal(details)
	var target *string
	if targetID != "" {
		target = &targetID
	}
	if _, err := h.DB.Exec(context.WithoutCancel(ctx),
		`INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5)`,
		adminID, action, targetType, target, b); err != nil {
		slog.Error("audit log write failed", "action", action, "err", err)
	}
}

type auditEntry struct {
	ID         int64          `json:"id"`
	AdminName  string         `json:"adminName"`
	Action     string         `json:"action"`
	TargetType string         `json:"targetType"`
	TargetID   *string        `json:"targetId"`
	TargetName string         `json:"targetName"`
	Details    map[string]any `json:"details"`
	CreatedAt  time.Time      `json:"createdAt"`
}

func (h *Handler) AuditLog(w http.ResponseWriter, r *http.Request) error {
	rows, err := h.DB.Query(r.Context(), `
		SELECT l.id, coalesce(a.name, 'Removed admin'), l.action, l.target_type, l.target_id::text,
			coalesce(o.name, p.name, ''), l.details, l.created_at
		FROM admin_audit_log l
		LEFT JOIN platform_admins a ON a.id = l.admin_id
		LEFT JOIN organizations o ON l.target_type = 'client' AND o.id = l.target_id
		LEFT JOIN properties p ON l.target_type = 'property' AND p.id = l.target_id
		ORDER BY l.created_at DESC LIMIT 200`)
	if err != nil {
		return err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (auditEntry, error) {
		var e auditEntry
		err := row.Scan(&e.ID, &e.AdminName, &e.Action, &e.TargetType, &e.TargetID, &e.TargetName, &e.Details, &e.CreatedAt)
		return e, err
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}
