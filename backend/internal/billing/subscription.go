// Package billing holds Guestlog's own subscription rules for hotel clients:
// subscription state, period extension on payment, and receipt numbering.
package billing

import (
	"fmt"
	"time"
)

type State string

const (
	StateTrial   State = "trial"
	StateActive  State = "active"
	StateGrace   State = "grace"   // past end date, still writable, banners shown
	StateExpired State = "expired" // past grace: property is read-only
)

type Subscription struct {
	ID           string    `json:"id"`
	PropertyID   string    `json:"propertyId"`
	Plan         string    `json:"plan"`
	Amount       int64     `json:"amount"`
	PeriodMonths int       `json:"periodMonths"`
	IsTrial      bool      `json:"isTrial"`
	StartsOn     time.Time `json:"startsOn"`
	EndsOn       time.Time `json:"endsOn"`
	GraceDays    int       `json:"graceDays"`
}

// Status is the computed view of a subscription on a given day.
type Status struct {
	State State `json:"state"`
	// DaysLeft is days until EndsOn (negative once past it).
	DaysLeft int `json:"daysLeft"`
	// GraceDaysLeft is days until the property becomes read-only (only meaningful in grace).
	GraceDaysLeft int  `json:"graceDaysLeft"`
	ReadOnly      bool `json:"readOnly"`
}

func dateOnly(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func daysBetween(from, to time.Time) int {
	return int(dateOnly(to).Sub(dateOnly(from)).Hours() / 24)
}

// StatusOn computes the subscription state on `today`. The end date is inclusive.
func (s Subscription) StatusOn(today time.Time) Status {
	left := daysBetween(today, s.EndsOn)
	switch {
	case left >= 0 && s.IsTrial:
		return Status{State: StateTrial, DaysLeft: left}
	case left >= 0:
		return Status{State: StateActive, DaysLeft: left}
	case -left <= s.GraceDays:
		return Status{State: StateGrace, DaysLeft: left, GraceDaysLeft: s.GraceDays + left}
	default:
		return Status{State: StateExpired, DaysLeft: left, ReadOnly: true}
	}
}

// ExtendFrom returns the new period after a payment made on `paidOn`.
// Paying before expiry or within grace continues from the old end date (no free
// days). Paying after grace starts a fresh period from the payment date.
func (s Subscription) ExtendFrom(paidOn time.Time, months int) (from, to time.Time) {
	end := dateOnly(s.EndsOn)
	paid := dateOnly(paidOn)
	if daysBetween(end, paid) > s.GraceDays {
		from = paid
	} else {
		from = end.AddDate(0, 0, 1)
	}
	return from, from.AddDate(0, months, -1)
}

// FinancialYear returns the Indian financial year label for a date, e.g. "2026-27".
func FinancialYear(t time.Time) string {
	y := t.Year()
	if t.Month() < time.April {
		y--
	}
	return fmt.Sprintf("%d-%02d", y, (y+1)%100)
}

// ReceiptNo formats a Guestlog payment receipt number.
func ReceiptNo(fy string, n int) string {
	return fmt.Sprintf("GST/%s/%04d", fy, n)
}
