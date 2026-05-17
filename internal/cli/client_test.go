package cli

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientDoGetSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if r.URL.Path != "/api/topics" {
			t.Errorf("path = %s, want /api/topics", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer abc" {
			t.Errorf("Authorization header = %q, want %q", got, "Bearer abc")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"topics":[{"id":"t1","name":"Greetings"}]}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "abc")
	var out struct {
		Topics []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"topics"`
	}
	if err := c.Do(http.MethodGet, "/api/topics", nil, &out); err != nil {
		t.Fatalf("Do: %v", err)
	}
	if len(out.Topics) != 1 || out.Topics[0].ID != "t1" || out.Topics[0].Name != "Greetings" {
		t.Errorf("unexpected decoded body: %+v", out)
	}
}

func TestClientDoPostSendsJSONBody(t *testing.T) {
	type req struct {
		Name string `json:"name"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", ct)
		}
		body, _ := io.ReadAll(r.Body)
		var got req
		if err := json.Unmarshal(body, &got); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if got.Name != "Hi" {
			t.Errorf("body.Name = %q, want Hi", got.Name)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "")
	var out struct {
		OK bool `json:"ok"`
	}
	if err := c.Do(http.MethodPost, "/api/topics", req{Name: "Hi"}, &out); err != nil {
		t.Fatalf("Do: %v", err)
	}
	if !out.OK {
		t.Errorf("expected ok=true in response")
	}
}

func TestClientDoNoAuthHeaderWhenTokenEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("Authorization header = %q, want empty", got)
		}
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "")
	if err := c.Do(http.MethodGet, "/", nil, nil); err != nil {
		t.Fatalf("Do: %v", err)
	}
}

func TestClientDo401MapsToUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "token revoked", http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "abc")
	err := c.Do(http.MethodGet, "/api/topics", nil, nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, ErrUnauthorized) {
		t.Errorf("expected errors.Is(err, ErrUnauthorized), got %v", err)
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if apiErr.StatusCode != http.StatusUnauthorized {
		t.Errorf("StatusCode = %d, want 401", apiErr.StatusCode)
	}
	if !strings.Contains(apiErr.Body, "token revoked") {
		t.Errorf("Body = %q, want to contain 'token revoked'", apiErr.Body)
	}
}

func TestClientDo403MapsToForbidden(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "admin only", http.StatusForbidden)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "abc")
	err := c.Do(http.MethodGet, "/api/topics", nil, nil)
	if !errors.Is(err, ErrForbidden) {
		t.Errorf("expected errors.Is(err, ErrForbidden), got %v", err)
	}
}

func TestClientDo404MapsToNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no such topic", http.StatusNotFound)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "abc")
	err := c.Do(http.MethodGet, "/api/topics/missing", nil, nil)
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("expected errors.Is(err, ErrNotFound), got %v", err)
	}
}

func TestClientDo500SurfacesServerBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal explosion", http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "abc")
	err := c.Do(http.MethodGet, "/api/topics", nil, nil)
	if err == nil {
		t.Fatal("expected error")
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *APIError, got %T (%v)", err, err)
	}
	if apiErr.StatusCode != http.StatusInternalServerError {
		t.Errorf("StatusCode = %d, want 500", apiErr.StatusCode)
	}
	if !strings.Contains(apiErr.Body, "internal explosion") {
		t.Errorf("expected server body in error, got %q", apiErr.Body)
	}
}

func TestClientDoNetworkErrorWrapped(t *testing.T) {
	// Point at a closed server to provoke a connection-refused error
	// without depending on a specific unused port.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	srv.Close()

	c := NewClient(srv.URL, "abc")
	err := c.Do(http.MethodGet, "/", nil, nil)
	if err == nil {
		t.Fatal("expected network error")
	}
	if !strings.Contains(err.Error(), "GET ") {
		t.Errorf("network error not wrapped with method/URL: %v", err)
	}
}

func TestClientDoErrorsWhenBaseURLEmpty(t *testing.T) {
	c := &Client{}
	err := c.Do(http.MethodGet, "/api/topics", nil, nil)
	if err == nil {
		t.Fatal("expected error when BaseURL empty")
	}
	if !strings.Contains(err.Error(), "BaseURL") {
		t.Errorf("expected BaseURL hint, got %v", err)
	}
}

func TestClientDoAcceptsAbsoluteURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/auth/cli-exchange" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte("{}"))
	}))
	defer srv.Close()

	c := &Client{HTTP: srv.Client()}
	if err := c.Do(http.MethodPost, srv.URL+"/api/auth/cli-exchange", nil, nil); err != nil {
		t.Fatalf("Do absolute URL: %v", err)
	}
}

func TestClientDoTrimsTrailingSlashOnBaseURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/topics" {
			t.Errorf("path = %s, want /api/topics", r.URL.Path)
		}
	}))
	defer srv.Close()
	c := NewClient(srv.URL+"/", "")
	if err := c.Do(http.MethodGet, "/api/topics", nil, nil); err != nil {
		t.Fatalf("Do: %v", err)
	}
}
