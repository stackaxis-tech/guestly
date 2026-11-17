package stay

import (
	"context"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/property"
)

type ReportInvoice struct {
	ID       string    `json:"id"`
	StayID   string    `json:"stayId"`
	Number   string    `json:"number"`
	IssuedAt time.Time `json:"issuedAt"`
	Guest    string    `json:"guest"`
	BillTo   string    `json:"billTo"` // the company, when the invoice isn't addressed to the guest
	Room     string    `json:"room"`
	Total    int64     `json:"total"`
	Paid     int64     `json:"paid"`
}

type ReportGST struct {
	Month    string `json:"month"` // YYYY-MM
	RateBP   int    `json:"rateBp"`
	Taxable  int64  `json:"taxable"`
	CGST     int64  `json:"cgst"`
	SGST     int64  `json:"sgst"`
	Invoices int    `json:"invoices"`
}

type ReportPayment struct {
	Mode   string `json:"mode"`
	Amount int64  `json:"amount"` // refunds count as negative
}

// Report is everything on the Reports screen for one date range (hotel time, both ends included).
type Report struct {
	From         string          `json:"from"`
	To           string          `json:"to"`
	Days         int             `json:"days"`
	Rooms        int             `json:"rooms"`
	RoomNights   int64           `json:"roomNights"`
	OccupancyPct float64         `json:"occupancyPct"`
	AvgRate      int64           `json:"avgRate"` // paise per room-night, before GST
	InvoiceCount int             `json:"invoiceCount"`
	Taxable      int64           `json:"taxable"`
	CGST         int64           `json:"cgst"`
	SGST         int64           `json:"sgst"`
	Invoiced     int64           `json:"invoiced"`  // total of invoices issued in the range
	Collected    int64           `json:"collected"` // payments received in the range, net of refunds
	Payments     []ReportPayment `json:"payments"`
	GST          []ReportGST     `json:"gst"`
	Invoices     []ReportInvoice `json:"invoices"`
	Dues         []ReportInvoice `json:"dues"` // all-time: invoices with money still owed
}

const reportInvoiceSQL = `
	SELECT i.id::text AS id, i.stay_id::text AS stay_id, i.number AS number, i.issued_at AS issued_at,
		coalesce(i.doc->>'guestName', '') AS guest, coalesce(i.doc->'billTo'->>'name', '') AS bill_to,
		coalesce(i.doc->'stay'->>'roomNumber', '') AS room, i.total AS total,
		coalesce((SELECT sum(p.amount) FROM stay_payments p WHERE p.stay_id = i.stay_id), 0)::bigint AS paid
	FROM invoices i WHERE i.property_id = $1 `

func (h *Handler) reportInvoices(ctx context.Context, sql string, args ...any) ([]ReportInvoice, error) {
	rows, err := h.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ReportInvoice, error) {
		var v ReportInvoice
		err := row.Scan(&v.ID, &v.StayID, &v.Number, &v.IssuedAt, &v.Guest, &v.BillTo, &v.Room, &v.Total, &v.Paid)
		return v, err
	})
	if out == nil {
		out = []ReportInvoice{}
	}
	return out, err
}

func parseDay(s string, fallback time.Time) (time.Time, bool) {
	if s == "" {
		return fallback, true
	}
	t, err := time.ParseInLocation("2006-01-02", s, property.IST)
	return t, err == nil
}

// Report builds the numbers for the Reports screen. Query: from and to as YYYY-MM-DD,
// defaulting to this month so far.
func (h *Handler) Report(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	pid := property.ID(ctx)
	now := time.Now().In(property.IST)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, property.IST)
	from, ok1 := parseDay(r.URL.Query().Get("from"), time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, property.IST))
	to, ok2 := parseDay(r.URL.Query().Get("to"), today)
	if !ok1 || !ok2 {
		return httpx.BadRequest("Dates should look like 2026-11-30.")
	}
	if to.Before(from) {
		return httpx.BadRequest("The end date is before the start date.")
	}
	end := to.AddDate(0, 0, 1) // exclusive
	days := int(end.Sub(from).Hours()/24 + 0.5)
	if days > 366 {
		return httpx.BadRequest("Pick a range of one year or less.")
	}
	rep := Report{From: from.Format("2006-01-02"), To: to.Format("2006-01-02"), Days: days}

	if err := h.DB.QueryRow(ctx, `SELECT count(*) FROM rooms WHERE property_id = $1`, pid).Scan(&rep.Rooms); err != nil {
		return err
	}

	// Room-nights sold: the nights each stay spent inside the range, in hotel dates,
	// from its arrival night (a 2 AM walk-in took the night before; see ArrivalNight).
	var rateNights int64
	if err := h.DB.QueryRow(ctx, `
		SELECT coalesce(sum(n), 0)::bigint, coalesce(sum(n * rate), 0)::bigint FROM (
			SELECT s.nightly_rate AS rate,
				greatest(0, least((coalesce(s.checked_out_at, s.expected_check_out_at) AT TIME ZONE 'Asia/Kolkata')::date, $3::date)
					- greatest(coalesce(s.arrival_date, (s.check_in_at AT TIME ZONE 'Asia/Kolkata')::date), $2::date)) AS n
			FROM stays s WHERE s.property_id = $1 AND s.status IN ('in_house', 'checked_out')
		) x`, pid, from, end).Scan(&rep.RoomNights, &rateNights); err != nil {
		return err
	}
	if rep.Rooms > 0 && days > 0 {
		rep.OccupancyPct = math.Round(float64(rep.RoomNights)/float64(rep.Rooms*days)*1000) / 10
	}
	if rep.RoomNights > 0 {
		rep.AvgRate = rateNights / rep.RoomNights
	}

	if err := h.DB.QueryRow(ctx, `
		SELECT count(*)::int, coalesce(sum(total), 0)::bigint,
			coalesce(sum((doc->>'taxable')::bigint), 0)::bigint, coalesce(sum((doc->>'cgst')::bigint), 0)::bigint,
			coalesce(sum((doc->>'sgst')::bigint), 0)::bigint
		FROM invoices WHERE property_id = $1 AND issued_at >= $2 AND issued_at < $3`, pid, from, end).
		Scan(&rep.InvoiceCount, &rep.Invoiced, &rep.Taxable, &rep.CGST, &rep.SGST); err != nil {
		return err
	}

	rows, err := h.DB.Query(ctx, `
		SELECT p.mode::text, sum(p.amount)::bigint FROM stay_payments p JOIN stays s ON s.id = p.stay_id
		WHERE s.property_id = $1 AND p.created_at >= $2 AND p.created_at < $3 GROUP BY p.mode ORDER BY 2 DESC`, pid, from, end)
	if err != nil {
		return err
	}
	if rep.Payments, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (ReportPayment, error) {
		var p ReportPayment
		err := row.Scan(&p.Mode, &p.Amount)
		return p, err
	}); err != nil {
		return err
	}
	if rep.Payments == nil {
		rep.Payments = []ReportPayment{}
	}
	for _, p := range rep.Payments {
		rep.Collected += p.Amount
	}

	// GST by month and rate, from the frozen tax summary on each invoice.
	rows, err = h.DB.Query(ctx, `
		SELECT to_char(i.issued_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'), (t->>'rateBp')::int,
			sum((t->>'taxable')::bigint)::bigint, sum((t->>'cgst')::bigint)::bigint, sum((t->>'sgst')::bigint)::bigint,
			count(DISTINCT i.id)::int
		FROM invoices i,
			jsonb_array_elements(CASE WHEN jsonb_typeof(i.doc->'taxSummary') = 'array' THEN i.doc->'taxSummary' ELSE '[]'::jsonb END) t
		WHERE i.property_id = $1 AND i.issued_at >= $2 AND i.issued_at < $3
		GROUP BY 1, 2 ORDER BY 1 DESC, 2`, pid, from, end)
	if err != nil {
		return err
	}
	if rep.GST, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (ReportGST, error) {
		var g ReportGST
		err := row.Scan(&g.Month, &g.RateBP, &g.Taxable, &g.CGST, &g.SGST, &g.Invoices)
		return g, err
	}); err != nil {
		return err
	}
	if rep.GST == nil {
		rep.GST = []ReportGST{}
	}

	if rep.Invoices, err = h.reportInvoices(ctx, reportInvoiceSQL+`AND i.issued_at >= $2 AND i.issued_at < $3 ORDER BY i.issued_at DESC, i.seq DESC LIMIT 500`, pid, from, end); err != nil {
		return err
	}
	if rep.Dues, err = h.reportInvoices(ctx, `SELECT * FROM (`+reportInvoiceSQL+`) x WHERE x.total > x.paid ORDER BY x.issued_at DESC LIMIT 200`, pid); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, rep)
	return nil
}
