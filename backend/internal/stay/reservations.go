package stay

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/guestly/backend/internal/auth"
	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/property"
)

const dateLayout = "2006-01-02"

// istDate is the hotel's calendar date for a moment in time.
func istDate(t time.Time) string {
	return t.In(property.IST).Format(dateLayout)
}

type Reservation struct {
	ID               string    `json:"id"`
	Status           string    `json:"status"`
	RoomID           string    `json:"roomId"`
	RoomNumber       string    `json:"roomNumber"`
	RoomType         string    `json:"roomType"`
	GuestName        string    `json:"guestName"`
	GuestPhone       string    `json:"guestPhone"`
	CheckIn          string    `json:"checkIn"`
	CheckOut         string    `json:"checkOut"`
	Adults           int       `json:"adults"`
	Children         int       `json:"children"`
	NightlyRate      int64     `json:"nightlyRate"`
	AdvanceAmount    int64     `json:"advanceAmount"`
	AdvanceMode      *string   `json:"advanceMode"`
	AdvanceReference string    `json:"advanceReference"`
	Notes            string    `json:"notes"`
	WhatsAppConsent  bool      `json:"whatsappConsent"`
	StayID           *string   `json:"stayId"`
	CancelReason     string    `json:"cancelReason"`
	CreatedAt        time.Time `json:"createdAt"`
	ConfirmationSent bool      `json:"confirmationSent"`
}

const reservationSelect = `
	SELECT r.id, r.status, r.room_id, rm.number, t.name, r.guest_name, r.guest_phone,
		to_char(r.check_in, 'YYYY-MM-DD'), to_char(r.check_out, 'YYYY-MM-DD'), r.adults, r.children, r.nightly_rate,
		r.advance_amount, r.advance_mode, r.advance_reference, r.notes, r.whatsapp_consent, r.stay_id, r.cancel_reason, r.created_at,
		EXISTS (SELECT 1 FROM message_log m WHERE m.reservation_id = r.id AND m.kind = 'booking' AND m.status = 'sent')
	FROM reservations r JOIN rooms rm ON rm.id = r.room_id JOIN room_types t ON t.id = rm.room_type_id
	WHERE r.property_id = $1 AND `

func scanReservation(row pgx.Row) (Reservation, error) {
	var r Reservation
	err := row.Scan(&r.ID, &r.Status, &r.RoomID, &r.RoomNumber, &r.RoomType, &r.GuestName, &r.GuestPhone, &r.CheckIn, &r.CheckOut,
		&r.Adults, &r.Children, &r.NightlyRate, &r.AdvanceAmount, &r.AdvanceMode, &r.AdvanceReference, &r.Notes, &r.WhatsAppConsent,
		&r.StayID, &r.CancelReason, &r.CreatedAt, &r.ConfirmationSent)
	return r, err
}

func (h *Handler) loadReservation(ctx context.Context, id string) (Reservation, error) {
	r, err := scanReservation(h.DB.QueryRow(ctx, reservationSelect+`r.id::text = $2`, property.ID(ctx), id))
	if errors.Is(err, pgx.ErrNoRows) {
		return r, httpx.NotFound("Reservation not found.")
	}
	return r, err
}

// ListReservations returns bookings that touch [from, to), for the calendar.
func (h *Handler) ListReservations(w http.ResponseWriter, r *http.Request) error {
	from, err1 := time.Parse(dateLayout, r.URL.Query().Get("from"))
	to, err2 := time.Parse(dateLayout, r.URL.Query().Get("to"))
	if err1 != nil || err2 != nil || !to.After(from) {
		return httpx.BadRequest("from and to must be dates, with to after from")
	}
	rows, err := h.DB.Query(r.Context(), reservationSelect+`r.status IN ('booked', 'checked_in') AND r.check_in < $3::date AND r.check_out > $2::date
		ORDER BY r.check_in, rm.number LIMIT 2000`, property.ID(r.Context()), from.Format(dateLayout), to.Format(dateLayout))
	if err != nil {
		return err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Reservation, error) { return scanReservation(row) })
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

func (h *Handler) GetReservation(w http.ResponseWriter, r *http.Request) error {
	res, err := h.loadReservation(r.Context(), chi.URLParam(r, "reservationID"))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, res)
	return nil
}

type AvailableRoom struct {
	ID       string `json:"id"`
	Number   string `json:"number"`
	Floor    int    `json:"floor"`
	TypeName string `json:"typeName"`
	BedType  string `json:"bedType"`
	BaseRate int64  `json:"baseRate"`
}

// Availability lists rooms free for the nights in [from, to).
func (h *Handler) Availability(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	from, err1 := time.Parse(dateLayout, q.Get("from"))
	to, err2 := time.Parse(dateLayout, q.Get("to"))
	if err1 != nil || err2 != nil || !to.After(from) {
		return httpx.BadRequest("from and to must be dates, with to after from")
	}
	rows, err := h.DB.Query(r.Context(), `
		SELECT rm.id, rm.number, rm.floor, t.name, t.bed_type, t.base_rate
		FROM rooms rm JOIN room_types t ON t.id = rm.room_type_id
		WHERE rm.property_id = $1
		  AND NOT EXISTS (SELECT 1 FROM reservations x WHERE x.room_id = rm.id AND x.status = 'booked' AND x.id::text <> $4
			AND daterange(x.check_in, x.check_out) && daterange($2::date, $3::date))
		  AND NOT EXISTS (`+inHouseOverlap+`)
		ORDER BY rm.floor, length(rm.number), rm.number`,
		property.ID(r.Context()), from.Format(dateLayout), to.Format(dateLayout), q.Get("exclude"))
	if err != nil {
		return err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (AvailableRoom, error) {
		var a AvailableRoom
		err := row.Scan(&a.ID, &a.Number, &a.Floor, &a.TypeName, &a.BedType, &a.BaseRate)
		return a, err
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

// inHouseOverlap finds an in-house stay in room rm whose nights overlap $2..$3.
const inHouseOverlap = `
	SELECT 1 FROM stays s JOIN properties sp ON sp.id = s.property_id
	WHERE s.room_id = rm.id AND s.status = 'in_house' AND daterange(
		(s.check_in_at AT TIME ZONE 'Asia/Kolkata')::date,
		greatest(
			-- Due out after the check-in time: the room isn't free for that day's arrival (see occupiedRange).
			(s.expected_check_out_at AT TIME ZONE 'Asia/Kolkata')::date
				+ CASE WHEN (s.expected_check_out_at AT TIME ZONE 'Asia/Kolkata')::time > sp.check_in_time THEN 1 ELSE 0 END,
			(s.check_in_at AT TIME ZONE 'Asia/Kolkata')::date + 1)
	) && daterange($2::date, $3::date)`

func shortDay(s string) string {
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		return s
	}
	return t.Format("2 Jan")
}

// bookingClash finds the first live booking overlapping [from, to), other than exclude.
// ok is false when there is none.
func bookingClash(ctx context.Context, q property.Querier, propertyID, roomID, from, to, exclude string) (guest, in, out string, ok bool, err error) {
	err = q.QueryRow(ctx, `
		SELECT guest_name, to_char(check_in, 'YYYY-MM-DD'), to_char(check_out, 'YYYY-MM-DD') FROM reservations
		WHERE property_id = $1 AND room_id::text = $2 AND status = 'booked' AND id::text <> $5
		  AND daterange(check_in, check_out) && daterange($3::date, $4::date)
		ORDER BY check_in LIMIT 1`, propertyID, roomID, from, to, exclude).Scan(&guest, &in, &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", false, nil
	}
	return guest, in, out, err == nil, err
}

// clockLabel turns "11:00" into "11 AM" and "13:30" into "1:30 PM".
func clockLabel(hhmm string) string {
	t, err := time.Parse("15:04", hhmm)
	if err != nil {
		return hhmm
	}
	if t.Minute() == 0 {
		return t.Format("3 PM")
	}
	return t.Format("3:04 PM")
}

// roomBookedError reports a live booking overlapping [from, to), other than exclude.
func roomBookedError(ctx context.Context, q property.Querier, propertyID, roomID, from, to, exclude string) error {
	guest, in, out, ok, err := bookingClash(ctx, q, propertyID, roomID, from, to, exclude)
	if !ok {
		return err
	}
	return httpx.Invalid(map[string]string{"roomId": fmt.Sprintf("This room is booked for %s, %s to %s. Choose another room.", guest, shortDay(in), shortDay(out))})
}

// occupiedRange is the hotel dates [from, to) an in-house stay keeps a room
// from new arrivals. A guest due out after the hotel's check-in time (common
// with 24-hour checkout) still has the room when that day's arrival comes, so
// that day counts too.
func occupiedRange(start, end time.Time, checkInTime string) (string, string) {
	from, to := stayRange(start, end)
	if end.In(property.IST).Format("15:04") > checkInTime {
		next, _ := time.Parse(dateLayout, istDate(end))
		if d := next.AddDate(0, 0, 1).Format(dateLayout); d > to {
			to = d
		}
	}
	return from, to
}

// stayRange returns the hotel dates [from, to) a stay occupies.
func stayRange(start, end time.Time) (string, string) {
	from, to := istDate(start), istDate(end)
	if to <= from {
		next, _ := time.Parse(dateLayout, from)
		to = next.AddDate(0, 0, 1).Format(dateLayout)
	}
	return from, to
}

type reservationInput struct {
	GuestName        string `json:"guestName"`
	GuestPhone       string `json:"guestPhone"`
	RoomID           string `json:"roomId"`
	CheckIn          string `json:"checkIn"`
	CheckOut         string `json:"checkOut"`
	Adults           int    `json:"adults"`
	Children         int    `json:"children"`
	NightlyRate      int64  `json:"nightlyRate"`
	AdvanceAmount    int64  `json:"advanceAmount"`
	AdvanceMode      string `json:"advanceMode"`
	AdvanceReference string `json:"advanceReference"`
	Notes            string `json:"notes"`
	WhatsAppConsent  bool   `json:"whatsappConsent"`
}

const maxBookingNights = 180

// validate normalizes input and returns per-field errors. today is the hotel's date.
func (in *reservationInput) validate(today time.Time) map[string]string {
	f := map[string]string{}
	in.GuestName = strings.Join(strings.Fields(in.GuestName), " ")
	in.AdvanceReference = strings.TrimSpace(in.AdvanceReference)
	in.Notes = strings.TrimSpace(in.Notes)
	if in.GuestName == "" {
		f["guestName"] = "Enter the guest's name."
	} else if utf8.RuneCountInString(in.GuestName) > 120 {
		f["guestName"] = "Name is too long."
	}
	if in.GuestPhone = NormalizePhone(in.GuestPhone); in.GuestPhone == "" {
		f["guestPhone"] = "Enter a 10-digit mobile number, or + country code for foreign numbers."
	}
	day := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	cin, err1 := time.Parse(dateLayout, in.CheckIn)
	cout, err2 := time.Parse(dateLayout, in.CheckOut)
	switch {
	case err1 != nil:
		f["checkIn"] = "Choose the arrival date."
	case cin.Before(day):
		f["checkIn"] = "Arrival can't be in the past."
	case cin.After(day.AddDate(2, 0, 0)):
		f["checkIn"] = "Bookings can be up to 2 years ahead."
	}
	switch {
	case err2 != nil:
		f["checkOut"] = "Choose the checkout date."
	case err1 == nil && !cout.After(cin):
		f["checkOut"] = "Checkout must be after arrival."
	case err1 == nil && cout.Sub(cin).Hours()/24 > maxBookingNights:
		f["checkOut"] = "Bookings can be up to 180 nights."
	}
	if in.Adults < 1 || in.Adults > 20 {
		f["adults"] = "Enter the number of adults."
	}
	if in.Children < 0 || in.Children > 20 {
		f["children"] = "Enter the number of children."
	}
	if in.NightlyRate < 0 {
		f["nightlyRate"] = "Rate can't be negative."
	}
	if in.AdvanceAmount < 0 {
		f["advanceAmount"] = "Amount can't be negative."
	}
	if in.AdvanceAmount > 0 && !payModes[in.AdvanceMode] {
		f["advanceMode"] = "Choose how they paid."
	}
	return f
}

// checkBookable locks the room and verifies it's free. Locking serializes this
// against check-ins and other bookings for the same room.
func checkBookable(ctx context.Context, tx pgx.Tx, in reservationInput, exclude string) error {
	propertyID := property.ID(ctx)
	var locked string
	err := tx.QueryRow(ctx, `SELECT id FROM rooms WHERE id::text = $1 AND property_id = $2 FOR UPDATE`, in.RoomID, propertyID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.Invalid(map[string]string{"roomId": "Choose a room."})
	}
	if err != nil {
		return err
	}
	if err := roomBookedError(ctx, tx, propertyID, in.RoomID, in.CheckIn, in.CheckOut, exclude); err != nil {
		return err
	}
	var guest string
	err = tx.QueryRow(ctx, `
		SELECT g.name FROM rooms rm JOIN stays s ON s.room_id = rm.id AND s.status = 'in_house' JOIN guests g ON g.id = s.guest_id
		WHERE rm.id::text = $1 AND EXISTS (`+inHouseOverlap+`) LIMIT 1`, in.RoomID, in.CheckIn, in.CheckOut).Scan(&guest)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return httpx.Invalid(map[string]string{"roomId": guest + " is staying in this room on those dates. Choose another room."})
}

// mapDoubleBooking turns the database's exclusion violation into a form error.
func mapDoubleBooking(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23P01" {
		return httpx.Invalid(map[string]string{"roomId": "Someone just booked this room for those dates. Choose another room."})
	}
	return err
}

func nullableMode(in reservationInput) *string {
	if in.AdvanceAmount > 0 {
		return &in.AdvanceMode
	}
	return nil
}

func (h *Handler) CreateReservation(w http.ResponseWriter, r *http.Request) error {
	if err := property.EnforceFreeEntryLimit(r.Context(), h.DB, property.ID(r.Context())); err != nil {
		return err
	}
	var in reservationInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if f := in.validate(property.Today()); len(f) > 0 {
		return httpx.Invalid(f)
	}
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := checkBookable(ctx, tx, in, ""); err != nil {
		return err
	}
	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO reservations (property_id, room_id, guest_name, guest_phone, check_in, check_out, adults, children, nightly_rate,
			advance_amount, advance_mode, advance_reference, notes, whatsapp_consent, created_by)
		VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
		property.ID(ctx), in.RoomID, in.GuestName, in.GuestPhone, in.CheckIn, in.CheckOut, in.Adults, in.Children, in.NightlyRate,
		in.AdvanceAmount, nullableMode(in), in.AdvanceReference, in.Notes, in.WhatsAppConsent, auth.FromContext(ctx).UserID).Scan(&id)
	if err != nil {
		return mapDoubleBooking(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	res, err := h.loadReservation(ctx, id)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, res)
	return nil
}

// lockBooked locks a reservation that must still be in the booked state.
func lockBooked(ctx context.Context, tx pgx.Tx, id string) error {
	var status string
	err := tx.QueryRow(ctx, `SELECT status FROM reservations WHERE id::text = $1 AND property_id = $2 FOR UPDATE`, id, property.ID(ctx)).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Reservation not found.")
	}
	if err != nil {
		return err
	}
	switch status {
	case "booked":
		return nil
	case "checked_in":
		return httpx.Conflict("This guest has already checked in.")
	case "cancelled":
		return httpx.Conflict("This booking was cancelled.")
	default:
		return httpx.Conflict("This booking was marked as a no-show.")
	}
}

func (h *Handler) UpdateReservation(w http.ResponseWriter, r *http.Request) error {
	var in reservationInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	id := chi.URLParam(r, "reservationID")
	f := in.validate(property.Today())
	// A late arrival's booking can still be edited, so keep its original arrival date valid.
	if _, past := f["checkIn"]; past {
		if cur, err := h.loadReservation(ctx, id); err == nil && cur.CheckIn == in.CheckIn {
			delete(f, "checkIn")
		}
	}
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockBooked(ctx, tx, id); err != nil {
		return err
	}
	if err := checkBookable(ctx, tx, in, id); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		UPDATE reservations SET room_id=$2, guest_name=$3, guest_phone=$4, check_in=$5::date, check_out=$6::date, adults=$7, children=$8,
			nightly_rate=$9, advance_amount=$10, advance_mode=$11, advance_reference=$12, notes=$13, whatsapp_consent=$14, updated_at=now()
		WHERE id::text = $1`, id, in.RoomID, in.GuestName, in.GuestPhone, in.CheckIn, in.CheckOut, in.Adults, in.Children, in.NightlyRate,
		in.AdvanceAmount, nullableMode(in), in.AdvanceReference, in.Notes, in.WhatsAppConsent)
	if err != nil {
		return mapDoubleBooking(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	res, err := h.loadReservation(ctx, id)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, res)
	return nil
}

func (h *Handler) closeReservation(w http.ResponseWriter, r *http.Request, status, reason string) error {
	ctx := r.Context()
	id := chi.URLParam(r, "reservationID")
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockBooked(ctx, tx, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE reservations SET status=$2, cancel_reason=$3, updated_at=now() WHERE id::text = $1`, id, status, reason); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	res, err := h.loadReservation(ctx, id)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, res)
	return nil
}

func (h *Handler) CancelReservation(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Reason string `json:"reason"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	return h.closeReservation(w, r, "cancelled", strings.TrimSpace(in.Reason))
}

func (h *Handler) NoShowReservation(w http.ResponseWriter, r *http.Request) error {
	return h.closeReservation(w, r, "no_show", "")
}

// PreviewReservationMessage renders the booking confirmation for staff to review.
func (h *Handler) PreviewReservationMessage(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	res, err := h.loadReservation(ctx, chi.URLParam(r, "reservationID"))
	if err != nil {
		return err
	}
	prop, err := h.loadProperty(ctx)
	if err != nil {
		return err
	}
	t, err := h.template(ctx, "booking")
	if err != nil {
		return err
	}
	longDay := func(s string) string {
		d, err := time.Parse(dateLayout, s)
		if err != nil {
			return s
		}
		return d.Format("Mon, 2 Jan")
	}
	first := res.GuestName
	if p := strings.Fields(res.GuestName); len(p) > 0 {
		first = p[0]
	}
	hotelPhone := prop.FrontDesk.WhatsAppNumber
	if hotelPhone == "" {
		hotelPhone = prop.Phone
	}
	advance := ""
	if res.AdvanceAmount > 0 {
		advance = rupeeText(res.AdvanceAmount)
	}
	addr := strings.Join(nonEmpty(prop.Name, prop.Address, prop.City), ", ")
	vars := map[string]string{
		"guest_name": first, "hotel_name": prop.Name, "room": res.RoomNumber,
		"checkin_date": longDay(res.CheckIn), "checkin_time": formatClock(prop.CheckInTime),
		"checkout_date": longDay(res.CheckOut), "checkout_time": formatClock(prop.CheckOutTime),
		"advance": advance, "hotel_phone": hotelPhone,
		"map_link":  "https://maps.google.com/?q=" + url.QueryEscape(addr),
		"wifi_name": prop.FrontDesk.WifiName, "wifi_password": prop.FrontDesk.WifiPassword, "amount": "",
	}
	p := preview{Kind: "booking", Phone: res.GuestPhone, Body: Render(t.Body, vars), OpenIn: prop.FrontDesk.WhatsAppOpenIn,
		Enabled: t.Enabled, Consent: res.WhatsAppConsent, Warnings: []string{}}
	if !res.WhatsAppConsent {
		p.Warnings = append(p.Warnings, "The guest didn't agree to WhatsApp messages when booking.")
	}
	httpx.JSON(w, http.StatusOK, p)
	return nil
}

func (h *Handler) LogReservationMessage(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Kind   string `json:"kind"`
		Phone  string `json:"phone"`
		Body   string `json:"body"`
		Status string `json:"status"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if in.Kind != "booking" {
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
	res, err := h.loadReservation(ctx, chi.URLParam(r, "reservationID"))
	if err != nil {
		return err
	}
	if _, err := h.DB.Exec(ctx, `INSERT INTO message_log (property_id, reservation_id, kind, phone, body, status, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		property.ID(ctx), res.ID, in.Kind, phone, in.Body, in.Status, auth.FromContext(ctx).UserID); err != nil {
		return err
	}
	res, err = h.loadReservation(ctx, res.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, res)
	return nil
}
