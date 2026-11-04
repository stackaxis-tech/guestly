package auth

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// InviteTTL is how long an invite link stays valid.
const InviteTTL = 7 * 24 * time.Hour

type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// CreateInvite revokes any open invites for the user and issues a new one.
// It returns the raw token, which is only ever shown to the admin as a link.
func CreateInvite(ctx context.Context, q execer, userID string) (string, error) {
	raw, hash, err := NewRefreshToken()
	if err != nil {
		return "", err
	}
	if _, err := q.Exec(ctx, `UPDATE invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, userID); err != nil {
		return "", err
	}
	_, err = q.Exec(ctx, `INSERT INTO invites (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
		userID, hash, time.Now().Add(InviteTTL))
	return raw, err
}
