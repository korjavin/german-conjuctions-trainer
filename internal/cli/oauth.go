package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// googleClientID / googleClientSecret are populated at build time via
// -ldflags "-X 'german-conjunctions-trainer/internal/cli.googleClientID=...'
//          -X 'german-conjunctions-trainer/internal/cli.googleClientSecret=...'".
//
// They can also be overridden at runtime through the GCT_GOOGLE_CLIENT_ID /
// GCT_GOOGLE_CLIENT_SECRET env vars (handy for self-hosted forks and CI). If
// neither route provides values, Login returns ErrMissingGoogleClient — the
// CLI surfaces a clear "OAuth client not configured" message rather than
// failing deep inside the oauth2 library with an opaque 400.
var (
	googleClientID     = ""
	googleClientSecret = ""
)

const (
	envGoogleClientID     = "GCT_GOOGLE_CLIENT_ID"
	envGoogleClientSecret = "GCT_GOOGLE_CLIENT_SECRET"
)

// loginHTTPTimeout caps every individual HTTP request the device flow makes —
// the initial device-code POST, each poll of Google's token endpoint, and the
// cli-exchange POST against our own server. It does NOT cap the overall flow
// duration: oauth2.DeviceAccessToken issues discrete polls at the interval,
// so the total wait is gated by Google's expires_in (typically 15 min), not
// by this value. Using http.DefaultClient (no timeout) means a stalled
// endpoint hangs forever until the user hits Ctrl-C, so we ship our own
// bounded client instead.
const loginHTTPTimeout = 60 * time.Second

// oauthScopes mirrors what the web app uses; the userinfo endpoint needs
// these to populate the Google user ID/email that handleCLIExchange relies
// on for find-or-create.
var oauthScopes = []string{
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
}

// ErrMissingGoogleClient is returned by Login when neither the ldflags-baked
// client credentials nor the GCT_GOOGLE_CLIENT_ID/_SECRET env vars are set.
var ErrMissingGoogleClient = errors.New(
	"Google OAuth client is not configured: " +
		"set GCT_GOOGLE_CLIENT_ID and GCT_GOOGLE_CLIENT_SECRET, " +
		"or build with -ldflags '-X .../internal/cli.googleClientID=... -X .../internal/cli.googleClientSecret=...'",
)

// loginOptions wires every external dependency Login touches so tests can
// inject fakes for Google's device + token endpoints and the project's own
// cli-exchange endpoint without mutating package-level state.
type loginOptions struct {
	serverURL    string
	label        string
	clientID     string
	clientSecret string
	endpoint     oauth2.Endpoint
	httpClient   *http.Client
	out          io.Writer
	now          func() time.Time
}

// LoginResult is what callers persist to the config file after a successful
// device flow.
type LoginResult struct {
	Token  string
	UserID string
	Label  string
}

// Login runs the OAuth 2.0 Device Authorization Grant (RFC 8628) against
// Google, then exchanges the resulting Google access token for a long-lived
// CLI bearer token via POST /api/auth/cli-exchange.
//
// During the flow Login writes a single user-facing prompt to `out`
// instructing the user to visit Google's verification URL and enter a short
// user code — see the prompt formatting in writePrompt below. Polling and
// retry behaviour is delegated to oauth2.Config.DeviceAccessToken, which
// honours the server-provided interval and back-off on "slow_down".
//
// The returned LoginResult contains the *plaintext* bearer token (the server
// stores only a SHA-256 hash); callers should write it to ~/.config/gct via
// SaveTo and avoid logging it.
func Login(ctx context.Context, serverURL, label string, out io.Writer) (*LoginResult, error) {
	clientID := firstNonEmpty(os.Getenv(envGoogleClientID), googleClientID)
	clientSecret := firstNonEmpty(os.Getenv(envGoogleClientSecret), googleClientSecret)
	if clientID == "" || clientSecret == "" {
		return nil, ErrMissingGoogleClient
	}
	return loginWith(ctx, loginOptions{
		serverURL:    serverURL,
		label:        label,
		clientID:     clientID,
		clientSecret: clientSecret,
		endpoint:     google.Endpoint,
		httpClient:   &http.Client{Timeout: loginHTTPTimeout},
		out:          out,
		now:          time.Now,
	})
}

// loginWith is the testable seam behind Login. Every external URL the flow
// touches comes from opts.endpoint / opts.serverURL, every HTTP call goes
// through opts.httpClient, and timing comes from opts.now — so an
// httptest.Server can fake Google's device endpoints and the project's own
// cli-exchange endpoint in the same process.
func loginWith(ctx context.Context, opts loginOptions) (*LoginResult, error) {
	if opts.serverURL == "" {
		return nil, errors.New("server URL is required (use --server or set it in config)")
	}
	if opts.out == nil {
		opts.out = io.Discard
	}
	if opts.httpClient == nil {
		opts.httpClient = &http.Client{Timeout: loginHTTPTimeout}
	}
	if opts.now == nil {
		opts.now = time.Now
	}
	label := strings.TrimSpace(opts.label)
	if label == "" {
		label = "cli"
	}

	cfg := &oauth2.Config{
		ClientID:     opts.clientID,
		ClientSecret: opts.clientSecret,
		Scopes:       oauthScopes,
		Endpoint:     opts.endpoint,
	}

	// Route every HTTP call the oauth2 library makes through opts.httpClient
	// — without this the library uses http.DefaultClient regardless of
	// whatever we set on the Config, which makes the test server unreachable.
	authCtx := context.WithValue(ctx, oauth2.HTTPClient, opts.httpClient)

	da, err := cfg.DeviceAuth(authCtx)
	if err != nil {
		return nil, fmt.Errorf("request device code: %w", err)
	}

	writePrompt(opts.out, da, opts.now())

	googleTok, err := cfg.DeviceAccessToken(authCtx, da)
	if err != nil {
		return nil, friendlyDeviceErr(err)
	}
	if googleTok == nil || googleTok.AccessToken == "" {
		return nil, errors.New("Google returned an empty access token")
	}

	// Exchange the Google access token for a server-issued bearer. The
	// project-side exchange runs through Client.DoContext so a hung server
	// (or a user pressing Ctrl-C after Google has already issued the
	// access token) aborts the request instead of blocking indefinitely.
	client := &Client{BaseURL: opts.serverURL, HTTP: opts.httpClient}
	exchangeReq := map[string]string{
		"google_access_token": googleTok.AccessToken,
		"label":               label,
	}
	var exchangeResp struct {
		Token   string `json:"token"`
		TokenID string `json:"token_id"`
		UserID  string `json:"user_id"`
	}
	if err := client.DoContext(ctx, http.MethodPost, "/api/auth/cli-exchange", exchangeReq, &exchangeResp); err != nil {
		return nil, fmt.Errorf("exchange Google token with server: %w", err)
	}
	if exchangeResp.Token == "" || exchangeResp.UserID == "" {
		return nil, errors.New("server returned an empty CLI token")
	}
	return &LoginResult{
		Token:  exchangeResp.Token,
		UserID: exchangeResp.UserID,
		Label:  label,
	}, nil
}

// writePrompt renders the human-facing instructions for completing the
// device flow on another device. The "(expires in …)" hint is best-effort —
// when the endpoint omits an expiry we just drop that line.
func writePrompt(out io.Writer, da *oauth2.DeviceAuthResponse, now time.Time) {
	uri := da.VerificationURIComplete
	if uri == "" {
		uri = da.VerificationURI
	}
	fmt.Fprintln(out, "To sign in, open this URL on any device:")
	fmt.Fprintf(out, "    %s\n", uri)
	fmt.Fprintln(out, "And enter this code:")
	fmt.Fprintf(out, "    %s\n", da.UserCode)
	if !da.Expiry.IsZero() {
		remaining := da.Expiry.Sub(now).Truncate(time.Second)
		if remaining > 0 {
			fmt.Fprintf(out, "Waiting for confirmation… (expires in %s)\n", remaining)
			return
		}
	}
	fmt.Fprintln(out, "Waiting for confirmation…")
}

// friendlyDeviceErr maps the oauth2 library's *RetrieveError codes onto
// shorter, action-oriented messages. The library returns a generic 400 body
// containing JSON like {"error":"access_denied"} which is opaque to users;
// this layer turns it into "you denied the sign-in request — run gct login
// again to try once more" and similar.
func friendlyDeviceErr(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	var rErr *oauth2.RetrieveError
	if !errors.As(err, &rErr) {
		return fmt.Errorf("poll for token: %w", err)
	}
	switch rErr.ErrorCode {
	case "access_denied":
		return errors.New("sign-in was denied — run gct login again to try once more")
	case "expired_token":
		return errors.New("the code expired before sign-in completed — run gct login again")
	default:
		if rErr.ErrorCode != "" {
			return fmt.Errorf("device flow failed (%s): %s", rErr.ErrorCode, rErr.ErrorDescription)
		}
		return fmt.Errorf("device flow failed: %w", err)
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
