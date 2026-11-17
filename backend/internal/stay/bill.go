package stay

import (
	"regexp"
	"strings"
	"time"
)

// TaxConfig is a property's GST setup. Rates are in basis points (5% = 500).
// Hotel accommodation's place of supply is the hotel itself, so GST is always
// split equally into CGST + SGST.
type TaxConfig struct {
	Registered    bool
	RoomThreshold int64 // paise per night; tariff <= threshold uses RoomLowBP
	RoomLowBP     int
	RoomHighBP    int
}

// RoomRateBP returns the GST rate for a nightly tariff.
func (t TaxConfig) RoomRateBP(nightly int64) int {
	if !t.Registered {
		return 0
	}
	if nightly <= t.RoomThreshold {
		return t.RoomLowBP
	}
	return t.RoomHighBP
}

type Line struct {
	Description string `json:"description"`
	Quantity    int    `json:"quantity"`
	UnitPrice   int64  `json:"unitPrice"`
	Taxable     int64  `json:"taxable"`
	GSTRateBP   int    `json:"gstRateBp"`
	CGST        int64  `json:"cgst"`
	SGST        int64  `json:"sgst"`
	Total       int64  `json:"total"`
	ChargeID    string `json:"chargeId,omitempty"` // empty for the room line
}

type Bill struct {
	Lines    []Line `json:"lines"`
	Taxable  int64  `json:"taxable"`
	CGST     int64  `json:"cgst"`
	SGST     int64  `json:"sgst"`
	Total    int64  `json:"total"`
	Paid     int64  `json:"paid"`
	Balance  int64  `json:"balance"` // positive = guest owes
	Nights   int    `json:"nights"`
	Estimate bool   `json:"estimate"` // true while in-house (nights may still change)
	// Checkout preview only: minutes past the checkout time (beyond the grace
	// period), so staff can add a late-checkout fee if the hotel charges one.
	LateCheckoutMinutes int `json:"lateCheckoutMinutes,omitempty"`
}

// MakeLine computes tax for one line. Each half of GST is rounded to the
// nearest paisa so CGST and SGST are always equal.
func MakeLine(desc string, qty int, unit int64, rateBP int) Line {
	taxable := unit * int64(qty)
	// Integer maths, rounded half up: money never goes through floats.
	half := (taxable*int64(rateBP) + 10000) / 20000
	return Line{Description: desc, Quantity: qty, UnitPrice: unit, Taxable: taxable, GSTRateBP: rateBP,
		CGST: half, SGST: half, Total: taxable + 2*half}
}

// Summarize totals the lines and applies payments.
func Summarize(lines []Line, paid int64, nights int, estimate bool) Bill {
	b := Bill{Lines: lines, Paid: paid, Nights: nights, Estimate: estimate}
	for _, l := range lines {
		b.Taxable += l.Taxable
		b.CGST += l.CGST
		b.SGST += l.SGST
		b.Total += l.Total
	}
	b.Balance = b.Total - paid
	return b
}

// Nights counts hotel nights between check-in and checkout in the hotel's
// timezone: the number of calendar dates crossed, minimum one. A late checkout
// is charged with an explicit extra charge, not an automatic extra night.
func Nights(in, out time.Time, loc *time.Location) int {
	return StayNights(in, out, StayRules{}, loc)
}

// StayRules are the billing rules a stay was checked in under. The zero value
// is the original rule: fixed checkout, counted from the check-in date.
type StayRules struct {
	Policy      string        // "fixed" (leave by the checkout time) or "24h" (24 hours from check-in)
	ArrivalDate string        // YYYY-MM-DD, the first night under "fixed"; "" means the check-in date
	Grace       time.Duration // "24h": time allowed past each 24 hours before another night is due
}

// StayNights counts the nights to bill, minimum one.
//   - fixed: hotel dates from the arrival night to the departure date. Leaving
//     after the checkout time is a late checkout, charged explicitly, not a night.
//   - 24h: one night per started 24 hours from check-in, after the grace period.
func StayNights(in, out time.Time, r StayRules, loc *time.Location) int {
	if r.Policy == "24h" {
		over := out.Sub(in) - r.Grace
		n := int((over + 24*time.Hour - 1) / (24 * time.Hour))
		return max(1, n)
	}
	start := dateOnly(in.In(loc))
	if d, err := time.Parse(dateLayout, r.ArrivalDate); err == nil {
		start = d
	}
	n := int(dateOnly(out.In(loc)).Sub(start).Hours() / 24)
	return max(1, n)
}

func dateOnly(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// ArrivalNight is the hotel night a check-in at t belongs to. Before the
// cutoff (say 06:00), a walk-in is taking the room for the night that has
// already begun, so it's the previous date. A cutoff of "00:00" turns this off.
func ArrivalNight(t time.Time, cutoff string, loc *time.Location) string {
	local := t.In(loc)
	if local.Format("15:04") < cutoff {
		local = local.AddDate(0, 0, -1)
	}
	return local.Format(dateLayout)
}

// LateCheckout reports how far past the checkout time (plus grace) a fixed-
// policy guest is leaving at now, or 0. It applies only on a day after the
// arrival night; a guest who checked in today hasn't overstayed anything.
func LateCheckout(now time.Time, r StayRules, checkIn time.Time, checkoutTime string, grace time.Duration, loc *time.Location) time.Duration {
	if r.Policy == "24h" {
		return 0 // already billed by the clock
	}
	local := now.In(loc)
	arrival := r.ArrivalDate
	if arrival == "" {
		arrival = checkIn.In(loc).Format(dateLayout)
	}
	if local.Format(dateLayout) <= arrival {
		return 0
	}
	due, err := time.ParseInLocation(dateLayout+" 15:04", local.Format(dateLayout)+" "+checkoutTime, loc)
	if err != nil {
		return 0
	}
	if late := now.Sub(due); late > grace {
		return late
	}
	return 0
}

var nonDigits = regexp.MustCompile(`\D`)

// NormalizePhone turns Indian numbers into +91XXXXXXXXXX. International numbers
// must be entered with their + country code. Returns "" if it can't be a phone number.
func NormalizePhone(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	plus := strings.HasPrefix(raw, "+")
	d := nonDigits.ReplaceAllString(raw, "")
	switch {
	case plus && len(d) >= 8 && len(d) <= 15:
		return "+" + d
	case len(d) == 10 && d[0] >= '6':
		return "+91" + d
	case len(d) == 11 && d[0] == '0' && d[1] >= '6':
		return "+91" + d[1:]
	case len(d) == 12 && strings.HasPrefix(d, "91") && d[2] >= '6':
		return "+" + d
	}
	return ""
}

var aadhaarRe = regexp.MustCompile(`^[2-9][0-9]{11}$`)

// ValidAadhaar checks format and the Verhoeff checksum used by Aadhaar numbers.
func ValidAadhaar(n string) bool {
	if !aadhaarRe.MatchString(n) {
		return false
	}
	var d = [10][10]int{
		{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}, {1, 2, 3, 4, 0, 6, 7, 8, 9, 5}, {2, 3, 4, 0, 1, 7, 8, 9, 5, 6},
		{3, 4, 0, 1, 2, 8, 9, 5, 6, 7}, {4, 0, 1, 2, 3, 9, 5, 6, 7, 8}, {5, 9, 8, 7, 6, 0, 4, 3, 2, 1},
		{6, 5, 9, 8, 7, 1, 0, 4, 3, 2}, {7, 6, 5, 9, 8, 2, 1, 0, 4, 3}, {8, 7, 6, 5, 9, 3, 2, 1, 0, 4},
		{9, 8, 7, 6, 5, 4, 3, 2, 1, 0},
	}
	var p = [8][10]int{
		{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}, {1, 5, 7, 6, 2, 8, 3, 0, 9, 4}, {5, 8, 0, 3, 7, 9, 6, 1, 4, 2},
		{8, 9, 1, 6, 0, 4, 3, 5, 2, 7}, {9, 4, 5, 3, 1, 2, 6, 8, 7, 0}, {4, 2, 8, 6, 5, 7, 3, 9, 0, 1},
		{2, 7, 9, 3, 8, 0, 6, 4, 1, 5}, {7, 0, 4, 6, 9, 1, 3, 2, 5, 8},
	}
	c := 0
	for i := 0; i < len(n); i++ {
		digit := int(n[len(n)-1-i] - '0')
		c = d[c][p[i%8][digit]]
	}
	return c == 0
}
