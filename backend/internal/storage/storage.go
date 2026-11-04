// Package storage stores uploaded files (logos now, guest ID images later).
// Files are served only through short-lived signed URLs.
package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/guestly/backend/internal/httpx"
)

// Store is implemented by LocalStore (dev) and, later, an S3/R2 store (prod).
type Store interface {
	Put(ctx context.Context, key string, r io.Reader, contentType string) error
	Open(ctx context.Context, key string) (io.ReadCloser, string, error)
	Delete(ctx context.Context, key string) error
}

var ErrNotFound = errors.New("file not found")

var keyRe = regexp.MustCompile(`^[a-z]+/[a-f0-9]{32}\.(png|jpg|webp|enc)$`)

// NewKey returns a random, unguessable object key like "logos/3f9c…e1.png".
func NewKey(prefix, ext string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return prefix + "/" + hex.EncodeToString(b) + "." + ext
}

// LocalStore keeps files on disk under Root.
type LocalStore struct{ Root string }

func (s LocalStore) path(key string) (string, error) {
	if !keyRe.MatchString(key) {
		return "", ErrNotFound
	}
	return filepath.Join(s.Root, filepath.FromSlash(key)), nil
}

func (s LocalStore) Put(_ context.Context, key string, r io.Reader, _ string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(p), ".upload-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), p)
}

func (s LocalStore) Open(_ context.Context, key string) (io.ReadCloser, string, error) {
	p, err := s.path(key)
	if err != nil {
		return nil, "", err
	}
	f, err := os.Open(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	return f, contentTypeFor(key), nil
}

func (s LocalStore) Delete(_ context.Context, key string) error {
	p, err := s.path(key)
	if err != nil {
		return nil
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func contentTypeFor(key string) string {
	switch filepath.Ext(key) {
	case ".png":
		return "image/png"
	case ".jpg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	}
	return "application/octet-stream"
}

// Signer issues and verifies signed file URLs.
type Signer struct {
	Secret  []byte
	BaseURL string // e.g. http://localhost:8080/api/v1/files
}

func (s Signer) mac(key string, exp int64) string {
	m := hmac.New(sha256.New, s.Secret)
	fmt.Fprintf(m, "%s|%d", key, exp)
	return hex.EncodeToString(m.Sum(nil))
}

// URL returns a signed URL valid for ttl. Expiry is rounded up to the hour so
// URLs stay stable (and cacheable) across API responses within that hour.
func (s Signer) URL(key string, ttl time.Duration) string {
	if key == "" {
		return ""
	}
	exp := time.Now().Add(ttl).Truncate(time.Hour).Add(time.Hour).Unix()
	return fmt.Sprintf("%s/%s?exp=%d&sig=%s", s.BaseURL, key, exp, s.mac(key, exp))
}

func (s Signer) Verify(key string, q url.Values) bool {
	exp, err := strconv.ParseInt(q.Get("exp"), 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	return hmac.Equal([]byte(q.Get("sig")), []byte(s.mac(key, exp)))
}

// Serve handles GET /files/* with signature checks.
func Serve(store Store, signer Signer) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.URL.Path, "/")
		if i := strings.Index(key, "files/"); i >= 0 {
			key = key[i+len("files/"):]
		}
		if !signer.Verify(key, r.URL.Query()) {
			httpx.WriteError(w, r, httpx.NotFound("File not found or link expired."))
			return
		}
		f, ct, err := store.Open(r.Context(), key)
		if err != nil {
			httpx.WriteError(w, r, httpx.NotFound("File not found."))
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "private, max-age=3600")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = io.Copy(w, f)
	})
}

const MaxImageBytes = 1 << 20 // 1 MB

// ReadImage reads a multipart image field, checks size and sniffs the real type.
// SVG is rejected: it can carry scripts and we have no sanitizer yet.
func ReadImage(r *http.Request, field string) (data []byte, ext string, err error) {
	return ReadImageMax(r, field, MaxImageBytes)
}

// ReadImageMax is ReadImage with a custom size limit (ID photos are larger than logos).
func ReadImageMax(r *http.Request, field string, max int64) (data []byte, ext string, err error) {
	limitMsg := fmt.Sprintf("Choose an image under %d MB.", max>>20)
	r.Body = http.MaxBytesReader(nil, r.Body, max+64<<10)
	if err := r.ParseMultipartForm(max + 64<<10); err != nil {
		return nil, "", httpx.Invalid(map[string]string{field: limitMsg})
	}
	f, _, err := r.FormFile(field)
	if err != nil {
		return nil, "", httpx.Invalid(map[string]string{field: "Choose an image to upload."})
	}
	defer f.Close()
	var buf bytes.Buffer
	n, err := io.Copy(&buf, io.LimitReader(f, max+1))
	if err != nil {
		return nil, "", err
	}
	if n > max {
		return nil, "", httpx.Invalid(map[string]string{field: limitMsg})
	}
	switch http.DetectContentType(buf.Bytes()) {
	case "image/png":
		ext = "png"
	case "image/jpeg":
		ext = "jpg"
	case "image/webp":
		ext = "webp"
	default:
		return nil, "", httpx.Invalid(map[string]string{field: "Use a PNG, JPG, or WebP image."})
	}
	return buf.Bytes(), ext, nil
}
