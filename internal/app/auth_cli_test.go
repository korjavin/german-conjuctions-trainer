package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"german-conjunctions-trainer/pkg/storage"
)

// fakeUserInfoFetcher returns a canned response or error from Fetch. Tests
// supply this via the App.UserInfo seam to avoid hitting Google.
type fakeUserInfoFetcher struct {
	info        *GoogleUserInfo
	err         error
	lastToken   string
	calledTimes int
}

func (f *fakeUserInfoFetcher) Fetch(ctx context.Context, accessToken string) (*GoogleUserInfo, error) {
	f.calledTimes++
	f.lastToken = accessToken
	if f.err != nil {
		return nil, f.err
	}
	return f.info, nil
}

func setupCLIExchangeApp(t *testing.T, fetcher UserInfoFetcher) *App {
	t.Helper()
	app := setupTestApp(t)
	app.UserInfo = fetcher
	return app
}

func postCLIExchange(t *testing.T, app *App, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/cli-exchange", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	app.handleCLIExchange(rr, req)
	return rr
}

func decodeExchangeResponse(t *testing.T, rr *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v (body=%q)", err, rr.Body.String())
	}
	return resp
}

func TestHandleCLIExchange_NewUser(t *testing.T) {
	fetcher := &fakeUserInfoFetcher{info: &GoogleUserInfo{ID: "google-new-1", Email: "new@example.com"}}
	app := setupCLIExchangeApp(t, fetcher)

	rr := postCLIExchange(t, app, `{"google_access_token":"ya29.fake","label":"laptop"}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body=%q)", rr.Code, rr.Body.String())
	}

	resp := decodeExchangeResponse(t, rr)
	plaintext := resp["token"]
	if !strings.HasPrefix(plaintext, "gct_") {
		t.Errorf("expected token prefix gct_, got %q", plaintext)
	}
	// 32 bytes -> 43 chars base64url-no-padding, plus "gct_" prefix.
	if len(plaintext) != 4+43 {
		t.Errorf("unexpected token length %d for %q", len(plaintext), plaintext)
	}
	// Base64 body must decode to exactly 32 bytes.
	body, err := base64.RawURLEncoding.DecodeString(plaintext[4:])
	if err != nil {
		t.Errorf("token body is not valid base64url: %v", err)
	} else if len(body) != 32 {
		t.Errorf("token body decoded to %d bytes, want 32", len(body))
	}

	if resp["user_id"] == "" || resp["token_id"] == "" {
		t.Errorf("expected user_id and token_id in response, got %+v", resp)
	}
	if fetcher.lastToken != "ya29.fake" {
		t.Errorf("fetcher saw %q, want %q", fetcher.lastToken, "ya29.fake")
	}

	// User should have been created with the Google ID we returned.
	user, err := app.DB.GetUserByGoogleID("google-new-1")
	if err != nil || user == nil {
		t.Fatalf("expected user to be created, got user=%v err=%v", user, err)
	}
	if user.ID != resp["user_id"] {
		t.Errorf("response user_id %q does not match stored user.ID %q", resp["user_id"], user.ID)
	}

	// The persisted hash must equal SHA-256(plaintext) so that bearer-token
	// middleware (added in a later task) can look it up.
	sum := sha256.Sum256([]byte(plaintext))
	wantHash := hex.EncodeToString(sum[:])
	stored, err := app.DB.GetCLITokenByHash(wantHash)
	if err != nil {
		t.Fatalf("GetCLITokenByHash error: %v", err)
	}
	if stored == nil {
		t.Fatal("expected stored token row, got nil")
	}
	if stored.ID != resp["token_id"] {
		t.Errorf("stored token id %q != response token_id %q", stored.ID, resp["token_id"])
	}
	if stored.UserID != user.ID {
		t.Errorf("stored token user_id %q != %q", stored.UserID, user.ID)
	}
	if stored.Label != "laptop" {
		t.Errorf("stored label %q, want %q", stored.Label, "laptop")
	}
}

func TestHandleCLIExchange_ReusesExistingUser(t *testing.T) {
	fetcher := &fakeUserInfoFetcher{info: &GoogleUserInfo{ID: "google-existing", Email: "x@example.com"}}
	app := setupCLIExchangeApp(t, fetcher)

	preexisting, err := app.DB.CreateUser("google-existing")
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}

	rr := postCLIExchange(t, app, `{"google_access_token":"tok"}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body=%q)", rr.Code, rr.Body.String())
	}
	resp := decodeExchangeResponse(t, rr)
	if resp["user_id"] != preexisting.ID {
		t.Errorf("expected reused user id %q, got %q", preexisting.ID, resp["user_id"])
	}
}

func TestHandleCLIExchange_DefaultLabel(t *testing.T) {
	fetcher := &fakeUserInfoFetcher{info: &GoogleUserInfo{ID: "google-default-label"}}
	app := setupCLIExchangeApp(t, fetcher)

	// Body without "label" key — handler should default to "cli".
	rr := postCLIExchange(t, app, `{"google_access_token":"tok"}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", rr.Code)
	}
	resp := decodeExchangeResponse(t, rr)

	sum := sha256.Sum256([]byte(resp["token"]))
	stored, err := app.DB.GetCLITokenByHash(hex.EncodeToString(sum[:]))
	if err != nil || stored == nil {
		t.Fatalf("stored token lookup failed: %v stored=%v", err, stored)
	}
	if stored.Label != "cli" {
		t.Errorf("default label = %q, want %q", stored.Label, "cli")
	}
}

func TestHandleCLIExchange_InvalidGoogleToken(t *testing.T) {
	fetcher := &fakeUserInfoFetcher{err: ErrInvalidGoogleToken}
	app := setupCLIExchangeApp(t, fetcher)

	rr := postCLIExchange(t, app, `{"google_access_token":"bad"}`)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid Google token, got %d (body=%q)", rr.Code, rr.Body.String())
	}
}

func TestHandleCLIExchange_UserInfoFetchFailure(t *testing.T) {
	fetcher := &fakeUserInfoFetcher{err: errors.New("network down")}
	app := setupCLIExchangeApp(t, fetcher)

	rr := postCLIExchange(t, app, `{"google_access_token":"tok"}`)
	if rr.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 for fetch failure, got %d (body=%q)", rr.Code, rr.Body.String())
	}
}

func TestHandleCLIExchange_MissingGoogleToken(t *testing.T) {
	fetcher := &fakeUserInfoFetcher{info: &GoogleUserInfo{ID: "x"}}
	app := setupCLIExchangeApp(t, fetcher)

	rr := postCLIExchange(t, app, `{"label":"laptop"}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing token, got %d", rr.Code)
	}
	if fetcher.calledTimes != 0 {
		t.Errorf("fetcher should not be called when token is missing, got %d calls", fetcher.calledTimes)
	}
}

func TestHandleCLIExchange_BadBody(t *testing.T) {
	fetcher := &fakeUserInfoFetcher{info: &GoogleUserInfo{ID: "x"}}
	app := setupCLIExchangeApp(t, fetcher)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/cli-exchange", bytes.NewBufferString("not json"))
	rr := httptest.NewRecorder()
	app.handleCLIExchange(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed body, got %d (body=%q)", rr.Code, rr.Body.String())
	}
}

func TestHandleCLIExchange_MethodNotAllowed(t *testing.T) {
	app := setupCLIExchangeApp(t, &fakeUserInfoFetcher{info: &GoogleUserInfo{ID: "x"}})

	req := httptest.NewRequest(http.MethodGet, "/api/auth/cli-exchange", nil)
	rr := httptest.NewRecorder()
	app.handleCLIExchange(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for GET, got %d", rr.Code)
	}
}

func TestHandleCLIExchange_EmptyUserInfo(t *testing.T) {
	// Google returned a 200 with an empty ID — surface as 502 so the CLI
	// retries rather than silently logging in as the empty-string user.
	fetcher := &fakeUserInfoFetcher{info: &GoogleUserInfo{ID: ""}}
	app := setupCLIExchangeApp(t, fetcher)

	rr := postCLIExchange(t, app, `{"google_access_token":"tok"}`)
	if rr.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 for empty userinfo, got %d (body=%q)", rr.Code, rr.Body.String())
	}
}

func TestHandleCLIExchange_DefaultFetcherFallback(t *testing.T) {
	// If UserInfo is nil (e.g. App created via struct literal in some other
	// test), the handler must not panic. We trigger the missing-token path
	// before the fetcher is consulted so this test stays hermetic.
	app := setupTestApp(t)
	app.UserInfo = nil

	rr := postCLIExchange(t, app, `{"label":"laptop"}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for nil fetcher + missing token, got %d", rr.Code)
	}
}

// Compile-time guard that *SQLiteStorage satisfies the subset of Storage
// used by the handler. The interface is large enough that breaking changes
// would otherwise only surface at runtime.
var _ storage.Storage = (*storage.SQLiteStorage)(nil)
