package stay

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/guestly/backend/internal/auth"
	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/property"
)

// MessageKind is a guest message sent over WhatsApp (click-to-send for now).
type MessageKind struct {
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	When        string `json:"when"`
	DefaultBody string `json:"defaultBody"`
	Available   bool   `json:"available"` // false until the feature it depends on ships
}

var messageKinds = []MessageKind{
	{
		Kind: "booking", Title: "Booking confirmation", When: "After a reservation is made", Available: true,
		DefaultBody: "Hi {guest_name}, your booking at {hotel_name} is confirmed! 🙏\n\n" +
			"Check-in: {checkin_date}, from {checkin_time}\n" +
			"Checkout: {checkout_date}, by {checkout_time}\n" +
			"Room: {room}\n" +
			"Advance received: {advance}\n\n" +
			"Find us: {map_link}\n" +
			"Questions? Call or WhatsApp us at {hotel_phone}.",
	},
	{
		Kind: "welcome", Title: "Welcome at check-in", When: "Right after check-in", Available: true,
		DefaultBody: "Hi {guest_name}, welcome to {hotel_name}! 🙏\n\n" +
			"Your room: {room}\n" +
			"Checkout: {checkout_date}, {checkout_time}\n" +
			"Wi-Fi: {wifi_name}\n" +
			"Password: {wifi_password}\n\n" +
			"Need anything? Call or WhatsApp us at {hotel_phone}.\n" +
			"Have a lovely stay!",
	},
	{
		Kind: "bill", Title: "Bill at checkout", When: "At checkout", Available: true,
		DefaultBody: "Hi {guest_name}, thank you for staying at {hotel_name}! 🙏\n\n" +
			"Your bill: {amount}\nView or download: {invoice_link}\n\nWe hope to see you again.",
	},
	{
		Kind: "review", Title: "Review request", When: "After checkout (with reviews)",
		DefaultBody: "Hi {guest_name}, how was your stay at {hotel_name}?\n\n" +
			"We'd love your feedback. It takes 30 seconds: {review_link}\n\nThank you!",
	},
}

func kindByName(k string) (MessageKind, bool) {
	for _, m := range messageKinds {
		if m.Kind == k {
			return m, true
		}
	}
	return MessageKind{}, false
}

// Variables available in templates, with a sample value for the settings preview.
var templateVars = []struct{ Name, Sample string }{
	{"guest_name", "Priya"}, {"hotel_name", "Lakeview Homestay"}, {"room", "203"},
	{"checkin_date", "4 Nov"}, {"checkin_time", "12:00 PM"}, {"checkout_date", "6 Nov"}, {"checkout_time", "11:00 AM"},
	{"advance", "₹1,000"},
	{"wifi_name", "Lakeview-Guest"}, {"wifi_password", "welcome123"}, {"hotel_phone", "+91 98470 12345"},
	{"map_link", "https://maps.google.com/?q=Lakeview+Homestay"}, {"amount", "₹7,350"},
	{"invoice_link", "https://…/i/abc123"}, {"review_link", "https://…/r/abc123"},
}

var varRe = regexp.MustCompile(`\{([a-z_]+)\}`)

// Render fills a template. A line whose variables all resolve to empty values
// is dropped (e.g. no Wi-Fi configured → no Wi-Fi line), so messages never show
// blanks like "Wi-Fi: ".
func Render(body string, vars map[string]string) string {
	var out []string
	for _, line := range strings.Split(body, "\n") {
		names := varRe.FindAllStringSubmatch(line, -1)
		if len(names) > 0 {
			empty := true
			for _, m := range names {
				if v, known := vars[m[1]]; !known || v != "" {
					empty = false
				}
			}
			if empty {
				continue
			}
		}
		out = append(out, varRe.ReplaceAllStringFunc(line, func(m string) string {
			name := m[1 : len(m)-1]
			if v, ok := vars[name]; ok {
				return v
			}
			return m
		}))
	}
	// Collapse blank lines left behind by dropped lines.
	text := strings.Join(out, "\n")
	for strings.Contains(text, "\n\n\n") {
		text = strings.ReplaceAll(text, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(text)
}

type Template struct {
	MessageKind
	Enabled bool   `json:"enabled"`
	Body    string `json:"body"`
	Custom  bool   `json:"custom"`
}

func (h *Handler) template(ctx context.Context, kind string) (Template, error) {
	ts, err := h.templates(ctx)
	if err != nil {
		return Template{}, err
	}
	for _, t := range ts {
		if t.Kind == kind {
			return t, nil
		}
	}
	return Template{}, httpx.NotFound("Unknown message.")
}

func (h *Handler) templates(ctx context.Context) ([]Template, error) {
	rows, err := h.DB.Query(ctx, `SELECT kind, enabled, body FROM message_templates WHERE property_id = $1`, property.ID(ctx))
	if err != nil {
		return nil, err
	}
	custom := map[string]Template{}
	for rows.Next() {
		var t Template
		if err := rows.Scan(&t.Kind, &t.Enabled, &t.Body); err != nil {
			rows.Close()
			return nil, err
		}
		custom[t.Kind] = t
	}
	rows.Close()
	out := make([]Template, 0, len(messageKinds))
	for _, k := range messageKinds {
		t := Template{MessageKind: k, Enabled: true, Body: k.DefaultBody}
		if c, ok := custom[k.Kind]; ok {
			t.Enabled, t.Body, t.Custom = c.Enabled, c.Body, true
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

type templatesResp struct {
	Templates []Template          `json:"templates"`
	Variables []map[string]string `json:"variables"`
}

func (h *Handler) ListTemplates(w http.ResponseWriter, r *http.Request) error {
	ts, err := h.templates(r.Context())
	if err != nil {
		return err
	}
	vars := make([]map[string]string, 0, len(templateVars))
	for _, v := range templateVars {
		vars = append(vars, map[string]string{"name": v.Name, "sample": v.Sample})
	}
	httpx.JSON(w, http.StatusOK, templatesResp{Templates: ts, Variables: vars})
	return nil
}

func (h *Handler) SaveTemplate(w http.ResponseWriter, r *http.Request) error {
	k, ok := kindByName(chi.URLParam(r, "kind"))
	if !ok {
		return httpx.NotFound("Unknown message.")
	}
	var in struct {
		Enabled bool   `json:"enabled"`
		Body    string `json:"body"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	in.Body = strings.TrimSpace(strings.ReplaceAll(in.Body, "\r\n", "\n"))
	if in.Body == "" {
		return httpx.Invalid(map[string]string{"body": "Write the message, or reset it to the default."})
	}
	if len(in.Body) > 1500 {
		return httpx.Invalid(map[string]string{"body": "Keep the message under 1,500 characters."})
	}
	known := map[string]bool{}
	for _, v := range templateVars {
		known[v.Name] = true
	}
	for _, m := range varRe.FindAllStringSubmatch(in.Body, -1) {
		if !known[m[1]] {
			return httpx.Invalid(map[string]string{"body": "Unknown field {" + m[1] + "}. Use one of the fields listed below the editor."})
		}
	}
	_, err := h.DB.Exec(r.Context(), `
		INSERT INTO message_templates (property_id, kind, enabled, body) VALUES ($1,$2,$3,$4)
		ON CONFLICT (property_id, kind) DO UPDATE SET enabled = EXCLUDED.enabled, body = EXCLUDED.body, updated_at = now()`,
		property.ID(r.Context()), k.Kind, in.Enabled, in.Body)
	if err != nil {
		return err
	}
	return h.ListTemplates(w, r)
}

func (h *Handler) ResetTemplate(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.DB.Exec(r.Context(), `DELETE FROM message_templates WHERE property_id = $1 AND kind = $2`,
		property.ID(r.Context()), chi.URLParam(r, "kind")); err != nil {
		return err
	}
	return h.ListTemplates(w, r)
}

type preview struct {
	Kind     string   `json:"kind"`
	Phone    string   `json:"phone"`
	Body     string   `json:"body"`
	OpenIn   string   `json:"openIn"`
	Enabled  bool     `json:"enabled"`
	Consent  bool     `json:"consent"`
	Warnings []string `json:"warnings"`
}

func formatClock(hhmm string) string {
	t, err := time.Parse("15:04", hhmm)
	if err != nil {
		return hhmm
	}
	return t.Format("3:04 PM")
}

// PreviewMessage renders a message for a stay so staff can review it before WhatsApp opens.
func (h *Handler) PreviewMessage(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	k, ok := kindByName(chi.URLParam(r, "kind"))
	if !ok || !k.Available || k.Kind == "booking" {
		return httpx.NotFound("This message isn't available yet.")
	}
	d, err := h.loadStay(ctx, chi.URLParam(r, "stayID"))
	if err != nil {
		return err
	}
	prop, err := h.loadProperty(ctx)
	if err != nil {
		return err
	}
	ts, err := h.templates(ctx)
	if err != nil {
		return err
	}
	var t Template
	for _, x := range ts {
		if x.Kind == k.Kind {
			t = x
		}
	}
	first := strings.Fields(d.Guest.Name)
	guestName := d.Guest.Name
	if len(first) > 0 {
		guestName = first[0]
	}
	hotelPhone := prop.FrontDesk.WhatsAppNumber
	if hotelPhone == "" {
		hotelPhone = prop.Phone
	}
	addr := strings.Join(nonEmpty(prop.Name, prop.Address, prop.City), ", ")
	vars := map[string]string{
		"guest_name":    guestName,
		"hotel_name":    prop.Name,
		"room":          d.RoomNumber,
		"checkin_date":  d.CheckInAt.In(property.IST).Format("2 Jan"),
		"checkout_date": d.ExpectedCheckOutAt.In(property.IST).Format("Mon, 2 Jan"),
		"checkout_time": formatClock(prop.CheckOutTime),
		"wifi_name":     prop.FrontDesk.WifiName,
		"wifi_password": prop.FrontDesk.WifiPassword,
		"hotel_phone":   hotelPhone,
		"map_link":      "https://maps.google.com/?q=" + url.QueryEscape(addr),
		"amount":        rupeeText(d.Bill.Total),
		"checkin_time":  formatClock(prop.CheckInTime),
		"advance":       "",
		"invoice_link":  h.invoiceLink(ctx, d.ID),
	}
	p := preview{Kind: k.Kind, Phone: d.Guest.Phone, Body: Render(t.Body, vars), OpenIn: prop.FrontDesk.WhatsAppOpenIn,
		Enabled: t.Enabled, Consent: d.Guest.WhatsAppConsent, Warnings: []string{}}
	if p.Phone == "" {
		p.Warnings = append(p.Warnings, "This guest has no mobile number.")
	}
	if !p.Consent {
		p.Warnings = append(p.Warnings, "The guest didn't agree to WhatsApp messages at check-in.")
	}
	if k.Kind == "bill" && vars["invoice_link"] == "" {
		p.Warnings = append(p.Warnings, "The invoice isn't created yet, so the link is left out.")
	}
	if k.Kind == "welcome" && prop.FrontDesk.WifiName == "" {
		p.Warnings = append(p.Warnings, "Wi-Fi details aren't set up, so they're left out. Add them in Settings.")
	}
	httpx.JSON(w, http.StatusOK, p)
	return nil
}

// invoiceLink returns the guest's public invoice link, or "" if no invoice exists yet.
func (h *Handler) invoiceLink(ctx context.Context, stayID string) string {
	var token string
	if err := h.DB.QueryRow(ctx, `SELECT share_token FROM invoices WHERE stay_id::text = $1 AND property_id = $2`, stayID, property.ID(ctx)).Scan(&token); err != nil {
		return ""
	}
	return strings.TrimRight(h.AppURL, "/") + "/i/" + token
}

func nonEmpty(xs ...string) []string {
	var out []string
	for _, x := range xs {
		if strings.TrimSpace(x) != "" {
			out = append(out, strings.TrimSpace(x))
		}
	}
	return out
}

// LogMessage records that staff sent (or chose not to send) a WhatsApp message.
func (h *Handler) LogMessage(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Kind   string `json:"kind"`
		Phone  string `json:"phone"`
		Body   string `json:"body"`
		Status string `json:"status"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if _, ok := kindByName(in.Kind); !ok {
		return httpx.BadRequest("Unknown message.")
	}
	if in.Status != "sent" && in.Status != "skipped" {
		return httpx.BadRequest("status must be sent or skipped")
	}
	phone := NormalizePhone(in.Phone)
	if phone == "" {
		return httpx.Invalid(map[string]string{"phone": "Enter a valid mobile number."})
	}
	ctx := r.Context()
	var guestID string
	err := h.DB.QueryRow(ctx, `SELECT guest_id FROM stays WHERE id::text = $1 AND property_id = $2`, chi.URLParam(r, "stayID"), property.ID(ctx)).Scan(&guestID)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Stay not found.")
	}
	if err != nil {
		return err
	}
	if _, err := h.DB.Exec(ctx, `INSERT INTO message_log (property_id, stay_id, guest_id, kind, phone, body, status, user_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, property.ID(ctx), chi.URLParam(r, "stayID"), guestID, in.Kind, phone, in.Body, in.Status,
		auth.FromContext(ctx).UserID); err != nil {
		return err
	}
	return h.respondStay(w, r, chi.URLParam(r, "stayID"), http.StatusCreated)
}
