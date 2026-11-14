package admin

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/guestly/backend/internal/httpx"
)

// receiptURL is the link a client can open to see (and print) their payment receipt. No login: the long random
// token in the link is the only credential.
func (h *Handler) receiptURL(token string) string {
	return strings.TrimRight(h.AppURL, "/") + "/p/" + token
}

// ReceiptView is what the public receipt page shows. Internal notes and who recorded it are left out.
type ReceiptView struct {
	ReceiptNo    string     `json:"receiptNo"`
	ClientName   string     `json:"clientName"`
	PropertyName string     `json:"propertyName"`
	Amount       int64      `json:"amount"`
	Mode         string     `json:"mode"`
	Reference    string     `json:"reference"`
	PaidOn       time.Time  `json:"paidOn"`
	PeriodFrom   time.Time  `json:"periodFrom"`
	PeriodTo     time.Time  `json:"periodTo"`
	Voided       bool       `json:"voided"`
	VoidedAt     *time.Time `json:"voidedAt"`
}

// PublicReceipt serves a client's receipt link.
func (h *Handler) PublicReceipt(w http.ResponseWriter, r *http.Request) error {
	var v ReceiptView
	err := h.DB.QueryRow(r.Context(), `
		SELECT cp.receipt_no, o.name, p.name, cp.amount, cp.mode, cp.reference, cp.paid_on, cp.period_from, cp.period_to, cp.voided_at
		FROM client_payments cp
		JOIN organizations o ON o.id = cp.organization_id
		JOIN properties p ON p.id = cp.property_id
		WHERE cp.public_token = $1`, chi.URLParam(r, "token")).
		Scan(&v.ReceiptNo, &v.ClientName, &v.PropertyName, &v.Amount, &v.Mode, &v.Reference, &v.PaidOn, &v.PeriodFrom, &v.PeriodTo, &v.VoidedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("This receipt link isn't valid.")
	}
	if err != nil {
		return err
	}
	v.Voided = v.VoidedAt != nil
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
	httpx.JSON(w, http.StatusOK, v)
	return nil
}
