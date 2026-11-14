// Package auth handles sign-up, login, token refresh, and request authentication.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/guestly/backend/internal/httpx"
)

type Role string

const (
	RoleOwner        Role = "owner"
	RoleManager      Role = "manager"
	RoleFrontDesk    Role = "front_desk"
	RoleHousekeeping Role = "housekeeping"
)

// Principal is the authenticated user attached to a request.
type Principal struct {
	UserID string
	OrgID  string
	Role   Role
}

// Token scopes. Hotel tokens and Gustlog platform tokens are never interchangeable.
const (
	ScopeHotel    = "hotel"
	ScopePlatform = "platform"
)

type claims struct {
	Scope string `json:"scope"`
	OrgID string `json:"org,omitempty"`
	Role  Role   `json:"role,omitempty"`
	jwt.RegisteredClaims
}

type Tokens struct {
	secret    []byte
	accessTTL time.Duration
}

func NewTokens(secret []byte, accessTTL time.Duration) *Tokens {
	return &Tokens{secret: secret, accessTTL: accessTTL}
}

func (t *Tokens) IssueAccess(p Principal) (string, error) {
	return t.issue(ScopeHotel, p)
}

// IssueAdmin issues a platform-scoped token for a Gustlog admin.
func (t *Tokens) IssueAdmin(adminID string) (string, error) {
	return t.issue(ScopePlatform, Principal{UserID: adminID})
}

func (t *Tokens) issue(scope string, p Principal) (string, error) {
	now := time.Now()
	c := claims{
		Scope: scope,
		OrgID: p.OrgID,
		Role:  p.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   p.UserID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(t.accessTTL)),
			Issuer:    "guestly",
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(t.secret)
}

func (t *Tokens) parse(raw, scope string) (Principal, error) {
	var c claims
	_, err := jwt.ParseWithClaims(raw, &c, func(tok *jwt.Token) (any, error) {
		return t.secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("guestly"))
	if err != nil {
		return Principal{}, err
	}
	if c.Scope != scope {
		return Principal{}, errors.New("wrong token scope")
	}
	return Principal{UserID: c.Subject, OrgID: c.OrgID, Role: c.Role}, nil
}

// newRefreshToken returns the raw token (sent to the client) and its hash (stored).
func NewRefreshToken() (string, []byte, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, fmt.Errorf("rand: %w", err)
	}
	raw := base64.RawURLEncoding.EncodeToString(b)
	return raw, HashToken(raw), nil
}

func HashToken(raw string) []byte {
	h := sha256.Sum256([]byte(raw))
	return h[:]
}

type ctxKey struct{}

func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

// FromContext returns the principal set by Authenticate. Handlers behind that
// middleware can rely on it being present.
func FromContext(ctx context.Context) Principal {
	p, _ := ctx.Value(ctxKey{}).(Principal)
	return p
}

// Authenticate requires a valid hotel-scoped Bearer token.
func (t *Tokens) Authenticate(next http.Handler) http.Handler {
	return t.authenticate(ScopeHotel, next)
}

// AuthenticateAdmin requires a valid platform-scoped Bearer token.
// The admin's ID is available as FromContext(ctx).UserID.
func (t *Tokens) AuthenticateAdmin(next http.Handler) http.Handler {
	return t.authenticate(ScopePlatform, next)
}

func (t *Tokens) authenticate(scope string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || raw == "" {
			httpx.WriteError(w, r, httpx.Unauthorized("Please sign in."))
			return
		}
		p, err := t.parse(raw, scope)
		if err != nil {
			msg := "Your session is invalid. Please sign in again."
			if errors.Is(err, jwt.ErrTokenExpired) {
				msg = "Your session has expired."
			}
			httpx.WriteError(w, r, httpx.Unauthorized(msg))
			return
		}
		next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
	})
}

// RequireRole allows only the listed roles through.
func RequireRole(roles ...Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := FromContext(r.Context())
			if slices.Contains(roles, p.Role) {
				next.ServeHTTP(w, r)
				return
			}
			httpx.WriteError(w, r, httpx.Forbidden("Your role doesn't allow this action."))
		})
	}
}
