package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

func TestSessionCookieAttributes(t *testing.T) {
	for _, tc := range []struct {
		redirect string
		secure   bool
	}{
		{"https://gct.example.com/auth/google/callback", true},
		{"http://localhost:8080/auth/google/callback", false},
	} {
		a := &App{OAuthConfig: &oauth2.Config{RedirectURL: tc.redirect}}

		login := a.sessionCookie("v", time.Now().Add(time.Hour))
		if login.Secure != tc.secure || login.SameSite != http.SameSiteLaxMode || !login.HttpOnly || login.Path != "/" {
			t.Errorf("%s: login cookie %+v", tc.redirect, login)
		}

		rec := httptest.NewRecorder()
		a.handleLogout(rec, httptest.NewRequest(http.MethodGet, "/auth/logout", nil))
		res := rec.Result()
		cookies := res.Cookies()
		if len(cookies) != 1 {
			t.Fatalf("%s: want 1 logout cookie, got %d", tc.redirect, len(cookies))
		}
		out := cookies[0]
		if out.Name != cookieName || out.Secure != tc.secure || out.SameSite != http.SameSiteLaxMode || out.Path != "/" || !out.HttpOnly {
			t.Errorf("%s: logout cookie %+v", tc.redirect, out)
		}
		if out.MaxAge >= 0 || !out.Expires.Before(time.Now()) {
			t.Errorf("%s: logout cookie not expired: %+v", tc.redirect, out)
		}
		if raw := res.Header.Get("Set-Cookie"); tc.secure != strings.Contains(raw, "Secure") {
			t.Errorf("%s: Set-Cookie %q", tc.redirect, raw)
		}
	}
}

func TestNewSecureCookieKeys(t *testing.T) {
	hash64, hash32, block := strings.Repeat("h", 64), strings.Repeat("h", 32), strings.Repeat("b", 32)
	for _, tc := range []struct {
		name          string
		login         bool
		hash, block   string
		wantErrSubstr string
	}{
		{"login without keys", true, "", "", "openssl rand"},
		{"login missing block", true, hash64, "", "required when Google login"},
		{"short hash key", true, strings.Repeat("h", 31), block, "COOKIE_HASH_KEY must be at least 32 bytes"},
		{"bad block key", false, hash64, "short", "COOKIE_BLOCK_KEY must be 32 bytes"},
		{"no login, no keys", false, "", "", ""},
		{"64-byte hash", true, hash64, block, ""},
		{"32-byte hash", true, hash32, block, ""},
		{"44-byte hash", true, strings.Repeat("h", 44), block, ""},
	} {
		sc, err := NewSecureCookie(tc.login, tc.hash, tc.block)
		if tc.wantErrSubstr == "" {
			if err != nil || sc == nil {
				t.Errorf("%s: want ok, got %v", tc.name, err)
			}
			continue
		}
		if err == nil || !strings.Contains(err.Error(), tc.wantErrSubstr) {
			t.Errorf("%s: want error containing %q, got %v", tc.name, tc.wantErrSubstr, err)
		}
	}
}
