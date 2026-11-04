package billing

import (
	"testing"
	"time"
)

func d(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestStatusOn(t *testing.T) {
	sub := Subscription{EndsOn: d("2026-11-30"), GraceDays: 7}
	cases := []struct {
		today    string
		trial    bool
		want     State
		readOnly bool
	}{
		{"2026-11-01", true, StateTrial, false},
		{"2026-11-01", false, StateActive, false},
		{"2026-11-30", false, StateActive, false}, // end date inclusive
		{"2026-12-01", false, StateGrace, false},
		{"2026-12-07", false, StateGrace, false}, // last grace day
		{"2026-12-08", false, StateExpired, true},
		{"2026-12-01", true, StateGrace, false}, // expired trial gets grace too
	}
	for _, c := range cases {
		s := sub
		s.IsTrial = c.trial
		got := s.StatusOn(d(c.today))
		if got.State != c.want || got.ReadOnly != c.readOnly {
			t.Errorf("%s trial=%v: got %+v, want %s readOnly=%v", c.today, c.trial, got, c.want, c.readOnly)
		}
	}
	if g := sub.StatusOn(d("2026-12-03")).GraceDaysLeft; g != 4 {
		t.Errorf("GraceDaysLeft = %d, want 4", g)
	}
}

func TestExtendFrom(t *testing.T) {
	sub := Subscription{EndsOn: d("2026-11-30"), GraceDays: 7}
	cases := []struct {
		paid, from, to string
		months         int
	}{
		{"2026-11-15", "2026-12-01", "2027-11-30", 12}, // early renewal continues
		{"2026-12-05", "2026-12-01", "2026-12-31", 1},  // within grace: no free days
		{"2027-01-10", "2027-01-10", "2027-02-09", 1},  // after grace: fresh start
	}
	for _, c := range cases {
		from, to := sub.ExtendFrom(d(c.paid), c.months)
		if !from.Equal(d(c.from)) || !to.Equal(d(c.to)) {
			t.Errorf("paid %s: got %s..%s, want %s..%s", c.paid, from.Format("2006-01-02"), to.Format("2006-01-02"), c.from, c.to)
		}
	}
}

func TestFinancialYear(t *testing.T) {
	for in, want := range map[string]string{"2026-03-31": "2025-26", "2026-04-01": "2026-27", "2099-12-31": "2099-00"} {
		if got := FinancialYear(d(in)); got != want {
			t.Errorf("FinancialYear(%s) = %s, want %s", in, got, want)
		}
	}
	if got := ReceiptNo("2026-27", 7); got != "GST/2026-27/0007" {
		t.Errorf("ReceiptNo = %s", got)
	}
}
