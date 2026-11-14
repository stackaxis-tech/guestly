package admin

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/guestly/backend/internal/auth"
	"github.com/guestly/backend/internal/billing"
	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/property"
)

var authCreateInvite = auth.CreateInvite

type Payment struct {
	ID           string    `json:"id"`
	ClientID     string    `json:"clientId"`
	ClientName   string    `json:"clientName"`
	PropertyID   string    `json:"propertyId"`
	PropertyName string    `json:"propertyName"`
	Amount       int64     `json:"amount"`
	Mode         string    `json:"mode"`
	Reference    string    `json:"reference"`
	PaidOn       time.Time `json:"paidOn"`
	ReceiptNo    string    `json:"receiptNo"`
	PeriodFrom   time.Time `json:"periodFrom"`
	PeriodTo     time.Time `json:"periodTo"`
	Notes        string    `json:"notes"`
	RecordedBy   string    `json:"recordedBy"`
	CreatedAt    time.Time `json:"createdAt"`
	// A voided payment keeps its row and receipt number; it no longer counts as money received.
	Voided     bool       `json:"voided"`
	VoidedAt   *time.Time `json:"voidedAt"`
	VoidReason string     `json:"voidReason"`
	// CanVoid is true only for the latest payment of a property that is not already void.
	CanVoid    bool   `json:"canVoid"`
	ReceiptURL string `json:"receiptUrl"`
}

// paymentDetails is what an admin enters when recording money received from a client.
type paymentDetails struct {
	Amount    int64  `json:"amount"`
	Mode      string `json:"mode"`
	Reference string `json:"reference"`
	PaidOn    string `json:"paidOn"` // YYYY-MM-DD
	Months    int    `json:"months"` // 0 = the subscription's period
	Notes     string `json:"notes"`

	paidOn time.Time
}

func (p *paymentDetails) normalize(f map[string]string, prefix string) {
	p.Reference = strings.TrimSpace(p.Reference)
	p.Notes = strings.TrimSpace(p.Notes)
	if p.Amount <= 0 {
		f[prefix+"amount"] = "Enter the amount received."
	}
	switch p.Mode {
	case "upi", "bank":
		if p.Reference == "" {
			f[prefix+"reference"] = "Enter the UTR / transaction reference."
		}
	case "cash", "other":
	default:
		f[prefix+"mode"] = "Choose how they paid."
	}
	t, err := time.Parse("2006-01-02", p.PaidOn)
	today := property.Today()
	todayUTC := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	switch {
	case err != nil:
		f[prefix+"paidOn"] = "Enter the date it was paid."
	case t.After(todayUTC):
		f[prefix+"paidOn"] = "Payment date can't be in the future."
	case t.Before(todayUTC.AddDate(-1, 0, 0)):
		f[prefix+"paidOn"] = "Payment date is more than a year ago."
	}
	p.paidOn = t
	if p.Months < 0 || p.Months > 36 {
		f[prefix+"months"] = "Choose 1 to 36 months."
	}
}

// recordPayment stores a payment, issues a receipt number, and extends the property's subscription.
func (h *Handler) recordPayment(ctx context.Context, tx pgx.Tx, orgID, propertyID string, in paymentDetails) (*Payment, error) {
	var sub billing.Subscription
	err := tx.QueryRow(ctx, `
		SELECT id, plan, amount, period_months, is_trial, starts_on, ends_on, grace_days
		FROM subscriptions WHERE property_id = $1 FOR UPDATE`, propertyID).
		Scan(&sub.ID, &sub.Plan, &sub.Amount, &sub.PeriodMonths, &sub.IsTrial, &sub.StartsOn, &sub.EndsOn, &sub.GraceDays)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.Conflict("This property has no plan yet. Set up its plan first.")
	}
	if err != nil {
		return nil, err
	}

	if in.Reference != "" {
		var dup bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM client_payments WHERE mode = $1 AND lower(reference) = lower($2) AND voided_at IS NULL)`,
			in.Mode, in.Reference).Scan(&dup); err != nil {
			return nil, err
		}
		if dup {
			return nil, httpx.Invalid(map[string]string{"reference": "A payment with this reference is already recorded."})
		}
	}

	months := in.Months
	if months == 0 {
		months = sub.PeriodMonths
	}
	from, to := sub.ExtendFrom(in.paidOn, months)

	fy := billing.FinancialYear(in.paidOn)
	var n int
	if err := tx.QueryRow(ctx, `
		INSERT INTO receipt_counters (financial_year, last_no) VALUES ($1, 1)
		ON CONFLICT (financial_year) DO UPDATE SET last_no = receipt_counters.last_no + 1
		RETURNING last_no`, fy).Scan(&n); err != nil {
		return nil, err
	}

	var token string
	p := Payment{ClientID: orgID, PropertyID: propertyID, Amount: in.Amount, Mode: in.Mode, Reference: in.Reference,
		PaidOn: in.paidOn, ReceiptNo: billing.ReceiptNo(fy, n), PeriodFrom: from, PeriodTo: to, Notes: in.Notes}
	if err := tx.QueryRow(ctx, `
		INSERT INTO client_payments (organization_id, property_id, amount, mode, reference, paid_on, receipt_no,
			period_from, period_to, notes, recorded_by, prev_ends_on, prev_is_trial)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, created_at, public_token`,
		orgID, propertyID, in.Amount, in.Mode, in.Reference, in.paidOn, p.ReceiptNo, from, to, in.Notes,
		auth.FromContext(ctx).UserID, sub.EndsOn, sub.IsTrial).Scan(&p.ID, &p.CreatedAt, &token); err != nil {
		return nil, err
	}
	p.CanVoid = true
	p.ReceiptURL = h.receiptURL(token)
	if _, err := tx.Exec(ctx, `UPDATE subscriptions SET ends_on = $2, is_trial = false, updated_at = now() WHERE id = $1`,
		sub.ID, to); err != nil {
		return nil, err
	}
	return &p, nil
}

func (h *Handler) RecordPayment(w http.ResponseWriter, r *http.Request) error {
	var in paymentDetails
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	f := map[string]string{}
	in.normalize(f, "")
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	ctx := r.Context()
	propertyID := chi.URLParam(r, "propertyID")
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var orgID string
	if err := tx.QueryRow(ctx, `SELECT organization_id FROM properties WHERE id::text = $1`, propertyID).Scan(&orgID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.NotFound("Property not found.")
		}
		return err
	}
	p, err := h.recordPayment(ctx, tx, orgID, propertyID, in)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	h.audit(ctx, "payment.recorded", "property", propertyID, map[string]any{
		"amount": p.Amount, "mode": p.Mode, "reference": p.Reference, "receipt": p.ReceiptNo,
		"periodTo": p.PeriodTo.Format("2006-01-02"),
	})
	httpx.JSON(w, http.StatusCreated, p)
	return nil
}

func (h *Handler) queryPayments(ctx context.Context, clientID string, limit int) ([]Payment, error) {
	rows, err := h.DB.Query(ctx, `
		SELECT cp.id, o.id, o.name, p.id, p.name, cp.amount, cp.mode, cp.reference, cp.paid_on, cp.receipt_no,
			cp.period_from, cp.period_to, cp.notes, coalesce(a.name, ''), cp.created_at,
			cp.voided_at, cp.void_reason, cp.public_token,
			(cp.voided_at IS NULL AND NOT EXISTS (
				SELECT 1 FROM client_payments n
				WHERE n.property_id = cp.property_id AND n.voided_at IS NULL AND n.id <> cp.id
					AND (n.period_to, n.created_at) > (cp.period_to, cp.created_at)))
		FROM client_payments cp
		JOIN organizations o ON o.id = cp.organization_id
		JOIN properties p ON p.id = cp.property_id
		LEFT JOIN platform_admins a ON a.id = cp.recorded_by
		WHERE ($1 = '' OR o.id::text = $1)
		ORDER BY cp.paid_on DESC, cp.created_at DESC
		LIMIT $2`, clientID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Payment, error) {
		var p Payment
		var token string
		err := row.Scan(&p.ID, &p.ClientID, &p.ClientName, &p.PropertyID, &p.PropertyName, &p.Amount, &p.Mode, &p.Reference,
			&p.PaidOn, &p.ReceiptNo, &p.PeriodFrom, &p.PeriodTo, &p.Notes, &p.RecordedBy, &p.CreatedAt,
			&p.VoidedAt, &p.VoidReason, &token, &p.CanVoid)
		p.Voided = p.VoidedAt != nil
		p.ReceiptURL = h.receiptURL(token)
		return p, err
	})
}

func (h *Handler) ListPayments(w http.ResponseWriter, r *http.Request) error {
	out, err := h.queryPayments(r.Context(), "", 1000)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

type subscriptionInput struct {
	Plan         string `json:"plan"`
	Amount       int64  `json:"amount"`
	PeriodMonths int    `json:"periodMonths"`
	GraceDays    int    `json:"graceDays"`
	EndsOn       string `json:"endsOn"` // manual correction, YYYY-MM-DD
	Reason       string `json:"reason"`
}

// UpdateSubscription changes a property's plan terms or corrects its end date.
func (h *Handler) UpdateSubscription(w http.ResponseWriter, r *http.Request) error {
	var in subscriptionInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	f := map[string]string{}
	switch in.Plan {
	case "monthly":
		in.PeriodMonths = 1
	case "annual":
		in.PeriodMonths = 12
	case "custom":
		if in.PeriodMonths < 1 || in.PeriodMonths > 36 {
			f["periodMonths"] = "Choose a period between 1 and 36 months."
		}
	default:
		f["plan"] = "Choose a plan."
	}
	if in.Amount < 0 {
		f["amount"] = "Amount can't be negative."
	}
	if in.GraceDays < 0 || in.GraceDays > 60 {
		f["graceDays"] = "Grace period can be 0 to 60 days."
	}
	ends, err := time.Parse("2006-01-02", in.EndsOn)
	if err != nil {
		f["endsOn"] = "Enter a valid end date."
	}
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	id := chi.URLParam(r, "propertyID")
	tag, err := h.DB.Exec(r.Context(), `
		UPDATE subscriptions SET plan=$2, amount=$3, period_months=$4, grace_days=$5,
			starts_on = least(starts_on, $6::date), ends_on = $6::date, updated_at=now()
		WHERE property_id::text = $1`, id, in.Plan, in.Amount, in.PeriodMonths, in.GraceDays, ends)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("This property has no plan.")
	}
	h.audit(r.Context(), "subscription.updated", "property", id, map[string]any{
		"plan": in.Plan, "amount": in.Amount, "endsOn": in.EndsOn, "graceDays": in.GraceDays, "reason": in.Reason,
	})
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// VoidPayment cancels a payment recorded by mistake. Only the latest payment of a property can be voided, so the
// plan's end date can go back to exactly what it was before. The receipt number is kept (numbers stay gapless);
// the row is marked void, stops counting as revenue, and its receipt link shows "Void".
func (h *Handler) VoidPayment(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Reason string `json:"reason"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Reason == "" {
		return httpx.Invalid(map[string]string{"reason": "Say why this payment is being voided."})
	}
	if len(in.Reason) > 300 {
		return httpx.Invalid(map[string]string{"reason": "Keep the reason under 300 characters."})
	}

	ctx := r.Context()
	id := chi.URLParam(r, "paymentID")
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var (
		propertyID, receipt  string
		amount               int64
		periodFrom, periodTo time.Time
		createdAt            time.Time
		prevEnds             *time.Time
		prevTrial            *bool
		alreadyVoid          bool
	)
	err = tx.QueryRow(ctx, `
		SELECT property_id::text, receipt_no, amount, period_from, period_to, created_at, prev_ends_on, prev_is_trial,
			voided_at IS NOT NULL
		FROM client_payments WHERE id::text = $1`, id).
		Scan(&propertyID, &receipt, &amount, &periodFrom, &periodTo, &createdAt, &prevEnds, &prevTrial, &alreadyVoid)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Payment not found.")
	}
	if err != nil {
		return err
	}
	if alreadyVoid {
		return httpx.Conflict("This payment is already void.")
	}

	// Lock the plan, then make sure nothing newer sits on top of this payment.
	var subID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM subscriptions WHERE property_id::text = $1 FOR UPDATE`, propertyID).Scan(&subID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.Conflict("This property has no plan.")
		}
		return err
	}
	var newer bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM client_payments
			WHERE property_id::text = $1 AND voided_at IS NULL AND id::text <> $2
				AND (period_to, created_at) > ($3::date, $4::timestamptz))`,
		propertyID, id, periodTo, createdAt).Scan(&newer); err != nil {
		return err
	}
	if newer {
		return httpx.Conflict("A newer payment exists for this property. Void that one first.")
	}

	// Put the plan back as it was before this payment.
	endsOn, wasTrial := periodFrom.AddDate(0, 0, -1), false
	if prevEnds != nil {
		endsOn = *prevEnds
	}
	if prevTrial != nil {
		wasTrial = *prevTrial
	}
	if _, err := tx.Exec(ctx, `
		UPDATE subscriptions SET ends_on = greatest($2::date, starts_on), is_trial = $3, updated_at = now()
		WHERE id::text = $1`, subID, endsOn, wasTrial); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE client_payments SET voided_at = now(), void_reason = $2, voided_by = $3 WHERE id::text = $1`,
		id, in.Reason, auth.FromContext(ctx).UserID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	h.audit(ctx, "payment.voided", "property", propertyID, map[string]any{
		"amount": amount, "receipt": receipt, "reason": in.Reason, "endsOn": endsOn.Format("2006-01-02"),
	})
	w.WriteHeader(http.StatusNoContent)
	return nil
}
