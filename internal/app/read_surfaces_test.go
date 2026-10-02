package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHandleAudioCache(t *testing.T) {
	wd, _ := os.Getwd()
	dir := t.TempDir()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chdir(wd) })

	clip := strings.Repeat("ab", 32) + ".mp3"
	episode := strings.Repeat("cd", 16) + ".mp3"
	os.MkdirAll(filepath.Join("audio_cache", "podcasts"), 0o755)
	os.WriteFile(filepath.Join("audio_cache", clip), []byte("0123456789"), 0o644)
	os.WriteFile(filepath.Join("audio_cache", "podcasts", episode), []byte("ep"), 0o644)
	os.WriteFile(filepath.Join("audio_cache", ".tts-x.tmp"), []byte("tmp"), 0o644)
	os.WriteFile("secret.mp3", []byte("s"), 0o644)
	// A directory with a clip-shaped name must not be served either.
	os.MkdirAll(filepath.Join("audio_cache", strings.Repeat("ef", 32)+".mp3"), 0o755)

	a := &App{}
	do := func(method, path, rng string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/", nil)
		req.URL.Path = path // bypass NewRequest's cleaning so ../ reaches the handler
		if rng != "" {
			req.Header.Set("Range", rng)
		}
		rr := httptest.NewRecorder()
		a.handleAudioCache(rr, req)
		return rr
	}

	for _, p := range []string{
		"/audio_cache/",
		"/audio_cache/podcasts/",
		"/audio_cache/podcasts/" + episode,
		"/audio_cache/.tts-x.tmp",
		"/audio_cache/../secret.mp3",
		"/audio_cache/../audio_cache/" + clip,
		"/audio_cache/" + strings.ToUpper(clip[:64]) + ".mp3",
		"/audio_cache/" + strings.Repeat("00", 32) + ".mp3", // missing
		"/audio_cache/" + strings.Repeat("ef", 32) + ".mp3", // directory
	} {
		if rr := do(http.MethodGet, p, ""); rr.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", p, rr.Code)
		}
	}

	rr := do(http.MethodGet, "/audio_cache/"+clip, "")
	if rr.Code != http.StatusOK || rr.Header().Get("Content-Type") != "audio/mpeg" || rr.Body.String() != "0123456789" {
		t.Errorf("GET clip = %d %q %q", rr.Code, rr.Header().Get("Content-Type"), rr.Body.String())
	}
	if rr.Header().Get("Accept-Ranges") != "bytes" {
		t.Errorf("Accept-Ranges = %q", rr.Header().Get("Accept-Ranges"))
	}
	rr = do(http.MethodHead, "/audio_cache/"+clip, "")
	if rr.Code != http.StatusOK || rr.Header().Get("Content-Type") != "audio/mpeg" || rr.Body.Len() != 0 {
		t.Errorf("HEAD clip = %d %q len=%d", rr.Code, rr.Header().Get("Content-Type"), rr.Body.Len())
	}
	rr = do(http.MethodGet, "/audio_cache/"+clip, "bytes=2-4")
	if rr.Code != http.StatusPartialContent || rr.Body.String() != "234" {
		t.Errorf("Range clip = %d %q", rr.Code, rr.Body.String())
	}
	if rr := do(http.MethodPost, "/audio_cache/"+clip, ""); rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST clip = %d, want 405", rr.Code)
	}
}

func TestDebugEndpointsAdminOnly(t *testing.T) {
	app, adminID := setupAdminApp(t)
	other, err := app.DB.CreateUser("google-not-admin-debug")
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range []http.HandlerFunc{
		app.withAuth(app.adminOnly(app.handleGetLastRefinedPrompt)),
		app.withAuth(app.adminOnly(app.handleGetLastGenerationDebug)),
	} {
		for _, tc := range []struct {
			user string
			want int
		}{{"", http.StatusUnauthorized}, {other.ID, http.StatusForbidden}, {adminID, http.StatusOK}} {
			req := httptest.NewRequest(http.MethodGet, "/api/debug", nil)
			if tc.user != "" {
				enc, err := app.SC.Encode(cookieName, tc.user)
				if err != nil {
					t.Fatal(err)
				}
				req.AddCookie(&http.Cookie{Name: cookieName, Value: enc})
			}
			rr := httptest.NewRecorder()
			h(rr, req)
			if rr.Code != tc.want {
				t.Errorf("user %q: status %d, want %d", tc.user, rr.Code, tc.want)
			}
			if rr.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Errorf("user %q: unexpected ACAO header", tc.user)
			}
			if tc.want == http.StatusOK && rr.Header().Get("Cache-Control") != "no-store" {
				t.Errorf("Cache-Control = %q, want no-store", rr.Header().Get("Cache-Control"))
			}
		}
	}
}
