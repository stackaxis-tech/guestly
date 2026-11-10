package admin

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/guestly/backend/internal/billing"
	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/property"
	"github.com/guestly/backend/internal/storage"
)

// ---- Client list & dashboard ----

// ClientState is the billing health of a client: the worst state among its properties.
type ClientState string

const (
	ClientActive    ClientState = "active"
	ClientTrial     ClientState = "trial"
	ClientExpiring  ClientState = "expiring" // active, renews within 30 days
	ClientOverdue   ClientState = "overdue"  // a property is in grace or expired
	ClientSuspended ClientState = "suspended"
)

const expiringWindowDays = 30

type ClientRow struct {
	ID            string      `json:"id"`
	Name          string      `json:"name"`
	ContactName   string      `json:"contactName"`
	ContactPhone  string      `json:"contactPhone"`
	ContactEmail  string      `json:"contactEmail"`
	Status        string      `json:"status"` // active | suspended (account)
	State         ClientState `json:"state"`  // billing health
	PropertyCount int         `json:"propertyCount"`
	NextRenewal   *time.Time  `json:"nextRenewal"`
	LastPaymentOn *time.Time  `json:"lastPaymentOn"`
	TotalPaid     int64       `json:"totalPaid"`
	LogoURL       string      `json:"logoUrl"`
	CreatedAt     time.Time   `json:"createdAt"`
}

func clientState(orgStatus string, subs []billing.Subscription, today time.Time) ClientState {
	if orgStatus == "suspended" {
		return ClientSuspended
	}
	state := ClientActive
	rank := map[ClientState]int{ClientActive: 0, ClientTrial: 1, ClientExpiring: 2, ClientOverdue: 3}
	for _, s := range subs {
		st := s.StatusOn(today)
		var c ClientState
		switch {
		case st.State == billing.StateGrace || st.State == billing.StateExpired:
			c = ClientOverdue
		case st.State == billing.StateActive && st.DaysLeft <= expiringWindowDays:
			c = ClientExpiring
		case st.State == billing.StateTrial:
			c = ClientTrial
		default:
			c = ClientActive
		}
		if rank[c] > rank[state] {
			state = c
		}
	}
	return state
}

func (h *Handler) loadClients(ctx context.Context) ([]ClientRow, error) {
	rows, err := h.DB.Query(ctx, `
		SELECT o.id, o.name, o.contact_name, o.contact_phone, o.contact_email, o.status, o.created_at,
			(SELECT max(paid_on) FROM client_payments cp WHERE cp.organization_id = o.id),
			(SELECT coalesce(sum(amount), 0) FROM client_payments cp WHERE cp.organization_id = o.id),
			coalesce(json_agg(json_build_object(
				'endsOn', s.ends_on, 'graceDays', s.grace_days, 'isTrial', s.is_trial, 'logoKey', p.logo_key
			) ORDER BY p.created_at) FILTER (WHERE p.id IS NOT NULL), '[]')
		FROM organizations o
		LEFT JOIN properties p ON p.organization_id = o.id
		LEFT JOIN subscriptions s ON s.property_id = p.id
		GROUP BY o.id
		ORDER BY o.created_at DESC`)
	if err != nil {
		return nil, err
	}
	type propInfo struct {
		EndsOn    *string `json:"endsOn"`
		GraceDays int     `json:"graceDays"`
		IsTrial   bool    `json:"isTrial"`
		LogoKey   *string `json:"logoKey"`
	}
	today := property.Today()
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ClientRow, error) {
		var c ClientRow
		var props []propInfo
		if err := row.Scan(&c.ID, &c.Name, &c.ContactName, &c.ContactPhone, &c.ContactEmail, &c.Status, &c.CreatedAt,
			&c.LastPaymentOn, &c.TotalPaid, &props); err != nil {
			return c, err
		}
		c.PropertyCount = len(props)
		var subs []billing.Subscription
		for _, p := range props {
			if c.LogoURL == "" && p.LogoKey != nil {
				c.LogoURL = h.Signer.URL(*p.LogoKey, 24*time.Hour)
			}
			if p.EndsOn == nil {
				continue
			}
			ends, err := time.Parse("2006-01-02", *p.EndsOn)
			if err != nil {
				return c, err
			}
			subs = append(subs, billing.Subscription{EndsOn: ends, GraceDays: p.GraceDays, IsTrial: p.IsTrial})
			if c.NextRenewal == nil || ends.Before(*c.NextRenewal) {
				c.NextRenewal = &ends
			}
		}
		c.State = clientState(c.Status, subs, today)
		return c, nil
	})
}

func (h *Handler) ListClients(w http.ResponseWriter, r *http.Request) error {
	clients, err := h.loadClients(r.Context())
	if err != nil {
		return err
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	state := ClientState(r.URL.Query().Get("state"))
	out := clients[:0]
	for _, c := range clients {
		if state != "" && c.State != state {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(c.Name+" "+c.ContactName+" "+c.ContactPhone+" "+c.ContactEmail), q) {
			continue
		}
		out = append(out, c)
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

type renewal struct {
	PropertyID   string    `json:"propertyId"`
	PropertyName string    `json:"propertyName"`
	ClientID     string    `json:"clientId"`
	ClientName   string    `json:"clientName"`
	EndsOn       time.Time `json:"endsOn"`
	Amount       int64     `json:"amount"`
	State        string    `json:"state"`
	DaysLeft     int       `json:"daysLeft"`
}

type dashboard struct {
	Counts struct {
		Total     int `json:"total"`
		Active    int `json:"active"`
		Trial     int `json:"trial"`
		Expiring  int `json:"expiring"`
		Overdue   int `json:"overdue"`
		Suspended int `json:"suspended"`
	} `json:"counts"`
	Properties       int       `json:"properties"`
	RevenueThisMonth int64     `json:"revenueThisMonth"`
	RevenueThisFY    int64     `json:"revenueThisFY"`
	FinancialYear    string    `json:"financialYear"`
	Renewals         []renewal `json:"renewals"` // overdue + due in the next 30 days
	RecentPayments   []Payment `json:"recentPayments"`
}

func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	clients, err := h.loadClients(ctx)
	if err != nil {
		return err
	}
	var d dashboard
	for _, c := range clients {
		d.Counts.Total++
		d.Properties += c.PropertyCount
		switch c.State {
		case ClientActive:
			d.Counts.Active++
		case ClientTrial:
			d.Counts.Trial++
		case ClientExpiring:
			d.Counts.Expiring++
		case ClientOverdue:
			d.Counts.Overdue++
		case ClientSuspended:
			d.Counts.Suspended++
		}
	}

	today := property.Today()
	monthStart := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC)
	d.FinancialYear = billing.FinancialYear(today)
	fyStartYear := today.Year()
	if today.Month() < time.April {
		fyStartYear--
	}
	fyStart := time.Date(fyStartYear, time.April, 1, 0, 0, 0, 0, time.UTC)
	if err := h.DB.QueryRow(ctx, `
		SELECT coalesce(sum(amount) FILTER (WHERE paid_on >= $1), 0), coalesce(sum(amount) FILTER (WHERE paid_on >= $2), 0)
		FROM client_payments`, monthStart, fyStart).Scan(&d.RevenueThisMonth, &d.RevenueThisFY); err != nil {
		return err
	}

	rows, err := h.DB.Query(ctx, `
		SELECT p.id, p.name, o.id, o.name, s.ends_on, s.amount, s.grace_days, s.is_trial
		FROM subscriptions s JOIN properties p ON p.id = s.property_id JOIN organizations o ON o.id = p.organization_id
		WHERE o.status = 'active' AND s.ends_on <= $1::date + $2::int
		ORDER BY s.ends_on`, today, expiringWindowDays)
	if err != nil {
		return err
	}
	d.Renewals, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (renewal, error) {
		var x renewal
		var grace int
		var trial bool
		err := row.Scan(&x.PropertyID, &x.PropertyName, &x.ClientID, &x.ClientName, &x.EndsOn, &x.Amount, &grace, &trial)
		st := billing.Subscription{EndsOn: x.EndsOn, GraceDays: grace, IsTrial: trial}.StatusOn(today)
		x.State, x.DaysLeft = string(st.State), st.DaysLeft
		return x, err
	})
	if err != nil {
		return err
	}
	if d.RecentPayments, err = h.queryPayments(ctx, "", 6); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, d)
	return nil
}

// ---- Create client ----

type clientInput struct {
	Name         string `json:"name"`
	ContactName  string `json:"contactName"`
	ContactPhone string `json:"contactPhone"`
	ContactEmail string `json:"contactEmail"`
	BillingGSTIN string `json:"billingGstin"`
	Notes        string `json:"notes"`
}

func (in *clientInput) normalize(f map[string]string, prefix string) {
	in.Name = strings.TrimSpace(in.Name)
	in.ContactName = strings.TrimSpace(in.ContactName)
	in.ContactPhone = strings.TrimSpace(in.ContactPhone)
	in.ContactEmail = strings.ToLower(strings.TrimSpace(in.ContactEmail))
	in.BillingGSTIN = strings.ToUpper(strings.TrimSpace(in.BillingGSTIN))
	if in.Name == "" {
		f[prefix+"name"] = "Enter the client's business name."
	}
	if in.ContactPhone == "" {
		f[prefix+"contactPhone"] = "Enter a contact phone number."
	}
	if in.ContactEmail != "" {
		if _, err := mail.ParseAddress(in.ContactEmail); err != nil {
			f[prefix+"contactEmail"] = "Enter a valid email address."
		}
	}
	if in.BillingGSTIN != "" && !property.GSTINRe.MatchString(in.BillingGSTIN) {
		f[prefix+"billingGstin"] = "GSTIN should be 15 characters, like 29ABCDE1234F1Z5."
	}
}

type ownerInput struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Phone string `json:"phone"`
}

// planInput sets up a new property's subscription: a trial, a first payment, or both.
type planInput struct {
	Plan         string          `json:"plan"` // monthly | annual | custom
	Amount       int64           `json:"amount"`
	PeriodMonths int             `json:"periodMonths"`
	TrialDays    int             `json:"trialDays"`
	GraceDays    *int            `json:"graceDays"`
	FirstPayment *paymentDetails `json:"firstPayment"`
}

func (in *planInput) normalize(f map[string]string, prefix string) {
	switch in.Plan {
	case "monthly":
		in.PeriodMonths = 1
	case "annual":
		in.PeriodMonths = 12
	case "custom":
		if in.PeriodMonths < 1 || in.PeriodMonths > 36 {
			f[prefix+"periodMonths"] = "Choose a period between 1 and 36 months."
		}
	default:
		f[prefix+"plan"] = "Choose a plan."
	}
	if in.Amount < 0 {
		f[prefix+"amount"] = "Amount can't be negative."
	}
	if in.TrialDays < 0 || in.TrialDays > 90 {
		f[prefix+"trialDays"] = "Trial can be 0 to 90 days."
	}
	if in.GraceDays == nil {
		g := 7
		in.GraceDays = &g
	} else if *in.GraceDays < 0 || *in.GraceDays > 60 {
		f[prefix+"graceDays"] = "Grace period can be 0 to 60 days."
	}
	if in.TrialDays == 0 && in.FirstPayment == nil {
		f[prefix+"trialDays"] = "Give a free trial, or record the first payment."
	}
	if in.FirstPayment != nil {
		in.FirstPayment.normalize(f, prefix+"firstPayment.")
	}
}

type createClientReq struct {
	Client   clientInput    `json:"client"`
	Property property.Input `json:"property"`
	Owner    ownerInput     `json:"owner"`
	Plan     planInput      `json:"plan"`
}

type createClientResp struct {
	ClientID   string `json:"clientId"`
	PropertyID string `json:"propertyId"`
	InviteURL  string `json:"inviteUrl"`
}

func (h *Handler) CreateClient(w http.ResponseWriter, r *http.Request) error {
	var req createClientReq
	if err := httpx.Decode(r, &req); err != nil {
		return err
	}
	f := map[string]string{}
	req.Client.normalize(f, "client.")
	for k, v := range req.Property.Normalize() {
		f["property."+k] = v
	}
	req.Owner.Name = strings.TrimSpace(req.Owner.Name)
	req.Owner.Email = strings.ToLower(strings.TrimSpace(req.Owner.Email))
	req.Owner.Phone = strings.TrimSpace(req.Owner.Phone)
	if req.Owner.Name == "" {
		f["owner.name"] = "Enter the owner's name."
	}
	if _, err := mail.ParseAddress(req.Owner.Email); err != nil {
		f["owner.email"] = "Enter a valid email. The owner signs in with it."
	}
	req.Plan.normalize(f, "plan.")
	if len(f) > 0 {
		return httpx.Invalid(f)
	}

	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var resp createClientResp
	c := req.Client
	if err := tx.QueryRow(ctx, `
		INSERT INTO organizations (name, contact_name, contact_phone, contact_email, billing_gstin, notes)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		c.Name, c.ContactName, c.ContactPhone, c.ContactEmail, c.BillingGSTIN, c.Notes).Scan(&resp.ClientID); err != nil {
		return err
	}
	if resp.PropertyID, err = property.Insert(ctx, tx, resp.ClientID, req.Property); err != nil {
		return err
	}
	if _, err := h.createSubscription(ctx, tx, resp.ClientID, resp.PropertyID, req.Plan); err != nil {
		return err
	}

	var ownerID string
	err = tx.QueryRow(ctx, `INSERT INTO users (organization_id, name, email, phone, role) VALUES ($1,$2,$3,$4,'owner') RETURNING id`,
		resp.ClientID, req.Owner.Name, req.Owner.Email, req.Owner.Phone).Scan(&ownerID)
	if isUnique(err) {
		return httpx.Invalid(map[string]string{"owner.email": "This email already has a Guestlog account."})
	}
	if err != nil {
		return err
	}
	token, err := authCreateInvite(ctx, tx, ownerID)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	resp.InviteURL = h.inviteURL(token)
	h.audit(ctx, "client.created", "client", resp.ClientID, map[string]any{
		"name": c.Name, "property": req.Property.Name, "owner": req.Owner.Email, "plan": req.Plan.Plan, "amount": req.Plan.Amount,
	})
	httpx.JSON(w, http.StatusCreated, resp)
	return nil
}

// createSubscription sets up a property's first subscription and, if given, records the first payment.
func (h *Handler) createSubscription(ctx context.Context, tx pgx.Tx, orgID, propertyID string, in planInput) (*Payment, error) {
	today := property.Today()
	start := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	// With a trial, the trial covers [today, today+trial-1]. Without one, the
	// subscription "ends" the day before the first payment so the payment starts it.
	end := start.AddDate(0, 0, in.TrialDays-1)
	if in.TrialDays == 0 {
		end = in.FirstPayment.paidOn.AddDate(0, 0, -1)
		start = in.FirstPayment.paidOn
	}
	if end.Before(start) {
		end = start
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO subscriptions (property_id, plan, amount, period_months, is_trial, starts_on, ends_on, grace_days)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		propertyID, in.Plan, in.Amount, in.PeriodMonths, in.TrialDays > 0, start, end, *in.GraceDays)
	if err != nil {
		return nil, err
	}
	if in.FirstPayment == nil {
		return nil, nil
	}
	return h.recordPayment(ctx, tx, orgID, propertyID, *in.FirstPayment)
}

func (h *Handler) inviteURL(token string) string {
	return strings.TrimRight(h.AppURL, "/") + "/invite/" + token
}

// ---- Client detail ----

type clientUser struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Phone     *string   `json:"phone"`
	Role      string    `json:"role"`
	Activated bool      `json:"activated"`
	CreatedAt time.Time `json:"createdAt"`
}

type clientDetail struct {
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	ContactName  string              `json:"contactName"`
	ContactPhone string              `json:"contactPhone"`
	ContactEmail string              `json:"contactEmail"`
	BillingGSTIN string              `json:"billingGstin"`
	Notes        string              `json:"notes"`
	Status       string              `json:"status"`
	State        ClientState         `json:"state"`
	CreatedAt    time.Time           `json:"createdAt"`
	Properties   []property.Property `json:"properties"`
	Users        []clientUser        `json:"users"`
	Payments     []Payment           `json:"payments"`
	TotalPaid    int64               `json:"totalPaid"`
}

func (h *Handler) GetClient(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := chi.URLParam(r, "clientID")
	var d clientDetail
	err := h.DB.QueryRow(ctx, `
		SELECT id, name, contact_name, contact_phone, contact_email, billing_gstin, notes, status, created_at
		FROM organizations WHERE id::text = $1`, id).
		Scan(&d.ID, &d.Name, &d.ContactName, &d.ContactPhone, &d.ContactEmail, &d.BillingGSTIN, &d.Notes, &d.Status, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Client not found.")
	}
	if err != nil {
		return err
	}

	rows, err := h.DB.Query(ctx, `SELECT `+property.Columns+property.From+`WHERE p.organization_id = $1 ORDER BY p.created_at`, d.ID)
	if err != nil {
		return err
	}
	if d.Properties, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (property.Property, error) {
		return property.Scan(row, h.Signer)
	}); err != nil {
		return err
	}
	var subs []billing.Subscription
	for _, p := range d.Properties {
		if p.Subscription != nil {
			subs = append(subs, *p.Subscription)
		}
	}
	d.State = clientState(d.Status, subs, property.Today())

	rows, err = h.DB.Query(ctx, `
		SELECT id, name, email, phone, role, password_hash IS NOT NULL, created_at
		FROM users WHERE organization_id = $1 ORDER BY role = 'owner' DESC, created_at`, d.ID)
	if err != nil {
		return err
	}
	if d.Users, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (clientUser, error) {
		var u clientUser
		err := row.Scan(&u.ID, &u.Name, &u.Email, &u.Phone, &u.Role, &u.Activated, &u.CreatedAt)
		return u, err
	}); err != nil {
		return err
	}

	if d.Payments, err = h.queryPayments(ctx, d.ID, 500); err != nil {
		return err
	}
	for _, p := range d.Payments {
		d.TotalPaid += p.Amount
	}
	httpx.JSON(w, http.StatusOK, d)
	return nil
}

func (h *Handler) UpdateClient(w http.ResponseWriter, r *http.Request) error {
	var in clientInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	f := map[string]string{}
	in.normalize(f, "")
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	id := chi.URLParam(r, "clientID")
	tag, err := h.DB.Exec(r.Context(), `
		UPDATE organizations SET name=$2, contact_name=$3, contact_phone=$4, contact_email=$5, billing_gstin=$6, notes=$7
		WHERE id::text = $1`, id, in.Name, in.ContactName, in.ContactPhone, in.ContactEmail, in.BillingGSTIN, in.Notes)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Client not found.")
	}
	h.audit(r.Context(), "client.updated", "client", id, map[string]any{"name": in.Name})
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handler) SetClientStatus(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if in.Status != "active" && in.Status != "suspended" {
		return httpx.BadRequest("Status must be active or suspended.")
	}
	ctx := r.Context()
	id := chi.URLParam(r, "clientID")
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE organizations SET status = $2 WHERE id::text = $1`, id, in.Status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Client not found.")
	}
	if in.Status == "suspended" {
		// Sign everyone out right away; access tokens expire within 15 minutes and
		// property routes already reject suspended clients.
		if _, err := tx.Exec(ctx, `
			UPDATE refresh_tokens SET revoked_at = now()
			WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE organization_id::text = $1)`, id); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	h.audit(ctx, "client."+map[string]string{"active": "reactivated", "suspended": "suspended"}[in.Status], "client", id,
		map[string]any{"reason": in.Reason})
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---- Properties under a client ----

type addPropertyReq struct {
	Property property.Input `json:"property"`
	Plan     planInput      `json:"plan"`
}

func (h *Handler) AddProperty(w http.ResponseWriter, r *http.Request) error {
	var req addPropertyReq
	if err := httpx.Decode(r, &req); err != nil {
		return err
	}
	f := map[string]string{}
	for k, v := range req.Property.Normalize() {
		f["property."+k] = v
	}
	req.Plan.normalize(f, "plan.")
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	ctx := r.Context()
	clientID := chi.URLParam(r, "clientID")
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var orgID string
	if err := tx.QueryRow(ctx, `SELECT id FROM organizations WHERE id::text = $1`, clientID).Scan(&orgID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.NotFound("Client not found.")
		}
		return err
	}
	propID, err := property.Insert(ctx, tx, orgID, req.Property)
	if err != nil {
		return err
	}
	if _, err := h.createSubscription(ctx, tx, orgID, propID, req.Plan); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	h.audit(ctx, "property.created", "property", propID, map[string]any{"name": req.Property.Name, "client": orgID})
	httpx.JSON(w, http.StatusCreated, map[string]string{"propertyId": propID})
	return nil
}

func (h *Handler) UpdateProperty(w http.ResponseWriter, r *http.Request) error {
	var in property.Input
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if f := in.Normalize(); len(f) > 0 {
		return httpx.Invalid(f)
	}
	id := chi.URLParam(r, "propertyID")
	if err := property.UpdateProfile(r.Context(), h.DB, id, in); err != nil {
		return err
	}
	h.audit(r.Context(), "property.updated", "property", id, map[string]any{"name": in.Name})
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handler) UploadLogo(w http.ResponseWriter, r *http.Request) error {
	data, ext, err := storage.ReadImage(r, "logo")
	if err != nil {
		return err
	}
	id := chi.URLParam(r, "propertyID")
	if err := property.SaveLogo(r.Context(), h.DB, h.Store, id, data, ext); err != nil {
		return err
	}
	h.audit(r.Context(), "property.logo_updated", "property", id, nil)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handler) DeleteLogo(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "propertyID")
	if err := property.RemoveLogo(r.Context(), h.DB, h.Store, id); err != nil {
		return err
	}
	h.audit(r.Context(), "property.logo_removed", "property", id, nil)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---- Invites ----

// ResendInvite issues a fresh invite link for a user who hasn't set a password yet.
func (h *Handler) ResendInvite(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	clientID, userID := chi.URLParam(r, "clientID"), chi.URLParam(r, "userID")
	var activated bool
	var email string
	err := h.DB.QueryRow(ctx, `SELECT password_hash IS NOT NULL, email FROM users WHERE id::text = $1 AND organization_id::text = $2`,
		userID, clientID).Scan(&activated, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("User not found.")
	}
	if err != nil {
		return err
	}
	if activated {
		return httpx.Conflict("This person has already set their password and can sign in.")
	}
	token, err := authCreateInvite(ctx, h.DB, userID)
	if err != nil {
		return err
	}
	h.audit(ctx, "user.invite_resent", "client", clientID, map[string]any{"email": email})
	httpx.JSON(w, http.StatusOK, map[string]string{"inviteUrl": h.inviteURL(token)})
	return nil
}

// ---- helpers ----

func isUnique(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
