package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// setupTTSTest runs in a temp working dir with ElevenLabs stubbed; it returns
// the app and a pointer to the number of paid synthesis calls.
func setupTTSTest(t *testing.T) (*App, *int) {
	t.Helper()
	wd, _ := os.Getwd()
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chdir(wd) })
	os.MkdirAll("audio_cache", 0o755)

	paid := 0
	orig := ttsHTTPClient.Transport
	ttsHTTPClient.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		body := `{"voices":[{"voice_id":"v1","name":"Test"}]}`
		if strings.Contains(r.URL.Path, "/text-to-speech/") {
			paid++
			body = "mp3"
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
	})
	t.Cleanup(func() { ttsHTTPClient.Transport = orig })

	app := setupAuthTestApp(t)
	app.ElevenLabs = ElevenLabsConfig{APIKey: "k", VoiceName: "Test", Speed: 1.0}
	return app, &paid
}

func ttsCall(app *App, text string, mod func(*http.Request)) *httptest.ResponseRecorder {
	body, _ := json.Marshal(TTSRequest{Text: text})
	req := httptest.NewRequest(http.MethodPost, "/api/tts", strings.NewReader(string(body)))
	req.RemoteAddr = "10.0.0.1:1234"
	if mod != nil {
		mod(req)
	}
	rec := httptest.NewRecorder()
	app.withOptionalAuth(app.handleTTS)(rec, req)
	return rec
}

func fromIP(ip string) func(*http.Request) {
	return func(r *http.Request) { r.Header.Set("X-Forwarded-For", ip) }
}

func TestTTSCacheHitNeverLimited(t *testing.T) {
	app, paid := setupTTSTest(t)
	long := strings.Repeat("Lang ", 200) // 1000 runes, over the miss cap
	if err := os.WriteFile(app.ttsCachePath(long, "de", 1.0), []byte("mp3"), 0o644); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < ttsClientBurst+20; i++ {
		if rec := ttsCall(app, long, nil); rec.Code != http.StatusOK {
			t.Fatalf("hit %d: got %d", i, rec.Code)
		}
	}
	if *paid != 0 {
		t.Fatalf("cache hits made %d paid calls", *paid)
	}
}

func TestTTSMissesLimitedPerClient(t *testing.T) {
	app, paid := setupTTSTest(t)
	for i := 0; i < ttsClientBurst; i++ {
		if rec := ttsCall(app, fmt.Sprintf("Wort%d", i), fromIP("5.6.7.8")); rec.Code != http.StatusOK {
			t.Fatalf("miss %d: got %d %s", i, rec.Code, rec.Body)
		}
	}
	rec := ttsCall(app, "Extra", fromIP("5.6.7.8"))
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("over burst: got %d Retry-After=%q", rec.Code, rec.Header().Get("Retry-After"))
	}
	// A spoofed first hop must not mint a fresh bucket.
	if rec := ttsCall(app, "Extra", fromIP("9.9.9.9, 5.6.7.8")); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("spoofed XFF: got %d", rec.Code)
	}
	if *paid != ttsClientBurst {
		t.Fatalf("paid calls = %d, want %d", *paid, ttsClientBurst)
	}
	// The refused misses spent no shared tokens: another client still passes.
	if rec := ttsCall(app, "Extra", fromIP("1.1.1.1")); rec.Code != http.StatusOK {
		t.Fatalf("other client: got %d", rec.Code)
	}
}

func TestTTSSignedInUserNotBlockedByGuestBucket(t *testing.T) {
	app, _ := setupTTSTest(t)
	n := 0
	for _, ip := range []string{"2.0.0.1", "2.0.0.2"} {
		for i := 0; i < ttsClientBurst && n < ttsGuestsBurst; i++ {
			if rec := ttsCall(app, fmt.Sprintf("G%d", n), fromIP(ip)); rec.Code != http.StatusOK {
				t.Fatalf("guest miss %d: got %d", n, rec.Code)
			}
			n++
		}
	}
	if rec := ttsCall(app, "Gast", fromIP("2.0.0.3")); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("fresh guest after guest bucket drained: got %d", rec.Code)
	}
	cookie := cookieFor(t, app, "user-1")
	rec := ttsCall(app, "Nutzer", func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "2.0.0.3")
		r.AddCookie(cookie)
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("signed-in user: got %d", rec.Code)
	}
}

func TestTTSSizeCaps(t *testing.T) {
	app, paid := setupTTSTest(t)
	if rec := ttsCall(app, strings.Repeat("ä", ttsMaxTextRunes+1), nil); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("301 runes: got %d", rec.Code)
	}
	if rec := ttsCall(app, strings.Repeat("x", 5<<10), nil); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("5 KB body: got %d", rec.Code)
	}
	if *paid != 0 {
		t.Fatalf("rejected requests made %d paid calls", *paid)
	}
	if rec := ttsCall(app, strings.Repeat("ä", 250), nil); rec.Code != http.StatusOK {
		t.Fatalf("250 runes: got %d", rec.Code)
	}
}

func TestTTSConcurrentRefusalsLeaveNoDebt(t *testing.T) {
	app, _ := setupTTSTest(t)
	for i := 0; i < ttsClientBurst; i++ {
		ttsCall(app, fmt.Sprintf("W%d", i), fromIP("3.3.3.3"))
	}
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ttsCall(app, "Mehr", fromIP("3.3.3.3"))
		}()
	}
	wg.Wait()
	if tok := app.limits.get("tts:ip:3.3.3.3", ttsClientRate, ttsClientBurst).Tokens(); tok < -0.5 {
		t.Fatalf("refused requests left the bucket in debt: %.2f tokens", tok)
	}
}

// TestTTSEnglishVoiceAndModel checks that English clips use the original
// language voice and a model that enforces language_code, while German keeps
// the configured voice and model.
func TestTTSEnglishVoiceAndModel(t *testing.T) {
	app, _ := setupTTSTest(t)
	type call struct{ path, model, lang string }
	var calls []call
	ttsHTTPClient.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		body := `{"voices":[{"voice_id":"v1","name":"Test"}]}`
		if strings.Contains(r.URL.Path, "/text-to-speech/") {
			var req struct {
				ModelID      string `json:"model_id"`
				LanguageCode string `json:"language_code"`
			}
			json.NewDecoder(r.Body).Decode(&req)
			calls = append(calls, call{r.URL.Path, req.ModelID, req.LanguageCode})
			body = "mp3"
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
	})
	app.ElevenLabs.ModelID = "eleven_multilingual_v2"

	ctx := context.Background()
	if _, err := app.ensureTTSAudio(ctx, "Hello", "en", 1.0); err != nil {
		t.Fatal(err)
	}
	app.ElevenLabs.OriginalLanguageVoiceID = "enVoice"
	if _, err := app.ensureTTSAudio(ctx, "Hello", "en", 1.0); err != nil {
		t.Fatal(err)
	}
	if _, err := app.ensureTTSAudio(ctx, "Hallo", "de", 1.0); err != nil {
		t.Fatal(err)
	}

	want := []call{
		{"/v1/text-to-speech/v1", ttsMultilingualV2Fallback, "en"},
		{"/v1/text-to-speech/enVoice", ttsMultilingualV2Fallback, "en"},
		{"/v1/text-to-speech/v1", "eleven_multilingual_v2", "de"},
	}
	if fmt.Sprint(calls) != fmt.Sprint(want) {
		t.Errorf("calls %v, want %v", calls, want)
	}

	app.ElevenLabs.ModelID = "eleven_v3"
	if got := app.ttsModel("en"); got != "eleven_v3" {
		t.Errorf("EN model %q, want the configured eleven_v3", got)
	}
}
