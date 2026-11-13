package stay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/guestly/backend/internal/auth"
	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/property"
)

// ---- Invoice document ----
//
// The invoice is a frozen copy (InvoiceDoc) of what was printed, stored as JSON in
// invoices.doc. Settlement (payments) is not frozen: it is read live when the invoice is shown.

type InvoiceSeller struct {
	LegalName    string   `json:"legalName"` // name registered under GST
	TradeName    string   `json:"tradeName"` // the hotel's brand name
	AddressLines []string `json:"addressLines"`
	GSTIN        string   `json:"gstin"`
	State        string   `json:"state"`
	StateCode    string   `json:"stateCode"` // first two digits of the GSTIN
	Phone        string   `json:"phone"`
	Email        string   `json:"email"`
}

type InvoiceBillTo struct {
	Name      string `json:"name"`
	Address   string `json:"address"`
	GSTIN     string `json:"gstin"`
	State     string `json:"state"`
	StateCode string `json:"stateCode"`
	Phone     string `json:"phone"`
}

type InvoiceStay struct {
	RoomNumber  string    `json:"roomNumber"`
	RoomType    string    `json:"roomType"`
	Adults      int       `json:"adults"`
	Children    int       `json:"children"`
	NightlyRate int64     `json:"nightlyRate"`
	FoodPlan    string    `json:"foodPlan"` // EP, CP, MAP or AP
	CheckInAt   time.Time `json:"checkInAt"`
	CheckOutAt  time.Time `json:"checkOutAt"`
	Nights      int       `json:"nights"`
}

type InvoiceLine struct {
	Date        string `json:"date"` // YYYY-MM-DD, hotel time
	Description string `json:"description"`
	SAC         string `json:"sac"`
	Quantity    int    `json:"quantity"`
	UnitPrice   int64  `json:"unitPrice"`
	Taxable     int64  `json:"taxable"`
	GSTRateBP   int    `json:"gstRateBp"`
	CGST        int64  `json:"cgst"`
	SGST        int64  `json:"sgst"`
	Total       int64  `json:"total"`
}

type TaxRow struct {
	RateBP  int   `json:"rateBp"`
	Taxable int64 `json:"taxable"`
	CGST    int64 `json:"cgst"`
	SGST    int64 `json:"sgst"`
}

type InvoiceDoc struct {
	Title        string        `json:"title"` // TAX INVOICE, or BILL OF SUPPLY when the hotel isn't GST registered
	Seller       InvoiceSeller `json:"seller"`
	BillTo       InvoiceBillTo `json:"billTo"`
	GuestName    string        `json:"guestName"`
	Stay         InvoiceStay   `json:"stay"`
	Lines        []InvoiceLine `json:"lines"`
	TaxSummary   []TaxRow      `json:"taxSummary"`
	Taxable      int64         `json:"taxable"`
	CGST         int64         `json:"cgst"`
	SGST         int64         `json:"sgst"`
	Total        int64         `json:"total"`
	TotalInWords string        `json:"totalInWords"`
	Footer       string        `json:"footer"`
}

// sacFor picks the service code (SAC) for an extra charge from its description.
// Rooms are always 996311. Unknown services use the 4-digit heading 9963.
func sacFor(desc string) string {
	d := strings.ToLower(desc)
	has := func(words ...string) bool {
		for _, w := range words {
			if strings.Contains(d, w) {
				return true
			}
		}
		return false
	}
	switch {
	case has("breakfast", "lunch", "dinner", "meal", "food", "restaurant", "tea", "coffee", "snack"):
		return "996331"
	case has("extra bed", "check-in", "checkin", "checkout", "check-out", "late", "early", "room"):
		return "996311"
	case has("laundry", "dry clean", "iron", "washing"):
		return "9997"
	case has("pickup", "pick-up", "drop", "taxi", "cab", "transfer"):
		return "9964"
	}
	return "9963"
}

// stateCode returns the 2-digit GST state code from a GSTIN, or "".
func stateCode(gstin string) string {
	if len(gstin) >= 2 && gstin[0] >= '0' && gstin[0] <= '9' && gstin[1] >= '0' && gstin[1] <= '9' {
		return gstin[:2]
	}
	return ""
}

// financialYear returns the Indian financial year (April to March) of t, like "26-27".
func financialYear(t time.Time) string {
	t = t.In(property.IST)
	y := t.Year()
	if t.Month() < time.April {
		y--
	}
	return fmt.Sprintf("%02d-%02d", y%100, (y+1)%100)
}

// invoiceNumber builds PREFIX/FY/0001. GST allows at most 16 characters, which holds
// for prefixes up to 4 characters and 9,999 invoices a year.
func invoiceNumber(prefix, fy string, seq int) string {
	return fmt.Sprintf("%s/%s/%04d", prefix, fy, seq)
}

var smallNumbers = []string{"", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN",
	"TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"}
var tensNames = []string{"", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"}

func wordsUnder1000(n int64) string {
	var parts []string
	if h := n / 100; h > 0 {
		parts = append(parts, smallNumbers[h]+" HUNDRED")
	}
	rem := n % 100
	switch {
	case rem == 0:
	case rem < 20:
		parts = append(parts, smallNumbers[rem])
	default:
		w := tensNames[rem/10]
		if rem%10 > 0 {
			w += "-" + smallNumbers[rem%10]
		}
		parts = append(parts, w)
	}
	return strings.Join(parts, " ")
}

// numberWords spells out a whole number in the Indian system (crore, lakh, thousand).
func numberWords(n int64) string {
	if n == 0 {
		return "ZERO"
	}
	var parts []string
	if c := n / 10000000; c > 0 {
		parts = append(parts, numberWords(c)+" CRORE")
	}
	if l := (n / 100000) % 100; l > 0 {
		parts = append(parts, wordsUnder1000(l)+" LAKH")
	}
	if t := (n / 1000) % 100; t > 0 {
		parts = append(parts, wordsUnder1000(t)+" THOUSAND")
	}
	if r := n % 1000; r > 0 {
		parts = append(parts, wordsUnder1000(r))
	}
	return strings.Join(parts, " ")
}

// rupeesInWords writes an amount in paise the way it is printed on a bill:
// "RUPEES TWO THOUSAND SIX HUNDRED NINETY-FIVE ONLY".
func rupeesInWords(paise int64) string {
	s := "RUPEES " + numberWords(paise/100)
	if p := paise % 100; p > 0 {
		s += " AND " + numberWords(p) + " PAISE"
	}
	return s + " ONLY"
}

// buildInvoiceDoc freezes a checked-out stay's bill into the document printed on the invoice.
func buildInvoiceDoc(d StayDetail, prop property.Property) InvoiceDoc {
	legal := prop.FrontDesk.LegalName
	if legal == "" {
		legal = prop.Name
	}
	var addr []string
	if prop.Address != "" {
		addr = append(addr, prop.Address)
	}
	if l := strings.Join(nonEmpty(prop.City, prop.State), ", "); l != "" || prop.Pincode != "" {
		addr = append(addr, strings.TrimSpace(l+" "+prop.Pincode))
	}
	registered := prop.FrontDesk.GSTRegistered
	seller := InvoiceSeller{LegalName: legal, TradeName: prop.Name, AddressLines: addr, State: prop.State,
		Phone: prop.Phone, Email: prop.Email}
	title := "BILL OF SUPPLY"
	if registered {
		title = "TAX INVOICE"
		seller.GSTIN = prop.GSTIN
		seller.StateCode = stateCode(prop.GSTIN)
	}

	billTo := InvoiceBillTo{Name: d.Guest.Name, Address: d.Guest.Address, Phone: d.Guest.Phone}
	if d.BillTo.Name != "" {
		billTo = InvoiceBillTo{Name: d.BillTo.Name, Address: d.BillTo.Address, GSTIN: d.BillTo.GSTIN,
			State: d.BillTo.State, StateCode: stateCode(d.BillTo.GSTIN)}
	}

	out := d.CheckedOutAt
	if out == nil {
		now := time.Now()
		out = &now
	}
	doc := InvoiceDoc{
		Title:     title,
		Seller:    seller,
		BillTo:    billTo,
		GuestName: d.Guest.Name,
		Stay: InvoiceStay{RoomNumber: d.RoomNumber, RoomType: d.RoomType, Adults: d.Adults, Children: d.Children,
			NightlyRate: d.NightlyRate, FoodPlan: d.FoodPlan, CheckInAt: d.CheckInAt, CheckOutAt: *out, Nights: d.Bill.Nights},
		Footer: prop.FrontDesk.InvoiceFooter,
	}

	chargeDate := map[string]time.Time{}
	for _, c := range d.Charges {
		chargeDate[c.ID] = c.ChargedOn
	}
	rates := map[int]*TaxRow{}
	for i, l := range d.Bill.Lines {
		line := InvoiceLine{Description: l.Description, Quantity: l.Quantity, UnitPrice: l.UnitPrice, Taxable: l.Taxable,
			GSTRateBP: l.GSTRateBP, CGST: l.CGST, SGST: l.SGST, Total: l.Total}
		if i == 0 {
			line.Date = d.CheckInAt.In(property.IST).Format("2006-01-02")
			line.SAC = "996311"
		} else {
			line.Date = chargeDate[l.ChargeID].Format("2006-01-02")
			line.SAC = sacFor(l.Description)
		}
		doc.Lines = append(doc.Lines, line)
		if l.GSTRateBP > 0 {
			row := rates[l.GSTRateBP]
			if row == nil {
				row = &TaxRow{RateBP: l.GSTRateBP}
				rates[l.GSTRateBP] = row
			}
			row.Taxable += l.Taxable
			row.CGST += l.CGST
			row.SGST += l.SGST
		}
	}
	for _, r := range rates {
		doc.TaxSummary = append(doc.TaxSummary, *r)
	}
	sort.Slice(doc.TaxSummary, func(i, j int) bool { return doc.TaxSummary[i].RateBP < doc.TaxSummary[j].RateBP })
	doc.Taxable, doc.CGST, doc.SGST, doc.Total = d.Bill.Taxable, d.Bill.CGST, d.Bill.SGST, d.Bill.Total
	doc.TotalInWords = rupeesInWords(doc.Total)
	return doc
}

// ---- Issuing ----

func newShareToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// issueInvoice creates the invoice for a checked-out stay, or returns the one that exists.
// Numbers come from a per-property, per-financial-year counter updated in the same
// transaction, so they never skip or repeat.
func (h *Handler) issueInvoice(ctx context.Context, stayID string) error {
	d, err := h.loadStay(ctx, stayID)
	if err != nil {
		return err
	}
	if d.Status != "checked_out" {
		return httpx.Conflict("The invoice is created when the guest checks out.")
	}
	prop, err := h.loadProperty(ctx)
	if err != nil {
		return err
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Lock the stay so two people pressing "Create invoice" at once can't make two.
	if _, err := tx.Exec(ctx, `SELECT 1 FROM stays WHERE id::text = $1 AND property_id = $2 FOR UPDATE`, stayID, property.ID(ctx)); err != nil {
		return err
	}
	var existing string
	err = tx.QueryRow(ctx, `SELECT id::text FROM invoices WHERE stay_id::text = $1`, stayID).Scan(&existing)
	if err == nil {
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	now := time.Now()
	fy := financialYear(now)
	var seq int
	if err := tx.QueryRow(ctx, `
		INSERT INTO invoice_counters (property_id, fy, last_seq) VALUES ($1, $2, 1)
		ON CONFLICT (property_id, fy) DO UPDATE SET last_seq = invoice_counters.last_seq + 1
		RETURNING last_seq`, property.ID(ctx), fy).Scan(&seq); err != nil {
		return err
	}
	doc := buildInvoiceDoc(d, prop)
	var issuedBy any // NULL when there is no signed-in user (the demo seed)
	if u := auth.FromContext(ctx).UserID; u != "" {
		issuedBy = u
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	token, err := newShareToken()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO invoices (property_id, stay_id, fy, seq, number, issued_at, share_token, doc, total, issued_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		property.ID(ctx), stayID, fy, seq, invoiceNumber(prop.InvoicePrefix, fy, seq), now, token, raw, doc.Total,
		issuedBy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// IssueInvoiceFor creates the invoice for a checked-out stay outside a web request (the demo seed).
func (h *Handler) IssueInvoiceFor(ctx context.Context, propertyID, stayID string) error {
	return h.issueInvoice(property.WithID(ctx, propertyID), stayID)
}

// tryIssueInvoice is used at checkout. A failure must not undo the checkout, so it is logged
// and staff can create the invoice from the stay page.
func (h *Handler) tryIssueInvoice(ctx context.Context, stayID string) {
	if err := h.issueInvoice(ctx, stayID); err != nil {
		log.Printf("invoice for stay %s: %v", stayID, err)
	}
}

// ---- Viewing ----

type InvoicePayment struct {
	Mode   string    `json:"mode"`
	Amount int64     `json:"amount"` // negative = refund
	At     time.Time `json:"at"`
}

type InvoiceView struct {
	ID         string           `json:"id"`
	Number     string           `json:"number"`
	IssuedAt   time.Time        `json:"issuedAt"`
	Copy       string           `json:"copy"` // ORIGINAL or DUPLICATE: how the next print is labelled
	PrintCount int              `json:"printCount"`
	Doc        InvoiceDoc       `json:"doc"`
	LogoURL    string           `json:"logoUrl"`
	Payments   []InvoicePayment `json:"payments"`
	Paid       int64            `json:"paid"`
	Balance    int64            `json:"balance"`  // positive = guest still owes
	ShareURL   string           `json:"shareUrl"` // staff only
}

func copyLabel(printCount int) string {
	if printCount == 0 {
		return "ORIGINAL"
	}
	return "DUPLICATE"
}

func (h *Handler) invoiceView(ctx context.Context, where string, args ...any) (InvoiceView, error) {
	var v InvoiceView
	var raw []byte
	var stayID, propertyID, token string
	err := h.DB.QueryRow(ctx, `SELECT id::text, stay_id::text, property_id::text, number, issued_at, doc, print_count, share_token
		FROM invoices WHERE `+where, args...).Scan(&v.ID, &stayID, &propertyID, &v.Number, &v.IssuedAt, &raw, &v.PrintCount, &token)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, httpx.NotFound("There is no invoice for this stay yet.")
	}
	if err != nil {
		return v, err
	}
	if err := json.Unmarshal(raw, &v.Doc); err != nil {
		return v, err
	}
	rows, err := h.DB.Query(ctx, `SELECT mode::text, amount, created_at FROM stay_payments WHERE stay_id::text = $1 ORDER BY created_at`, stayID)
	if err != nil {
		return v, err
	}
	v.Payments, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (InvoicePayment, error) {
		var p InvoicePayment
		err := row.Scan(&p.Mode, &p.Amount, &p.At)
		return p, err
	})
	if err != nil {
		return v, err
	}
	for _, p := range v.Payments {
		v.Paid += p.Amount
	}
	v.Balance = v.Doc.Total - v.Paid
	var logoKey *string
	if err := h.DB.QueryRow(ctx, `SELECT logo_key FROM properties WHERE id::text = $1`, propertyID).Scan(&logoKey); err != nil {
		return v, err
	}
	if logoKey != nil {
		v.LogoURL = h.Signer.URL(*logoKey, 24*time.Hour)
	}
	v.Copy = copyLabel(v.PrintCount)
	v.ShareURL = strings.TrimRight(h.AppURL, "/") + "/i/" + token
	return v, nil
}

// ---- Endpoints ----

func (h *Handler) GetInvoice(w http.ResponseWriter, r *http.Request) error {
	v, err := h.invoiceView(r.Context(), `stay_id::text = $1 AND property_id = $2`, chi.URLParam(r, "stayID"), property.ID(r.Context()))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, v)
	return nil
}

// IssueInvoice creates the invoice for a stay that checked out before invoices existed
// (or whose automatic creation failed). It is safe to call twice.
func (h *Handler) IssueInvoice(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "stayID")
	if err := h.issueInvoice(r.Context(), id); err != nil {
		return err
	}
	return h.GetInvoice(w, r)
}

// PrintInvoice counts a print. The first is the ORIGINAL, later ones are marked DUPLICATE.
func (h *Handler) PrintInvoice(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := chi.URLParam(r, "stayID")
	var count int
	err := h.DB.QueryRow(ctx, `UPDATE invoices SET print_count = print_count + 1 WHERE stay_id::text = $1 AND property_id = $2 RETURNING print_count`,
		id, property.ID(ctx)).Scan(&count)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("There is no invoice for this stay yet.")
	}
	if err != nil {
		return err
	}
	v, err := h.invoiceView(ctx, `stay_id::text = $1 AND property_id = $2`, id, property.ID(ctx))
	if err != nil {
		return err
	}
	v.Copy = copyLabel(count - 1) // the label of the print that just happened
	httpx.JSON(w, http.StatusOK, v)
	return nil
}

// PublicInvoice serves the guest's share link. The 128-bit random token is the only credential,
// so the response carries no staff-only details.
func (h *Handler) PublicInvoice(w http.ResponseWriter, r *http.Request) error {
	v, err := h.invoiceView(r.Context(), `share_token = $1`, chi.URLParam(r, "token"))
	if err != nil {
		return err
	}
	v.Copy, v.ShareURL = "", ""
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
	httpx.JSON(w, http.StatusOK, v)
	return nil
}

// ---- Bill-to details ----

type billingInput struct {
	FoodPlan      string `json:"foodPlan"`
	BillToName    string `json:"billToName"`
	BillToGSTIN   string `json:"billToGstin"`
	BillToAddress string `json:"billToAddress"`
	BillToState   string `json:"billToState"`
}

func (in *billingInput) validate(f map[string]string, prefix string) {
	in.FoodPlan = strings.ToUpper(strings.TrimSpace(in.FoodPlan))
	if in.FoodPlan == "" {
		in.FoodPlan = "EP"
	}
	in.BillToName = strings.TrimSpace(in.BillToName)
	in.BillToGSTIN = strings.ToUpper(strings.TrimSpace(in.BillToGSTIN))
	in.BillToAddress = strings.TrimSpace(in.BillToAddress)
	in.BillToState = strings.TrimSpace(in.BillToState)
	switch in.FoodPlan {
	case "EP", "CP", "MAP", "AP":
	default:
		f[prefix+"foodPlan"] = "Choose EP, CP, MAP or AP."
	}
	if len(in.BillToName) > 120 {
		f[prefix+"billToName"] = "Keep this under 120 characters."
	}
	if in.BillToGSTIN != "" {
		if !property.GSTINRe.MatchString(in.BillToGSTIN) {
			f[prefix+"billToGstin"] = "GSTIN should be 15 characters, like 29ABCDE1234F1Z5."
		}
		if in.BillToName == "" {
			f[prefix+"billToName"] = "Enter the company name that goes with this GSTIN."
		}
	}
	if len(in.BillToAddress) > 250 {
		f[prefix+"billToAddress"] = "Keep this under 250 characters."
	}
	if len(in.BillToState) > 40 {
		f[prefix+"billToState"] = "Keep this under 40 characters."
	}
}

// saveBilling stores bill-to details and the meal plan. It refuses once the invoice exists,
// because an issued invoice must not change.
func saveBilling(ctx context.Context, tx pgx.Tx, stayID string, in billingInput) error {
	var issued bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM invoices WHERE stay_id::text = $1)`, stayID).Scan(&issued); err != nil {
		return err
	}
	if issued {
		return httpx.Conflict("The invoice was already created, so these details can't change.")
	}
	_, err := tx.Exec(ctx, `UPDATE stays SET food_plan=$2, bill_to_name=$3, bill_to_gstin=$4, bill_to_address=$5, bill_to_state=$6
		WHERE id::text = $1 AND property_id = $7`,
		stayID, in.FoodPlan, in.BillToName, in.BillToGSTIN, in.BillToAddress, in.BillToState, property.ID(ctx))
	return err
}

// UpdateBilling sets who the bill is addressed to (a company with a GSTIN, say) and the meal plan.
func (h *Handler) UpdateBilling(w http.ResponseWriter, r *http.Request) error {
	var in billingInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	f := map[string]string{}
	in.validate(f, "")
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	ctx := r.Context()
	id := chi.URLParam(r, "stayID")
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, _, err := lockStay(ctx, tx, id, "in_house", "checked_out"); err != nil {
		return err
	}
	if err := saveBilling(ctx, tx, id, in); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return h.respondStay(w, r, id, http.StatusOK)
}
