package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"google.golang.org/api/googleapi"
	oauth2v2 "google.golang.org/api/oauth2/v2"
)

// GoogleUserInfo holds the fields we use from Google's userinfo response.
type GoogleUserInfo struct {
	ID    string
	Email string
}

// ErrInvalidGoogleToken is returned by UserInfoFetcher implementations when
// Google rejected the supplied access token as unauthorized (HTTP 401). The
// CLI-exchange handler maps this to a 401 response so the caller knows to
// re-run the device flow rather than treat it as a transient failure.
var ErrInvalidGoogleToken = errors.New("invalid Google access token")

// ErrUntrustedGoogleClient is returned when the Google access token is
// otherwise valid but was issued to an OAuth client the server does not
// trust (audience mismatch). Without this check, a token minted for any
// third-party Google OAuth client could be replayed against our
// cli-exchange endpoint to mint a long-lived app bearer for the same
// Google account — see the audience verification in googleUserInfoFetcher.
var ErrUntrustedGoogleClient = errors.New("Google access token issued to an untrusted OAuth client")

// UserInfoFetcher resolves a Google access token to a Google user record
// after verifying the token's audience matches expectedAudience. Stored as
// a field on App so tests can inject a fake without touching the network.
// The real implementation uses google.golang.org/api/oauth2/v2, which has
// a hardcoded userinfo URL — that hardcoding is what motivates this
// interface seam.
type UserInfoFetcher interface {
	Fetch(ctx context.Context, accessToken, expectedAudience string) (*GoogleUserInfo, error)
}

type googleUserInfoFetcher struct{}

func (googleUserInfoFetcher) Fetch(ctx context.Context, accessToken, expectedAudience string) (*GoogleUserInfo, error) {
	client := oauth2.NewClient(ctx, oauth2.StaticTokenSource(&oauth2.Token{AccessToken: accessToken}))
	svc, err := oauth2v2.New(client)
	if err != nil {
		return nil, err
	}

	tokInfo, err := svc.Tokeninfo().AccessToken(accessToken).Context(ctx).Do()
	if err != nil {
		var apiErr *googleapi.Error
		if errors.As(err, &apiErr) && (apiErr.Code == http.StatusUnauthorized || apiErr.Code == http.StatusBadRequest) {
			return nil, ErrInvalidGoogleToken
		}
		return nil, err
	}
	if tokInfo.Audience != expectedAudience && tokInfo.IssuedTo != expectedAudience {
		return nil, ErrUntrustedGoogleClient
	}

	info, err := svc.Userinfo.Get().Context(ctx).Do()
	if err != nil {
		var apiErr *googleapi.Error
		if errors.As(err, &apiErr) && apiErr.Code == http.StatusUnauthorized {
			return nil, ErrInvalidGoogleToken
		}
		return nil, err
	}
	return &GoogleUserInfo{ID: info.Id, Email: info.Email}, nil
}

func (a *App) handleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if a.OAuthConfig == nil {
		http.Error(w, "Google login is not configured", http.StatusInternalServerError)
		return
	}
	url := a.OAuthConfig.AuthCodeURL(a.OAuthState)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

func (a *App) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	if a.OAuthConfig == nil {
		http.Error(w, "Google login is not configured", http.StatusInternalServerError)
		return
	}

	state := r.FormValue("state")
	if state != a.OAuthState {
		log.Printf("Invalid oauth state, expected '%s', got '%s'\n", a.OAuthState, state)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	code := r.FormValue("code")
	token, err := a.OAuthConfig.Exchange(context.Background(), code)
	if err != nil {
		log.Printf("oauthConf.Exchange() failed with '%s'\n", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	oauth2Client := oauth2.NewClient(context.Background(), oauth2.StaticTokenSource(token))
	oauth2Service, err := oauth2v2.New(oauth2Client)
	if err != nil {
		log.Printf("Unable to create oauth2 service: %v", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	userinfo, err := oauth2Service.Userinfo.Get().Do()
	if err != nil {
		log.Printf("Unable to get user info: %v", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	user, err := a.DB.GetUserByGoogleID(userinfo.Id)
	if err != nil {
		log.Printf("Unable to get user by google ID: %v", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}
	if user == nil {
		user, err = a.DB.CreateUser(userinfo.Id)
		if err != nil {
			log.Printf("Unable to create user: %v", err)
			http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
			return
		}
	}

	encoded, err := a.SC.Encode(cookieName, user.ID)
	if err != nil {
		log.Printf("Failed to encode cookie: %v", err)
		http.Error(w, "Failed to set session cookie", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    encoded,
		HttpOnly: true,
		Secure:   r.URL.Scheme == "https",
		Path:     "/",
		Expires:  time.Now().Add(30 * 24 * time.Hour),
	})

	http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
}

// handleAuthStatus reports whether the request is authenticated. It is
// wrapped in withOptionalAuth so it transparently honours both the
// user-session cookie and the CLI bearer token; the actual user lookup is
// done by the middleware, leaving this handler to just format the response.
func (a *App) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	userID := getUserIDFromRequest(r)
	if userID == "" {
		_ = json.NewEncoder(w).Encode(map[string]any{"logged_in": false})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"logged_in": true, "user_id": userID})
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		HttpOnly: true,
		Path:     "/",
		Expires:  time.Unix(0, 0),
	})
	http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
}

// handleCLIExchange accepts a Google access token (obtained by the CLI via
// the OAuth device-authorization grant), resolves it to a Google user via
// the userinfo endpoint, finds-or-creates the corresponding local user, and
// issues a long-lived bearer token that the CLI persists locally. The
// plaintext token is returned once in the response; the server stores only
// its SHA-256 hash.
func (a *App) handleCLIExchange(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed", "", false)
		return
	}

	var req struct {
		GoogleAccessToken string `json:"google_access_token"`
		Label             string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST_BODY", "Invalid request body", err.Error(), false)
		return
	}
	if strings.TrimSpace(req.GoogleAccessToken) == "" {
		writeJSONError(w, http.StatusBadRequest, "MISSING_GOOGLE_TOKEN", "google_access_token is required", "", false)
		return
	}
	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = "cli"
	}

	if strings.TrimSpace(a.CLIGoogleClientID) == "" {
		log.Printf("[CLI-EXCHANGE] refusing exchange: CLIGoogleClientID is not configured")
		writeJSONError(w, http.StatusServiceUnavailable, "CLI_LOGIN_NOT_CONFIGURED", "CLI login is not configured on this server", "", false)
		return
	}

	fetcher := a.UserInfo
	if fetcher == nil {
		fetcher = googleUserInfoFetcher{}
	}

	info, err := fetcher.Fetch(r.Context(), req.GoogleAccessToken, a.CLIGoogleClientID)
	if err != nil {
		if errors.Is(err, ErrInvalidGoogleToken) {
			writeJSONError(w, http.StatusUnauthorized, "INVALID_GOOGLE_TOKEN", "Google access token is invalid", err.Error(), false)
			return
		}
		if errors.Is(err, ErrUntrustedGoogleClient) {
			writeJSONError(w, http.StatusUnauthorized, "UNTRUSTED_GOOGLE_CLIENT", "Google access token was issued to an untrusted OAuth client", err.Error(), false)
			return
		}
		log.Printf("[CLI-EXCHANGE] userinfo fetch failed: %v", err)
		writeJSONError(w, http.StatusBadGateway, "USERINFO_FETCH_FAILED", "Failed to fetch user info from Google", err.Error(), false)
		return
	}
	if info == nil || info.ID == "" {
		writeJSONError(w, http.StatusBadGateway, "USERINFO_EMPTY", "Google did not return a user ID", "", false)
		return
	}

	user, err := a.DB.GetUserByGoogleID(info.ID)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "USER_LOOKUP_FAILED", "Failed to look up user", err.Error(), false)
		return
	}
	if user == nil {
		user, err = a.DB.CreateUser(info.ID)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "USER_CREATE_FAILED", "Failed to create user", err.Error(), false)
			return
		}
	}

	plaintext, tokenID, err := a.mintCLIToken(user.ID, label)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "TOKEN_PERSIST_FAILED", "Failed to persist token", err.Error(), false)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"token":    plaintext,
		"token_id": tokenID,
		"user_id":  user.ID,
	})
}

// mintCLIToken generates a fresh "gct_…" bearer token for the given user,
// persists its SHA-256 hash under the supplied label, and returns the
// plaintext token plus the row ID. Shared between handleCLIExchange (Google
// OAuth path) and handleCreateCLIToken (cookie/admin path) so the token
// format, hash algorithm, and storage call live in one place.
func (a *App) mintCLIToken(userID, label string) (plaintext, tokenID string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	plaintext = "gct_" + base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(plaintext))
	hash := hex.EncodeToString(sum[:])

	tok, err := a.DB.CreateCLIToken(userID, hash, label)
	if err != nil {
		return "", "", err
	}
	return plaintext, tok.ID, nil
}

// handleCreateCLIToken mints a CLI bearer token for the authenticated user
// using their existing web session. This is the simpler alternative to
// handleCLIExchange: instead of requiring the CLI to complete a Google
// device-authorization flow (which now forces operators to register a
// "TVs and Limited Input devices" OAuth client in GCP), the admin logs into
// the web UI, hits the CLI section, and copy-pastes a token. Wrapped by
// adminOnly in the route table so only configured admins can mint tokens.
func (a *App) handleCreateCLIToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed", "", false)
		return
	}

	userID := getUserIDFromRequest(r)
	if userID == "" {
		// Defensive — adminOnly already required auth, but this keeps the
		// handler safe to wire under different middleware later.
		writeJSONError(w, http.StatusUnauthorized, "NOT_AUTHENTICATED", "You must be logged in to mint a CLI token", "", false)
		return
	}

	var req struct {
		Label string `json:"label"`
	}
	// Body is optional — empty/no body is treated as label="cli".
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST_BODY", "Invalid request body", err.Error(), false)
			return
		}
	}
	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = "cli"
	}

	plaintext, tokenID, err := a.mintCLIToken(userID, label)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "TOKEN_PERSIST_FAILED", "Failed to persist token", err.Error(), false)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"token":    plaintext,
		"token_id": tokenID,
		"user_id":  userID,
		"label":    label,
	})
}

func (a *App) handleIsAdmin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	isAdmin := false
	if a.AdminGoogleID != "" {
		userID := getUserIDFromRequest(r)
		if userID != "" {
			user, err := a.DB.GetUserByID(userID)
			if err == nil && user != nil && user.GoogleID == a.AdminGoogleID {
				isAdmin = true
			}
		}
	}

	json.NewEncoder(w).Encode(map[string]bool{"is_admin": isAdmin})
}
