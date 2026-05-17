package app

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"german-conjunctions-trainer/pkg/storage"

	"github.com/gorilla/securecookie"
)

// setupAuthTestApp builds an App backed by a fresh on-disk SQLite store and
// a deterministic securecookie codec so tests can mint valid session
// cookies through app.SC.Encode.
//
// The cleanup hook drains any background goroutines launched by
// resolveBearer (the async TouchCLIToken update) before closing the
// SQLite handle. Without this, the goroutine can write to the database
// after t.TempDir() removes the WAL/SHM sidecars, producing flaky
// "directory not empty" cleanup errors and "attempt to write a readonly
// database" log lines that bleed into adjacent tests.
func setupAuthTestApp(t *testing.T) *App {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	store, err := storage.NewSQLiteStorage(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStorage: %v", err)
	}
	sc := securecookie.New(securecookie.GenerateRandomKey(64), securecookie.GenerateRandomKey(32))
	app := &App{DB: store, SC: sc}
	t.Cleanup(func() {
		app.WaitBackground()
		if err := store.Close(); err != nil {
			t.Logf("storage close: %v", err)
		}
	})
	return app
}

// issueToken creates a CLI token row for userID and returns the plaintext
// token the caller should put in an Authorization header.
func issueToken(t *testing.T, app *App, userID, label string) (plaintext string, id string) {
	t.Helper()
	plaintext = "gct_" + label + "_" + userID
	sum := sha256.Sum256([]byte(plaintext))
	hash := hex.EncodeToString(sum[:])
	tok, err := app.DB.CreateCLIToken(userID, hash, label)
	if err != nil {
		t.Fatalf("CreateCLIToken: %v", err)
	}
	return plaintext, tok.ID
}

// recordedUserHandler is a tiny next-handler that records the userID
// injected by the middleware so tests can assert on it.
type recordedUserHandler struct {
	calls  int
	userID string
}

func (h *recordedUserHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.calls++
	h.userID = getUserIDFromRequest(r)
	w.WriteHeader(http.StatusOK)
}

func cookieFor(t *testing.T, app *App, userID string) *http.Cookie {
	t.Helper()
	encoded, err := app.SC.Encode(cookieName, userID)
	if err != nil {
		t.Fatalf("SC.Encode: %v", err)
	}
	return &http.Cookie{Name: cookieName, Value: encoded}
}

func TestWithAuth_ValidBearer(t *testing.T) {
	app := setupAuthTestApp(t)
	user, err := app.DB.CreateUser("google-bearer-1")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	token, tokID := issueToken(t, app, user.ID, "laptop")

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	app.withAuth(next.ServeHTTP)(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if next.userID != user.ID {
		t.Errorf("injected userID = %q, want %q", next.userID, user.ID)
	}

	// last_used_at is touched asynchronously; give it a beat.
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		tok, _ := app.DB.GetCLITokenByHash(hashFor(token))
		if tok != nil && tok.LastUsedAt != nil {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	tok, err := app.DB.GetCLITokenByHash(hashFor(token))
	if err != nil || tok == nil {
		t.Fatalf("token lookup: err=%v tok=%v", err, tok)
	}
	if tok.LastUsedAt == nil {
		t.Errorf("expected LastUsedAt to be set for token %s", tokID)
	}
}

func hashFor(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func TestWithAuth_RevokedBearer_Rejected(t *testing.T) {
	app := setupAuthTestApp(t)
	user, _ := app.DB.CreateUser("google-bearer-rev")
	token, id := issueToken(t, app, user.ID, "")
	if err := app.DB.RevokeCLIToken(id, user.ID); err != nil {
		t.Fatalf("RevokeCLIToken: %v", err)
	}

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	app.withAuth(next.ServeHTTP)(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want 401", rr.Code)
	}
	if next.calls != 0 {
		t.Errorf("next handler called %d times, want 0", next.calls)
	}
}

func TestWithAuth_UnknownBearer_Rejected(t *testing.T) {
	app := setupAuthTestApp(t)

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer gct_does_not_exist")
	rr := httptest.NewRecorder()
	app.withAuth(next.ServeHTTP)(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want 401", rr.Code)
	}
	if next.calls != 0 {
		t.Errorf("next handler called, want 0")
	}
}

func TestWithAuth_NoCredentials(t *testing.T) {
	app := setupAuthTestApp(t)

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rr := httptest.NewRecorder()
	app.withAuth(next.ServeHTTP)(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want 401", rr.Code)
	}
}

func TestWithAuth_CookieOnly(t *testing.T) {
	app := setupAuthTestApp(t)
	user, _ := app.DB.CreateUser("google-cookie-only")

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.AddCookie(cookieFor(t, app, user.ID))
	rr := httptest.NewRecorder()
	app.withAuth(next.ServeHTTP)(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if next.userID != user.ID {
		t.Errorf("userID = %q, want %q", next.userID, user.ID)
	}
}

func TestWithAuth_BearerWinsOverCookie(t *testing.T) {
	app := setupAuthTestApp(t)
	bearerUser, _ := app.DB.CreateUser("google-bearer-wins")
	cookieUser, _ := app.DB.CreateUser("google-cookie-loses")
	token, _ := issueToken(t, app, bearerUser.ID, "wins")

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.AddCookie(cookieFor(t, app, cookieUser.ID))
	rr := httptest.NewRecorder()
	app.withAuth(next.ServeHTTP)(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if next.userID != bearerUser.ID {
		t.Errorf("userID = %q, want bearer user %q", next.userID, bearerUser.ID)
	}
}

func TestWithOptionalAuth_ValidBearer(t *testing.T) {
	app := setupAuthTestApp(t)
	user, _ := app.DB.CreateUser("google-opt-bearer")
	token, _ := issueToken(t, app, user.ID, "")

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	app.withOptionalAuth(next.ServeHTTP)(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if next.userID != user.ID {
		t.Errorf("userID = %q, want %q", next.userID, user.ID)
	}
}

func TestWithOptionalAuth_RevokedBearer_Rejected(t *testing.T) {
	// Explicit-but-invalid credentials must be rejected even on
	// optional-auth routes. Silently treating a revoked bearer as guest
	// would let CLI flows like `gct exercises generate` succeed with
	// guest behaviour and never prompt the user to re-login.
	app := setupAuthTestApp(t)
	user, _ := app.DB.CreateUser("google-opt-rev")
	token, id := issueToken(t, app, user.ID, "")
	if err := app.DB.RevokeCLIToken(id, user.ID); err != nil {
		t.Fatalf("RevokeCLIToken: %v", err)
	}

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	app.withOptionalAuth(next.ServeHTTP)(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want 401", rr.Code)
	}
	if next.calls != 0 {
		t.Errorf("next called %d times, want 0", next.calls)
	}
}

func TestWithOptionalAuth_UnknownBearer_Rejected(t *testing.T) {
	app := setupAuthTestApp(t)

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer gct_unknown")
	rr := httptest.NewRecorder()
	app.withOptionalAuth(next.ServeHTTP)(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want 401", rr.Code)
	}
	if next.calls != 0 {
		t.Errorf("next called %d times, want 0", next.calls)
	}
}

func TestWithOptionalAuth_CookieOnly(t *testing.T) {
	app := setupAuthTestApp(t)
	user, _ := app.DB.CreateUser("google-opt-cookie")

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.AddCookie(cookieFor(t, app, user.ID))
	rr := httptest.NewRecorder()
	app.withOptionalAuth(next.ServeHTTP)(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if next.userID != user.ID {
		t.Errorf("userID = %q, want %q", next.userID, user.ID)
	}
}

func TestWithOptionalAuth_NoCredentials_Guest(t *testing.T) {
	app := setupAuthTestApp(t)

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rr := httptest.NewRecorder()
	app.withOptionalAuth(next.ServeHTTP)(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if next.userID != "" {
		t.Errorf("userID should be empty (guest), got %q", next.userID)
	}
}

func TestAdminOnly_BearerForAdminUserPasses(t *testing.T) {
	app := setupAuthTestApp(t)
	admin, err := app.DB.CreateUser("google-admin-bearer")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	app.AdminGoogleID = "google-admin-bearer"
	token, _ := issueToken(t, app, admin.ID, "admin")

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	app.withAuth(app.adminOnly(next.ServeHTTP))(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%q)", rr.Code, rr.Body.String())
	}
	if next.calls != 1 {
		t.Errorf("next called %d times, want 1", next.calls)
	}
}

func TestAdminOnly_BearerForNonAdminUserRejected(t *testing.T) {
	app := setupAuthTestApp(t)
	mortal, _ := app.DB.CreateUser("google-non-admin")
	app.AdminGoogleID = "google-someone-else"
	token, _ := issueToken(t, app, mortal.ID, "")

	next := &recordedUserHandler{}
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	app.withAuth(app.adminOnly(next.ServeHTTP))(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want 403", rr.Code)
	}
	if next.calls != 0 {
		t.Errorf("next called %d times, want 0", next.calls)
	}
}

func TestResolveBearer_NoHeader(t *testing.T) {
	app := setupAuthTestApp(t)
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	if uid, res := app.resolveBearer(req); res != bearerAbsent || uid != "" {
		t.Errorf("got (%q, %d), want ('', bearerAbsent)", uid, res)
	}
}

func TestResolveBearer_EmptyToken(t *testing.T) {
	app := setupAuthTestApp(t)
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer   ")
	if uid, res := app.resolveBearer(req); res != bearerInvalid || uid != "" {
		t.Errorf("got (%q, %d), want ('', bearerInvalid)", uid, res)
	}
}
