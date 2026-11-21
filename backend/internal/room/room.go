// Package room manages room types, rooms, and housekeeping status.
package room

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/guestly/backend/internal/auth"
	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/property"
)

type Handler struct {
	DB *pgxpool.Pool
}

// ---- Room types ----

type RoomType struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	BedType   string `json:"bedType"`
	BaseRate  int64  `json:"baseRate"` // paise
	MaxGuests int    `json:"maxGuests"`
	RoomCount int    `json:"roomCount"`
}

func (h *Handler) ListTypes(w http.ResponseWriter, r *http.Request) error {
	rows, err := h.DB.Query(r.Context(), `
		SELECT t.id, t.name, t.bed_type, t.base_rate, t.max_guests,
			(SELECT count(*) FROM rooms WHERE room_type_id = t.id)
		FROM room_types t WHERE t.property_id = $1 ORDER BY t.base_rate, t.name`, property.ID(r.Context()))
	if err != nil {
		return err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (RoomType, error) {
		var t RoomType
		err := row.Scan(&t.ID, &t.Name, &t.BedType, &t.BaseRate, &t.MaxGuests, &t.RoomCount)
		return t, err
	})
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

type typeInput struct {
	Name      string `json:"name"`
	BedType   string `json:"bedType"`
	BaseRate  int64  `json:"baseRate"`
	MaxGuests int    `json:"maxGuests"`
}

func (in *typeInput) validate() map[string]string {
	in.Name = strings.TrimSpace(in.Name)
	in.BedType = strings.TrimSpace(in.BedType)
	if in.MaxGuests == 0 {
		in.MaxGuests = 2
	}
	f := map[string]string{}
	if in.Name == "" {
		f["name"] = "Enter a room type name, like Deluxe."
	}
	if in.BaseRate < 0 {
		f["baseRate"] = "Rate can't be negative."
	}
	if in.MaxGuests < 1 || in.MaxGuests > 20 {
		f["maxGuests"] = "Max guests should be between 1 and 20."
	}
	return f
}

func (h *Handler) CreateType(w http.ResponseWriter, r *http.Request) error {
	var in typeInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if f := in.validate(); len(f) > 0 {
		return httpx.Invalid(f)
	}
	t := RoomType{Name: in.Name, BedType: in.BedType, BaseRate: in.BaseRate, MaxGuests: in.MaxGuests}
	err := h.DB.QueryRow(r.Context(),
		`INSERT INTO room_types (property_id, name, bed_type, base_rate, max_guests) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		property.ID(r.Context()), in.Name, in.BedType, in.BaseRate, in.MaxGuests).Scan(&t.ID)
	if isUnique(err) {
		return httpx.Invalid(map[string]string{"name": "A room type with this name already exists."})
	}
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, t)
	return nil
}

func (h *Handler) UpdateType(w http.ResponseWriter, r *http.Request) error {
	var in typeInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if f := in.validate(); len(f) > 0 {
		return httpx.Invalid(f)
	}
	tag, err := h.DB.Exec(r.Context(),
		`UPDATE room_types SET name=$3, bed_type=$4, base_rate=$5, max_guests=$6 WHERE id::text=$1 AND property_id=$2`,
		chi.URLParam(r, "typeID"), property.ID(r.Context()), in.Name, in.BedType, in.BaseRate, in.MaxGuests)
	if isUnique(err) {
		return httpx.Invalid(map[string]string{"name": "A room type with this name already exists."})
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Room type not found.")
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handler) DeleteType(w http.ResponseWriter, r *http.Request) error {
	tag, err := h.DB.Exec(r.Context(), `DELETE FROM room_types WHERE id::text=$1 AND property_id=$2`,
		chi.URLParam(r, "typeID"), property.ID(r.Context()))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return httpx.Conflict("Move or delete the rooms of this type first.")
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Room type not found.")
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---- Rooms ----

type Status string

const (
	StatusReady       Status = "ready"
	StatusOccupied    Status = "occupied"
	StatusCleaning    Status = "cleaning"
	StatusMaintenance Status = "maintenance"
)

type Room struct {
	ID         string `json:"id"`
	Number     string `json:"number"`
	Floor      int    `json:"floor"`
	Status     Status `json:"status"`
	Notes      string `json:"notes"`
	RoomTypeID string `json:"roomTypeId"`
	TypeName   string `json:"typeName"`
	BedType    string `json:"bedType"`
	BaseRate   int64  `json:"baseRate"`
	// Set while a guest is in-house.
	StayID             *string    `json:"stayId"`
	GuestName          *string    `json:"guestName"`
	ExpectedCheckOutAt *time.Time `json:"expectedCheckOutAt"`
	// Set while a booking holds this room for today (including late arrivals).
	ReservationID *string `json:"reservationId"`
	ReservedFor   *string `json:"reservedFor"`
}

const roomSelect = `SELECT r.id, r.number, r.floor, r.status, r.notes, t.id, t.name, t.bed_type, t.base_rate,
		s.id, g.name, s.expected_check_out_at, b.id, b.guest_name
	FROM rooms r JOIN room_types t ON t.id = r.room_type_id
	LEFT JOIN stays s ON s.room_id = r.id AND s.status = 'in_house'
	LEFT JOIN guests g ON g.id = s.guest_id
	LEFT JOIN reservations b ON b.room_id = r.id AND b.status = 'booked'
		AND b.check_in <= (now() AT TIME ZONE 'Asia/Kolkata')::date AND b.check_out > (now() AT TIME ZONE 'Asia/Kolkata')::date`

func scanRoom(row pgx.Row) (Room, error) {
	var rm Room
	err := row.Scan(&rm.ID, &rm.Number, &rm.Floor, &rm.Status, &rm.Notes, &rm.RoomTypeID, &rm.TypeName, &rm.BedType, &rm.BaseRate,
		&rm.StayID, &rm.GuestName, &rm.ExpectedCheckOutAt, &rm.ReservationID, &rm.ReservedFor)
	return rm, err
}

type Summary struct {
	Total       int `json:"total"`
	Ready       int `json:"ready"`
	Occupied    int `json:"occupied"`
	Cleaning    int `json:"cleaning"`
	Maintenance int `json:"maintenance"`
	Floors      int `json:"floors"`
}

type listResponse struct {
	Rooms   []Room  `json:"rooms"`
	Summary Summary `json:"summary"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) error {
	rows, err := h.DB.Query(r.Context(),
		roomSelect+` WHERE r.property_id = $1 ORDER BY r.floor, length(r.number), r.number`, property.ID(r.Context()))
	if err != nil {
		return err
	}
	rooms, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Room, error) { return scanRoom(row) })
	if err != nil {
		return err
	}
	var s Summary
	floors := map[int]bool{}
	for _, rm := range rooms {
		s.Total++
		floors[rm.Floor] = true
		switch rm.Status {
		case StatusReady:
			s.Ready++
		case StatusOccupied:
			s.Occupied++
		case StatusCleaning:
			s.Cleaning++
		case StatusMaintenance:
			s.Maintenance++
		}
	}
	s.Floors = len(floors)
	httpx.JSON(w, http.StatusOK, listResponse{Rooms: rooms, Summary: s})
	return nil
}

type roomInput struct {
	Number           string `json:"number"`
	Floor            int    `json:"floor"`
	RoomTypeID       string `json:"roomTypeId"`
	RoomType         string `json:"roomType"`          // "Standard", "Deluxe", "Suite"
	BedConfiguration string `json:"bedConfiguration"` // "Single", "Double", "Queen", "King", "Twin", "King + Sofa Bed"
	Notes            string `json:"notes"`
}

func (h *Handler) validateRoom(r *http.Request, in *roomInput) (map[string]string, error) {
	in.Number = strings.TrimSpace(in.Number)
	in.RoomType = strings.TrimSpace(in.RoomType)
	in.BedConfiguration = strings.TrimSpace(in.BedConfiguration)
	f := map[string]string{}
	if in.Number == "" || len(in.Number) > 10 {
		f["number"] = "Enter a room number (up to 10 characters)."
	}
	if in.Floor < -2 || in.Floor > 200 {
		f["floor"] = "Enter a valid floor."
	}
	if in.RoomTypeID == "" && in.RoomType != "" && in.BedConfiguration != "" {
		var tid string
		err := h.DB.QueryRow(r.Context(), `
			SELECT id FROM room_types 
			WHERE property_id = $1 AND lower(name) = lower($2) AND lower(bed_type) = lower($3)
			LIMIT 1`, property.ID(r.Context()), in.RoomType, in.BedConfiguration).Scan(&tid)
		if errors.Is(err, pgx.ErrNoRows) {
			err = h.DB.QueryRow(r.Context(), `
				INSERT INTO room_types (property_id, name, bed_type, base_rate, max_guests)
				VALUES ($1, $2, $3, 0, 2)
				RETURNING id`, property.ID(r.Context()), in.RoomType, in.BedConfiguration).Scan(&tid)
		}
		if err != nil {
			return nil, err
		}
		in.RoomTypeID = tid
	}
	if in.RoomTypeID == "" {
		if in.RoomType == "" {
			f["roomType"] = "Choose a room type."
		}
		if in.BedConfiguration == "" {
			f["bedConfiguration"] = "Choose a bed configuration."
		}
		if len(f) > 0 {
			return f, nil
		}
	} else {
		var ok bool
		err := h.DB.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM room_types WHERE id::text=$1 AND property_id=$2)`,
			in.RoomTypeID, property.ID(r.Context())).Scan(&ok)
		if err != nil {
			return nil, err
		}
		if !ok {
			f["roomTypeId"] = "Choose a room type."
		}
	}
	return f, nil
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) error {
	if err := property.EnforceFreeEntryLimit(r.Context(), h.DB, property.ID(r.Context())); err != nil {
		return err
	}
	var in roomInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	f, err := h.validateRoom(r, &in)
	if err != nil {
		return err
	}
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	var id string
	err = h.DB.QueryRow(r.Context(),
		`INSERT INTO rooms (property_id, room_type_id, number, floor, status, notes) VALUES ($1,$2,$3,$4,'ready',$5) RETURNING id`,
		property.ID(r.Context()), in.RoomTypeID, in.Number, in.Floor, in.Notes).Scan(&id)
	if isUnique(err) {
		return httpx.Invalid(map[string]string{"number": "Room " + in.Number + " already exists."})
	}
	if err != nil {
		return err
	}
	rm, err := scanRoom(h.DB.QueryRow(r.Context(), roomSelect+` WHERE r.id = $1`, id))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, rm)
	return nil
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) error {
	var in roomInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	f, err := h.validateRoom(r, &in)
	if err != nil {
		return err
	}
	if len(f) > 0 {
		return httpx.Invalid(f)
	}
	tag, err := h.DB.Exec(r.Context(),
		`UPDATE rooms SET room_type_id=$3, number=$4, floor=$5, notes=$6, updated_at=now() WHERE id::text=$1 AND property_id=$2`,
		chi.URLParam(r, "roomID"), property.ID(r.Context()), in.RoomTypeID, in.Number, in.Floor, in.Notes)
	if isUnique(err) {
		return httpx.Invalid(map[string]string{"number": "Room " + in.Number + " already exists."})
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Room not found.")
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) error {
	var status Status
	err := h.DB.QueryRow(r.Context(), `DELETE FROM rooms WHERE id::text=$1 AND property_id=$2 AND status <> 'occupied' RETURNING status`,
		chi.URLParam(r, "roomID"), property.ID(r.Context())).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.Conflict("Room not found, or it's occupied. Check the guest out before removing it.")
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return httpx.Conflict("This room has past stays or bookings, so it can't be removed.")
	}
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type statusInput struct {
	Status Status `json:"status"`
}

// manualTransitions are the housekeeping changes staff can make by hand.
// Occupied is entered and left only through check-in and checkout.
var manualTransitions = map[Status][]Status{
	StatusReady:       {StatusCleaning, StatusMaintenance},
	StatusCleaning:    {StatusReady, StatusMaintenance},
	StatusMaintenance: {StatusReady, StatusCleaning},
}

// CanTransition reports whether staff may move a room from one status to another by hand.
func CanTransition(from, to Status) bool {
	for _, s := range manualTransitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

func (h *Handler) SetStatus(w http.ResponseWriter, r *http.Request) error {
	var in statusInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	if p := auth.FromContext(r.Context()); p.Role == auth.RoleHousekeeping && in.Status == StatusMaintenance {
		return httpx.Forbidden("Ask a manager to put a room under maintenance.")
	}
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var current Status
	err = tx.QueryRow(ctx, `SELECT status FROM rooms WHERE id::text=$1 AND property_id=$2 FOR UPDATE`,
		chi.URLParam(r, "roomID"), property.ID(ctx)).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Room not found.")
	}
	if err != nil {
		return err
	}
	if current == StatusOccupied {
		return httpx.Conflict("This room is occupied. Check the guest out to change its status.")
	}
	if in.Status == current {
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
	if !CanTransition(current, in.Status) {
		return httpx.BadRequest("A room can't go from " + string(current) + " to " + string(in.Status) + " by hand.")
	}
	if _, err := tx.Exec(ctx, `UPDATE rooms SET status=$2, updated_at=now() WHERE id::text=$1`, chi.URLParam(r, "roomID"), in.Status); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func isUnique(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
