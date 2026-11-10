package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPresentedRefreshToken(t *testing.T) {
	body := `{"refreshToken":"from-body"}`
	cookie := &http.Cookie{Name: refreshCookie, Value: "from-cookie"}

	r := httptest.NewRequest("POST", "/", strings.NewReader(body))
	r.AddCookie(cookie)
	if got := presentedRefreshToken(r); got != "from-cookie" {
		t.Errorf("browser: got %q, want the cookie", got)
	}

	r = httptest.NewRequest("POST", "/", strings.NewReader(body))
	if got := presentedRefreshToken(r); got != "" {
		t.Errorf("browser must not authenticate with a body token, got %q", got)
	}

	r = httptest.NewRequest("POST", "/", strings.NewReader(body))
	r.Header.Set("X-Client", "mobile")
	if got := presentedRefreshToken(r); got != "from-body" {
		t.Errorf("mobile: got %q, want the body token", got)
	}

	r = httptest.NewRequest("POST", "/", strings.NewReader("not json"))
	r.Header.Set("X-Client", "mobile")
	if got := presentedRefreshToken(r); got != "" {
		t.Errorf("malformed mobile body: got %q", got)
	}
}
