package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/guestly/backend/internal/config"
	"github.com/guestly/backend/internal/db"
	"github.com/guestly/backend/internal/secure"
	"github.com/guestly/backend/internal/server"
	"github.com/guestly/backend/internal/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(pool); err != nil {
		return err
	}

	box, err := secure.New(cfg.DataKey, !cfg.Production)
	if err != nil {
		return err
	}
	if !cfg.Production && cfg.DataKey == "" {
		slog.Warn("DATA_KEY not set: using the development key for guest ID encryption")
	}
	store := storage.LocalStore{Root: cfg.UploadDir}
	go cleanupStagedUploads(ctx, pool, store)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.New(cfg, pool, box),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	slog.Info("guestly api listening", "addr", cfg.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// cleanupStagedUploads deletes guest photos and ID images that were uploaded
// during a check-in that was never completed. Runs hourly.
func cleanupStagedUploads(ctx context.Context, pool *pgxpool.Pool, store storage.Store) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		rows, err := pool.Query(ctx, `DELETE FROM staged_uploads WHERE attached_at IS NULL AND created_at < now() - interval '24 hours' RETURNING object_key`)
		if err == nil {
			n := 0
			for rows.Next() {
				var key string
				if rows.Scan(&key) == nil {
					_ = store.Delete(ctx, key)
					n++
				}
			}
			rows.Close()
			if n > 0 {
				slog.Info("removed abandoned check-in uploads", "count", n)
			}
		} else if ctx.Err() == nil {
			slog.Error("staged upload cleanup failed", "err", err)
		}
		// Attached rows are only bookkeeping; drop them after a week.
		_, _ = pool.Exec(ctx, `DELETE FROM staged_uploads WHERE attached_at < now() - interval '7 days'`)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
