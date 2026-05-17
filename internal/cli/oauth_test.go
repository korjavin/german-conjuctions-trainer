package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

// fakeOAuthBackend stands in for Google's device + token endpoints AND the
// project's own /api/auth/cli-exchange endpoint. Each test wires up the
// behaviour it wants via the fields below; the handler in newFakeOAuth
// dispatches based on path.
type fakeOAuthBackend struct {
	// device-code endpoint response (RFC 8628 section 3.2)
	deviceResp map[string]any

	// pendingPolls drives the token endpoint: that many "authorization_pending"
	// responses before we return the success body.
	pendingPolls int32

	// tokenResp is the body returned by the success path of the token
	// endpoint; tests set this to {access_token, ...} or to a {"error":
	// "access_denied"} envelope to simulate failure.
	tokenResp       map[string]any
	tokenStatusCode int

	// exchangeResp is the body returned by /api/auth/cli-exchange.
	exchangeResp       map[string]any
	exchangeStatusCode int

	// capture so tests can assert what the server saw.
	mu             sync.Mutex
	googleTokenSeen string
	exchangeLabel   string
}

func newFakeOAuth(t *testing.T, b *fakeOAuthBackend) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/device/code", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("device code: method = %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(b.deviceResp)
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("token: method = %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		if atomic.AddInt32(&b.pendingPolls, -1) >= 0 {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "authorization_pending"})
			return
		}
		code := b.tokenStatusCode
		if code == 0 {
			code = http.StatusOK
		}
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(b.tokenResp)
	})
	mux.HandleFunc("/api/auth/cli-exchange", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("exchange: method = %s", r.Method)
		}
		var body struct {
			GoogleAccessToken string `json:"google_access_token"`
			Label             string `json:"label"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		b.mu.Lock()
		b.googleTokenSeen = body.GoogleAccessToken
		b.exchangeLabel = body.Label
		b.mu.Unlock()
		code := b.exchangeStatusCode
		if code == 0 {
			code = http.StatusCreated
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(b.exchangeResp)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// happyOpts builds a fully-wired loginOptions pointing at the fake server.
// The Interval is 1s — anything lower is rounded to the oauth2 default of
// 5s, anything higher makes "pending then success" tests slow.
func happyOpts(srv *httptest.Server, out io.Writer) loginOptions {
	return loginOptions{
		serverURL:    srv.URL,
		label:        "test",
		clientID:     "fake-client-id",
		clientSecret: "fake-client-secret",
		endpoint: oauth2.Endpoint{
			DeviceAuthURL: srv.URL + "/device/code",
			TokenURL:      srv.URL + "/token",
		},
		httpClient: srv.Client(),
		out:        out,
		now:        func() time.Time { return time.Date(2026, 5, 17, 12, 0, 0, 0, time.UTC) },
	}
}

func TestLoginWithHappyPath(t *testing.T) {
	backend := &fakeOAuthBackend{
		deviceResp: map[string]any{
			"device_code":      "DEV123",
			"user_code":        "XYZW-ABCD",
			"verification_uri": "https://www.google.com/device",
			"interval":         1,
			"expires_in":       900,
		},
		tokenResp: map[string]any{
			"access_token": "ya29.googleAccessToken",
			"token_type":   "Bearer",
			"expires_in":   3600,
		},
		exchangeResp: map[string]any{
			"token":    "gct_serverIssued",
			"token_id": "tok-1",
			"user_id":  "user-42",
		},
	}
	srv := newFakeOAuth(t, backend)
	var prompt bytes.Buffer

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	res, err := loginWith(ctx, happyOpts(srv, &prompt))
	if err != nil {
		t.Fatalf("loginWith: %v", err)
	}
	if res.Token != "gct_serverIssued" {
		t.Errorf("Token = %q, want gct_serverIssued", res.Token)
	}
	if res.UserID != "user-42" {
		t.Errorf("UserID = %q, want user-42", res.UserID)
	}
	if res.Label != "test" {
		t.Errorf("Label = %q, want test", res.Label)
	}
	if backend.googleTokenSeen != "ya29.googleAccessToken" {
		t.Errorf("server saw google token %q", backend.googleTokenSeen)
	}
	if backend.exchangeLabel != "test" {
		t.Errorf("server saw label %q", backend.exchangeLabel)
	}
	out := prompt.String()
	if !strings.Contains(out, "https://www.google.com/device") {
		t.Errorf("prompt missing verification URL: %q", out)
	}
	if !strings.Contains(out, "XYZW-ABCD") {
		t.Errorf("prompt missing user code: %q", out)
	}
}

func TestLoginWithAuthorizationPendingThenSuccess(t *testing.T) {
	backend := &fakeOAuthBackend{
		deviceResp: map[string]any{
			"device_code":      "DEV123",
			"user_code":        "ABCD-EFGH",
			"verification_uri": "https://www.google.com/device",
			"interval":         1,
			"expires_in":       30,
		},
		pendingPolls: 2,
		tokenResp: map[string]any{
			"access_token": "ya29.later",
			"token_type":   "Bearer",
			"expires_in":   3600,
		},
		exchangeResp: map[string]any{
			"token":    "gct_eventual",
			"token_id": "tok-eventual",
			"user_id":  "user-1",
		},
	}
	srv := newFakeOAuth(t, backend)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	res, err := loginWith(ctx, happyOpts(srv, io.Discard))
	if err != nil {
		t.Fatalf("loginWith: %v", err)
	}
	if res.Token != "gct_eventual" {
		t.Errorf("Token = %q, want gct_eventual", res.Token)
	}
	if atomic.LoadInt32(&backend.pendingPolls) >= 2 {
		t.Errorf("expected polls to be consumed; remaining=%d", backend.pendingPolls)
	}
}

func TestLoginWithAccessDeniedReturnsFriendlyError(t *testing.T) {
	backend := &fakeOAuthBackend{
		deviceResp: map[string]any{
			"device_code":      "DEV-deny",
			"user_code":        "AAAA-BBBB",
			"verification_uri": "https://www.google.com/device",
			"interval":         1,
			"expires_in":       30,
		},
		tokenStatusCode: http.StatusBadRequest,
		tokenResp:       map[string]any{"error": "access_denied"},
	}
	srv := newFakeOAuth(t, backend)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := loginWith(ctx, happyOpts(srv, io.Discard))
	if err == nil {
		t.Fatal("expected access_denied error, got nil")
	}
	if !strings.Contains(err.Error(), "denied") {
		t.Errorf("error doesn't mention denial: %v", err)
	}
}

func TestLoginWithExpiredTokenReturnsFriendlyError(t *testing.T) {
	backend := &fakeOAuthBackend{
		deviceResp: map[string]any{
			"device_code":      "DEV-expire",
			"user_code":        "EXPI-RED1",
			"verification_uri": "https://www.google.com/device",
			"interval":         1,
			"expires_in":       30,
		},
		tokenStatusCode: http.StatusBadRequest,
		tokenResp:       map[string]any{"error": "expired_token"},
	}
	srv := newFakeOAuth(t, backend)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := loginWith(ctx, happyOpts(srv, io.Discard))
	if err == nil {
		t.Fatal("expected expired_token error")
	}
	if !strings.Contains(err.Error(), "expired") {
		t.Errorf("error doesn't mention expiration: %v", err)
	}
}

func TestLoginWithCanceledContext(t *testing.T) {
	backend := &fakeOAuthBackend{
		deviceResp: map[string]any{
			"device_code":      "DEV-ctx",
			"user_code":        "CTXC-ANCL",
			"verification_uri": "https://www.google.com/device",
			"interval":         1,
			"expires_in":       30,
		},
		// Never succeed — the test relies on context cancellation to break out.
		pendingPolls: 1 << 20,
		tokenResp:    map[string]any{},
	}
	srv := newFakeOAuth(t, backend)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := loginWith(ctx, happyOpts(srv, io.Discard))
	if err == nil {
		t.Fatal("expected error from canceled context")
	}
	if !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
		t.Errorf("error = %v, want context.DeadlineExceeded/Canceled", err)
	}
}

func TestLoginWithExchangeFailureSurfacesAPIError(t *testing.T) {
	backend := &fakeOAuthBackend{
		deviceResp: map[string]any{
			"device_code":      "DEV-exch",
			"user_code":        "EXCH-FAIL",
			"verification_uri": "https://www.google.com/device",
			"interval":         1,
			"expires_in":       30,
		},
		tokenResp: map[string]any{
			"access_token": "ya29.ok",
			"token_type":   "Bearer",
			"expires_in":   3600,
		},
		exchangeStatusCode: http.StatusUnauthorized,
		exchangeResp:       map[string]any{"error": "INVALID_GOOGLE_TOKEN"},
	}
	srv := newFakeOAuth(t, backend)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := loginWith(ctx, happyOpts(srv, io.Discard))
	if err == nil {
		t.Fatal("expected exchange error")
	}
	if !errors.Is(err, ErrUnauthorized) {
		t.Errorf("error doesn't wrap ErrUnauthorized: %v", err)
	}
}

func TestLoginWithEmptyServerURL(t *testing.T) {
	_, err := loginWith(context.Background(), loginOptions{
		clientID:     "x",
		clientSecret: "y",
	})
	if err == nil {
		t.Fatal("expected error for empty server URL")
	}
	if !strings.Contains(err.Error(), "server URL") {
		t.Errorf("error = %v, want it to mention server URL", err)
	}
}

func TestLoginMissingGoogleClientCredentialsErrors(t *testing.T) {
	// Make sure the package-level globals AND env vars are both empty so
	// Login takes the ErrMissingGoogleClient path. Other tests rely on
	// loginWith and don't go through this function.
	withEnv(t, map[string]string{
		envGoogleClientID:     "",
		envGoogleClientSecret: "",
	})

	prevID, prevSecret := googleClientID, googleClientSecret
	googleClientID, googleClientSecret = "", ""
	t.Cleanup(func() { googleClientID, googleClientSecret = prevID, prevSecret })

	_, err := Login(context.Background(), "https://example.com", "test", io.Discard)
	if !errors.Is(err, ErrMissingGoogleClient) {
		t.Errorf("err = %v, want ErrMissingGoogleClient", err)
	}
}

func TestLoginReadsEnvOverrideForClientID(t *testing.T) {
	// Exercise the env-var path even when ldflags didn't bake credentials.
	// The actual flow stops at the device-code endpoint (we don't run a
	// fake server here), but we verify Login gets past the credential
	// check and into the oauth2 plumbing rather than returning
	// ErrMissingGoogleClient.
	withEnv(t, map[string]string{
		envGoogleClientID:     "env-id",
		envGoogleClientSecret: "env-secret",
	})
	prevID, prevSecret := googleClientID, googleClientSecret
	googleClientID, googleClientSecret = "", ""
	t.Cleanup(func() { googleClientID, googleClientSecret = prevID, prevSecret })

	// Bogus base URL — Login should attempt the device-code request and
	// fail with a network error, *not* with ErrMissingGoogleClient.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := Login(ctx, "http://127.0.0.1:0/server", "label", io.Discard)
	if errors.Is(err, ErrMissingGoogleClient) {
		t.Fatalf("env override ignored: %v", err)
	}
	// The oauth2 library will call the (empty) DeviceAuthURL — confirm we
	// got that far by checking the error mentions the missing URL or a
	// network failure rather than missing-credentials text.
	if err == nil {
		t.Fatal("expected some error from the failing flow")
	}
}
