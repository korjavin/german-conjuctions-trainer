package llm

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestParsersTolerateFencesAndProse(t *testing.T) {
	ex := `{"exercises":[{"correct_german_sentence":"Ich bleibe, weil es regnet."}]}`
	for name, reply := range map[string]string{
		"plain":  ex,
		"fenced": "```json\n" + ex + "\n```",
		"prose":  "Here are the exercises:\n" + ex + "\nHope this helps!",
	} {
		got, err := parseGeneratedExercises(reply)
		if err != nil || len(got) != 1 || got[0].CorrectGermanSentence != "Ich bleibe, weil es regnet." {
			t.Errorf("%s: got %+v, err %v", name, got, err)
		}
	}

	var terms struct {
		Terms []string `json:"terms"`
	}
	if err := json.Unmarshal(extractJSONObject("```json\n{\"terms\":[\"weil\"]}\n```"), &terms); err != nil || len(terms.Terms) != 1 {
		t.Errorf("fenced terms: %+v, err %v", terms, err)
	}
}

func TestCallChatCompletionsFallsBackOnHTTPError(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusPaymentRequired} {
		primaryHits := 0
		primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			primaryHits++
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"error":{"message":"credit balance too low"}}`))
		}))
		var fbModel, fbAuth string
		fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var req OpenAIRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			fbModel, fbAuth = req.Model, r.Header.Get("Authorization")
			writeChatChoice(w, http.StatusOK, `{"explanation":"ok"}`)
		}))
		t.Setenv("LLM_FALLBACK_URL", fallback.URL)
		t.Setenv("LLM_FALLBACK_API_KEY", "fb-key")
		t.Setenv("LLM_FALLBACK_MODEL", "gpt-fallback")

		got, err := GenerateExplanation("primary-key", primary.URL, "claude-sonnet-5-5", "weil", "Ich bleibe, weil es regnet.", nil)
		primary.Close()
		fallback.Close()
		if err != nil || got != "ok" {
			t.Fatalf("status %d: got %q, err %v", status, got, err)
		}
		if primaryHits != 1 || fbModel != "gpt-fallback" || fbAuth != "Bearer fb-key" {
			t.Errorf("status %d: primaryHits=%d fbModel=%q fbAuth=%q", status, primaryHits, fbModel, fbAuth)
		}
	}
}

func TestCallChatCompletionsNoFallbackWithoutConfigOrOnTimeout(t *testing.T) {
	fallbackHits := 0
	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fallbackHits++
		writeChatChoice(w, http.StatusOK, `{"explanation":"ok"}`)
	}))
	defer fallback.Close()

	// No fallback configured: the primary error surfaces unchanged.
	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusPaymentRequired)
	}))
	defer failing.Close()
	t.Setenv("LLM_FALLBACK_URL", "")
	req := OpenAIRequest{Model: "m", Messages: []Message{{Role: "user", Content: "hi"}}}
	if _, _, err := callChatCompletions(&http.Client{}, failing.URL, "k", req, time.Second, "test"); err == nil || !strings.Contains(err.Error(), "402") {
		t.Fatalf("expected 402 error, got %v", err)
	}

	// Timeout on the primary: not retried on the fallback.
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
	}))
	defer slow.Close()
	t.Setenv("LLM_FALLBACK_URL", fallback.URL)
	if _, _, err := callChatCompletions(&http.Client{}, slow.URL, "k", req, 50*time.Millisecond, "test"); err == nil || !IsTimeoutError(err) {
		t.Fatalf("expected timeout, got %v", err)
	}
	if fallbackHits != 0 {
		t.Errorf("fallback used %d times, want 0", fallbackHits)
	}
}
