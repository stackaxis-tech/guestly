// Package httpx has small JSON request/response helpers shared by handlers.
package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

// Error is an API error with an HTTP status and a stable machine-readable code.
type Error struct {
	Status  int               `json:"-"`
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func (e *Error) Error() string { return e.Message }

func BadRequest(msg string) *Error   { return &Error{Status: 400, Code: "bad_request", Message: msg} }
func Unauthorized(msg string) *Error { return &Error{Status: 401, Code: "unauthorized", Message: msg} }
func Forbidden(msg string) *Error    { return &Error{Status: 403, Code: "forbidden", Message: msg} }
func NotFound(msg string) *Error     { return &Error{Status: 404, Code: "not_found", Message: msg} }
func Conflict(msg string) *Error     { return &Error{Status: 409, Code: "conflict", Message: msg} }

// Invalid returns a 422 with per-field messages so forms can show them inline.
func Invalid(fields map[string]string) *Error {
	return &Error{Status: 422, Code: "validation_failed", Message: "Some fields need attention.", Fields: fields}
}

// Handler is an http handler that can return an error.
type Handler func(w http.ResponseWriter, r *http.Request) error

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h(w, r); err != nil {
		WriteError(w, r, err)
	}
}

func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	var apiErr *Error
	if errors.As(err, &apiErr) {
		JSON(w, apiErr.Status, apiErr)
		return
	}
	slog.Error("unhandled error", "method", r.Method, "path", r.URL.Path, "err", err)
	JSON(w, 500, &Error{Code: "internal", Message: "Something went wrong on our side."})
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

// Decode reads a JSON body into dst, rejecting unknown fields.
func Decode(r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return BadRequest("Invalid request body: " + err.Error())
	}
	return nil
}
