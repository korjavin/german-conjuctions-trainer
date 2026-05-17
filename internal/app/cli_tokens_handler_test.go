package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// callCreateCLIToken posts to /api/auth/cli-tokens through the same
// withAuth(adminOnly(...)) chain that the real route table installs, so the
// test exercises the actual auth wiring rather than just the bare handler.
func callCreateCLIToken(t *testing.T, app *App, body string, userIDInContext string) *httptest.ResponseRecorder {
	t.Helper()
	handler := app.withAuth(app.adminOnly(app.handleCreateCLIToken))
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	var req *http.Request
	if reader != nil {
		req = httptest.NewRequest(http.MethodPost, "/api/auth/cli-tokens", reader)
	} else {
		req = httptest.NewRequest(http.MethodPost, "/api/auth/cli-tokens", nil)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	// We bypass withAuth's cookie/bearer parsing by setting the cookie
	// directly using app.SC, which is how production also creates them.
	if userIDInContext != "" {
		encoded, err := app.SC.Encode(cookieName, userIDInContext)
		if err != nil {
			t.Fatalf("SC.Encode: %v", err)
		}
		req.AddCookie(&http.Cookie{Name: cookieName, Value: encoded})
	}
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

// setupAdminApp builds an authenticated, admin-configured App and returns
// the admin user's ID for cookie minting. Reuses setupAuthTestApp so the
// background-goroutine drain in t.Cleanup applies here too.
func setupAdminApp(t *testing.T) (*App, string) {
	t.Helper()
	app := setupAuthTestApp(t)
	adminGoogleID := "google-admin-cli-tokens"
	app.AdminGoogleID = adminGoogleID
	user, err := app.DB.CreateUser(adminGoogleID)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	return app, user.ID
}

func TestHandleCreateCLIToken_AdminSucceeds(t *testing.T) {
	app, adminID := setupAdminApp(t)
	rr := callCreateCLIToken(t, app, `{"label":"laptop"}`, adminID)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%q", rr.Code, rr.Body.String())
	}

	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	plaintext := resp["token"]
	if !strings.HasPrefix(plaintext, "gct_") || len(plaintext) != 4+43 {
		t.Errorf("unexpected token shape: %q", plaintext)
	}
	if resp["label"] != "laptop" {
		t.Errorf("label = %q, want %q", resp["label"], "laptop")
	}
	if resp["user_id"] != adminID {
		t.Errorf("user_id = %q, want %q", resp["user_id"], adminID)
	}

	// The hash should be persisted and resolvable.
	sum := sha256.Sum256([]byte(plaintext))
	hash := hex.EncodeToString(sum[:])
	tok, err := app.DB.GetCLITokenByHash(hash)
	if err != nil || tok == nil {
		t.Fatalf("expected token row, got tok=%v err=%v", tok, err)
	}
	if tok.UserID != adminID {
		t.Errorf("persisted UserID = %q, want %q", tok.UserID, adminID)
	}
	if tok.Label != "laptop" {
		t.Errorf("persisted Label = %q, want %q", tok.Label, "laptop")
	}
}

func TestHandleCreateCLIToken_DefaultLabel(t *testing.T) {
	app, adminID := setupAdminApp(t)
	// Empty body — handler should accept it and default the label to "cli".
	rr := callCreateCLIToken(t, app, ``, adminID)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%q", rr.Code, rr.Body.String())
	}
	var resp map[string]string
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp["label"] != "cli" {
		t.Errorf("default label = %q, want %q", resp["label"], "cli")
	}
}

func TestHandleCreateCLIToken_NonAdminForbidden(t *testing.T) {
	app := setupAuthTestApp(t)
	app.AdminGoogleID = "google-actual-admin"
	other, _ := app.DB.CreateUser("google-not-admin")
	rr := callCreateCLIToken(t, app, `{"label":"x"}`, other.ID)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%q", rr.Code, rr.Body.String())
	}
}

func TestHandleCreateCLIToken_Unauthenticated(t *testing.T) {
	app := setupAuthTestApp(t)
	app.AdminGoogleID = "google-actual-admin"
	rr := callCreateCLIToken(t, app, `{"label":"x"}`, "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%q", rr.Code, rr.Body.String())
	}
}

func TestHandleCreateCLIToken_WrongMethod(t *testing.T) {
	app, adminID := setupAdminApp(t)
	handler := app.withAuth(app.adminOnly(app.handleCreateCLIToken))
	encoded, _ := app.SC.Encode(cookieName, adminID)
	req := httptest.NewRequest(http.MethodGet, "/api/auth/cli-tokens", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: encoded})
	rr := httptest.NewRecorder()
	handler(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rr.Code)
	}
}

func TestHandleCreateCLIToken_TokensAccumulate(t *testing.T) {
	app, adminID := setupAdminApp(t)
	tokens := map[string]bool{}
	for i := 0; i < 3; i++ {
		rr := callCreateCLIToken(t, app, `{"label":"server"}`, adminID)
		if rr.Code != http.StatusCreated {
			t.Fatalf("call %d: status = %d", i, rr.Code)
		}
		var resp map[string]string
		_ = json.NewDecoder(rr.Body).Decode(&resp)
		if tokens[resp["token"]] {
			t.Fatalf("duplicate token returned across calls: %q", resp["token"])
		}
		tokens[resp["token"]] = true
	}
	rows, err := app.DB.ListCLITokensForUser(adminID)
	if err != nil {
		t.Fatalf("ListCLITokensForUser: %v", err)
	}
	if len(rows) != 3 {
		t.Errorf("got %d persisted tokens, want 3", len(rows))
	}
}
