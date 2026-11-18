// Package server wires handlers into the HTTP router.
package server

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/guestly/backend/internal/admin"
	"github.com/guestly/backend/internal/auth"
	"github.com/guestly/backend/internal/config"
	"github.com/guestly/backend/internal/httpx"
	"github.com/guestly/backend/internal/property"
	"github.com/guestly/backend/internal/room"
	"github.com/guestly/backend/internal/secure"
	"github.com/guestly/backend/internal/stay"
	"github.com/guestly/backend/internal/storage"
)

func New(cfg config.Config, pool *pgxpool.Pool, box *secure.Box) http.Handler {
	tokens := auth.NewTokens(cfg.JWTSecret, cfg.AccessTTL)
	store := storage.LocalStore{Root: cfg.UploadDir}
	signer := storage.Signer{Secret: cfg.JWTSecret, BaseURL: cfg.PublicAPIURL + "/files"}

	authH := &auth.Handler{DB: pool, Tokens: tokens, RefreshTTL: cfg.RefreshTTL, SecureCookies: cfg.SecureCookies}
	propH := &property.Handler{DB: pool, Store: store, Signer: signer}
	roomH := &room.Handler{DB: pool}
	stayH := &stay.Handler{DB: pool, Store: store, Signer: signer, Box: box, AppURL: cfg.AppURL}
	adminH := &admin.Handler{DB: pool, Tokens: tokens, Store: store, Signer: signer,
		RefreshTTL: cfg.RefreshTTL, SecureCookies: cfg.SecureCookies, AppURL: cfg.AppURL}

	managers := auth.RequireRole(auth.RoleOwner, auth.RoleManager)
	// Guest data and money: everyone except housekeeping.
	desk := auth.RequireRole(auth.RoleOwner, auth.RoleManager, auth.RoleFrontDesk)
	h := func(fn func(http.ResponseWriter, *http.Request) error) http.Handler { return httpx.Handler(fn) }

	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Logger, middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Client"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })

	r.Route("/api/v1", func(r chi.Router) {
		r.Handle("/files/*", storage.Serve(store, signer))

		// A guest's invoice link. No login: the long random token is the credential.
		r.Method("GET", "/public/invoices/{token}", h(stayH.PublicInvoice))

		// A client's subscription receipt link. Same idea: the token is the credential.
		r.Method("GET", "/public/receipts/{token}", h(adminH.PublicReceipt))

		// ---- Hotel staff ----
		r.Route("/auth", func(r chi.Router) {
			r.Method("POST", "/login", h(authH.Login))
			r.Method("POST", "/register", h(authH.Register))
			r.Method("POST", "/refresh", h(authH.Refresh))
			r.Method("POST", "/logout", h(authH.Logout))
		})
		r.Method("GET", "/invites/{token}", h(authH.GetInvite))
		r.Method("POST", "/invites/{token}/accept", h(authH.AcceptInvite))

		r.Group(func(r chi.Router) {
			r.Use(tokens.Authenticate)
			r.Method("GET", "/me", h(authH.Me))
			r.Method("GET", "/properties", h(propH.List))

			r.Route("/properties/{propertyID}", func(r chi.Router) {
				r.Use(propH.Access)
				r.Method("GET", "/", h(propH.Get))
				r.With(managers).Method("PUT", "/", h(propH.Update))
				r.With(managers).Method("POST", "/logo", h(propH.UploadLogo))
				r.With(managers).Method("DELETE", "/logo", h(propH.DeleteLogo))

				r.Method("GET", "/room-types", h(roomH.ListTypes))
				r.With(managers).Method("POST", "/room-types", h(roomH.CreateType))
				r.With(managers).Method("PUT", "/room-types/{typeID}", h(roomH.UpdateType))
				r.With(managers).Method("DELETE", "/room-types/{typeID}", h(roomH.DeleteType))

				r.Method("GET", "/rooms", h(roomH.List))
				r.With(managers).Method("POST", "/rooms", h(roomH.Create))
				r.With(managers).Method("PUT", "/rooms/{roomID}", h(roomH.Update))
				r.With(managers).Method("DELETE", "/rooms/{roomID}", h(roomH.Delete))
				r.Method("PATCH", "/rooms/{roomID}/status", h(roomH.SetStatus))
				r.With(managers).Method("PUT", "/front-desk", h(propH.UpdateFrontDesk))
				r.With(managers).Method("GET", "/reports", h(stayH.Report))

				r.Group(func(r chi.Router) {
					r.Use(desk)
					r.Method("POST", "/uploads", h(stayH.Upload))
					r.Method("POST", "/guests/scan-aadhaar", h(stayH.ScanAadhaar))
					r.Method("POST", "/guests/parse-aadhaar", h(stayH.ParseAadhaar))
					r.Method("GET", "/guests", h(stayH.SearchGuests))
					r.Method("GET", "/guests/lookup", h(stayH.Lookup))
					r.Method("GET", "/guests/{guestID}", h(stayH.GetGuest))
					r.Method("GET", "/guests/{guestID}/photo", h(stayH.GuestPhoto))
					r.Method("GET", "/guests/{guestID}/documents/{docID}/{side}", h(stayH.DocumentImage))
					r.Method("GET", "/guests/{guestID}/documents/{docID}/number", h(stayH.DocumentNumber))

					r.Method("GET", "/stays", h(stayH.ListStays))
					r.Method("POST", "/stays", h(stayH.CheckIn))
					r.Method("GET", "/stays/{stayID}", h(stayH.GetStay))
					r.Method("PUT", "/stays/{stayID}", h(stayH.UpdateStay))
					r.Method("POST", "/stays/{stayID}/charges", h(stayH.AddCharge))
					r.Method("DELETE", "/stays/{stayID}/charges/{chargeID}", h(stayH.DeleteCharge))
					r.Method("POST", "/stays/{stayID}/payments", h(stayH.AddPayment))
					r.Method("GET", "/stays/{stayID}/checkout", h(stayH.CheckoutPreview))
					r.Method("POST", "/stays/{stayID}/checkout", h(stayH.Checkout))
					r.Method("PUT", "/stays/{stayID}/billing", h(stayH.UpdateBilling))
					r.Method("GET", "/stays/{stayID}/invoice", h(stayH.GetInvoice))
					r.Method("POST", "/stays/{stayID}/invoice", h(stayH.IssueInvoice))
					r.Method("POST", "/stays/{stayID}/invoice/print", h(stayH.PrintInvoice))
					r.With(managers).Method("POST", "/stays/{stayID}/cancel", h(stayH.Cancel))
					r.Method("GET", "/stays/{stayID}/messages/{kind}", h(stayH.PreviewMessage))
					r.Method("POST", "/stays/{stayID}/messages", h(stayH.LogMessage))

					r.Method("GET", "/reservations", h(stayH.ListReservations))
					r.Method("POST", "/reservations", h(stayH.CreateReservation))
					r.Method("GET", "/reservations/availability", h(stayH.Availability))
					r.Method("GET", "/reservations/{reservationID}", h(stayH.GetReservation))
					r.Method("PUT", "/reservations/{reservationID}", h(stayH.UpdateReservation))
					r.Method("POST", "/reservations/{reservationID}/cancel", h(stayH.CancelReservation))
					r.Method("POST", "/reservations/{reservationID}/no-show", h(stayH.NoShowReservation))
					r.Method("GET", "/reservations/{reservationID}/messages/booking", h(stayH.PreviewReservationMessage))
					r.Method("POST", "/reservations/{reservationID}/messages", h(stayH.LogReservationMessage))

					r.Method("GET", "/message-templates", h(stayH.ListTemplates))
					r.With(managers).Method("PUT", "/message-templates/{kind}", h(stayH.SaveTemplate))
					r.With(managers).Method("DELETE", "/message-templates/{kind}", h(stayH.ResetTemplate))
				})
			})
		})

		// ---- Gustlog platform admin ----
		r.Route("/admin", func(r chi.Router) {
			r.Route("/auth", func(r chi.Router) {
				r.Method("POST", "/login", h(adminH.Login))
				r.Method("POST", "/refresh", h(adminH.Refresh))
				r.Method("POST", "/logout", h(adminH.Logout))
			})
			r.Group(func(r chi.Router) {
				r.Use(tokens.AuthenticateAdmin)
				r.Method("GET", "/dashboard", h(adminH.Dashboard))
				r.Method("GET", "/clients", h(adminH.ListClients))
				r.Method("POST", "/clients", h(adminH.CreateClient))
				r.Method("GET", "/clients/{clientID}", h(adminH.GetClient))
				r.Method("PUT", "/clients/{clientID}", h(adminH.UpdateClient))
				r.Method("PATCH", "/clients/{clientID}/status", h(adminH.SetClientStatus))
				r.Method("POST", "/clients/{clientID}/properties", h(adminH.AddProperty))
				r.Method("POST", "/clients/{clientID}/users/{userID}/invite", h(adminH.ResendInvite))
				r.Method("PUT", "/properties/{propertyID}", h(adminH.UpdateProperty))
				r.Method("POST", "/properties/{propertyID}/logo", h(adminH.UploadLogo))
				r.Method("DELETE", "/properties/{propertyID}/logo", h(adminH.DeleteLogo))
				r.Method("PUT", "/properties/{propertyID}/subscription", h(adminH.UpdateSubscription))
				r.Method("POST", "/properties/{propertyID}/payments", h(adminH.RecordPayment))
				r.Method("GET", "/payments", h(adminH.ListPayments))
				r.Method("POST", "/payments/{paymentID}/void", h(adminH.VoidPayment))
				r.Method("GET", "/audit", h(adminH.AuditLog))
			})
		})
	})
	return r
}
