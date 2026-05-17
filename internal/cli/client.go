package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// defaultTimeout caps every HTTP round trip the CLI makes. Long-running
// server operations (exercise generation) call this on the server side
// asynchronously; the request itself returns quickly.
const defaultTimeout = 60 * time.Second

// Sentinel errors callers can match with errors.Is to render specific
// guidance ("run gct login again", "ask an admin for access", ...) rather
// than raw HTTP status codes.
var (
	ErrUnauthorized = errors.New("not logged in or token expired")
	ErrForbidden    = errors.New("permission denied")
	ErrNotFound     = errors.New("not found")
)

// APIError carries the server's response when a request fails with a
// non-2xx status. The Body field holds the raw response — JSON when the
// server's writeJSONError handler produced it, plain text otherwise — so
// command implementations can surface it verbatim to the user.
type APIError struct {
	StatusCode int
	Status     string
	Method     string
	URL        string
	Body       string
}

func (e *APIError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("%s %s: %s", e.Method, e.URL, e.Status)
	}
	return fmt.Sprintf("%s %s: %s: %s", e.Method, e.URL, e.Status, e.Body)
}

// Unwrap maps common HTTP statuses to the package's sentinel errors so
// callers can write errors.Is(err, cli.ErrUnauthorized) without sniffing
// status codes themselves.
func (e *APIError) Unwrap() error {
	switch e.StatusCode {
	case http.StatusUnauthorized:
		return ErrUnauthorized
	case http.StatusForbidden:
		return ErrForbidden
	case http.StatusNotFound:
		return ErrNotFound
	}
	return nil
}

// Client is the typed wrapper command implementations use to call the
// server. BaseURL is the server origin (e.g. https://german.example.com),
// Token is the bearer token persisted in config (may be empty for endpoints
// that don't need auth, like /api/auth/cli-exchange itself), and HTTP is
// the underlying transport — exposed so tests can swap in an
// httptest.Server's client.
type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

// NewClient constructs a Client with a sensible default timeout. Tests that
// want a custom *http.Client can build the struct literally.
func NewClient(baseURL, token string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Token:   token,
		HTTP:    &http.Client{Timeout: defaultTimeout},
	}
}

// Do executes an HTTP request against the server. Equivalent to
// DoContext(context.Background(), ...); prefer DoContext from any call site
// that already has a cancelable context (e.g. one tied to SIGINT) so the
// request can be aborted on Ctrl-C.
func (c *Client) Do(method, path string, body, out any) error {
	return c.DoContext(context.Background(), method, path, body, out)
}

// DoContext is the context-aware variant of Do.
//
// path may be a relative path ("/api/topics") or an absolute URL — relative
// paths are joined to BaseURL. body is JSON-encoded when non-nil. out, if
// non-nil, is JSON-decoded from the response body on 2xx; pass nil to
// discard the body.
//
// Non-2xx responses return an *APIError with the raw body. Transport-level
// failures are returned wrapped with the request method and URL for
// context. Context cancellation (Ctrl-C, deadline) aborts the in-flight
// request and surfaces as the wrapped context error.
func (c *Client) DoContext(ctx context.Context, method, path string, body, out any) error {
	endpoint, err := c.resolve(path)
	if err != nil {
		return err
	}

	var reqBody io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode request body: %w", err)
		}
		reqBody = bytes.NewReader(buf)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, reqBody)
	if err != nil {
		return fmt.Errorf("build %s %s: %w", method, endpoint, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultTimeout}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%s %s: %w", method, endpoint, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("%s %s: read response: %w", method, endpoint, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &APIError{
			StatusCode: resp.StatusCode,
			Status:     resp.Status,
			Method:     method,
			URL:        endpoint,
			Body:       strings.TrimSpace(string(respBody)),
		}
	}

	if out == nil || len(respBody) == 0 {
		return nil
	}
	if err := json.Unmarshal(respBody, out); err != nil {
		return fmt.Errorf("%s %s: decode response: %w", method, endpoint, err)
	}
	return nil
}

// resolve turns a relative path into an absolute URL against c.BaseURL.
// Absolute URLs (with a scheme) pass through untouched, which is handy for
// tests that hardcode an httptest.Server address.
func (c *Client) resolve(path string) (string, error) {
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		return path, nil
	}
	if c.BaseURL == "" {
		return "", errors.New("client BaseURL is empty; set --server or run gct login")
	}
	base, err := url.Parse(c.BaseURL)
	if err != nil {
		return "", fmt.Errorf("parse server URL %q: %w", c.BaseURL, err)
	}
	rel, err := url.Parse(path)
	if err != nil {
		return "", fmt.Errorf("parse path %q: %w", path, err)
	}
	return base.ResolveReference(rel).String(), nil
}
