package llm

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"german-conjunctions-trainer/pkg/storage"
)

// writeClaudeMessage mirrors a real /v1/messages reply: a (hidden) thinking
// block before the text, plus usage with cache counters.
func writeClaudeMessage(w http.ResponseWriter, text string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"id":"msg_01","type":"message","role":"assistant","model":"claude-sonnet-5-5",` +
		`"content":[{"type":"thinking","thinking":"","signature":"sig"},{"type":"text","text":` + mustQuote(text) + `}],` +
		`"stop_reason":"end_turn","stop_sequence":null,` +
		`"usage":{"input_tokens":120,"cache_creation_input_tokens":0,"cache_read_input_tokens":900,"output_tokens":400}}`))
}

func mustQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestNativeClaudeProviderServesAllStages(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "anthropic")
	t.Setenv("LLM_FALLBACK_URL", "")
	t.Setenv("ENABLE_PROMPT_REFINEMENT", "true")

	var mu sync.Mutex
	var genSystems []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/messages" || r.Header.Get("x-api-key") != "claude-key" || r.Header.Get("anthropic-version") != anthropicVersion {
			t.Errorf("unexpected request %s key=%q version=%q", r.URL.Path, r.Header.Get("x-api-key"), r.Header.Get("anthropic-version"))
		}
		var req struct {
			MaxTokens int                  `json:"max_tokens"`
			System    []anthropicTextBlock `json:"system"`
			Messages  []Message            `json:"messages"`
			Output    json.RawMessage      `json:"output_config"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.MaxTokens <= 0 {
			t.Errorf("max_tokens missing")
		}
		// gct-6d0: the json_schema grammar cut the exercise set to one item.
		if req.Output != nil {
			t.Errorf("output_config must not be sent, got %s", req.Output)
		}
		for _, m := range req.Messages {
			if m.Role == "system" {
				t.Errorf("system message left in messages")
			}
		}
		prompt := req.Messages[len(req.Messages)-1].Content
		switch {
		case strings.Contains(prompt, `"exercises"`):
			// Exercise generation: topic prompt cached in system.
			if len(req.System) != 1 || req.System[0].CacheControl == nil || !strings.Contains(req.System[0].Text, "Nebensätze mit weil") {
				t.Errorf("bad system: %+v", req.System)
			}
			if !strings.HasPrefix(prompt, variationProfileHeader) {
				t.Errorf("user message should start with the variation profile, got %q", prompt)
			}
			mu.Lock()
			genSystems = append(genSystems, req.System[0].Text)
			mu.Unlock()
			// Unconstrained Claude replies may wrap the json in a fence.
			writeClaudeMessage(w, "```json\n"+mustJSONString(t, map[string]any{"exercises": buildExercises(10, "native")})+"\n```")
		case strings.Contains(prompt, "refine the following"):
			writeClaudeMessage(w, "B1 Nebensätze mit weil im Alltag, Arbeit und Freizeit.")
		case strings.Contains(prompt, "extract all key terms"):
			writeClaudeMessage(w, "```json\n{\"terms\":[\"weil\",\"Weil\",\"denn\"]}\n```")
		default:
			writeClaudeMessage(w, `{"explanation":"Nach weil steht das Verb am Ende."}`)
		}
	}))
	defer server.Close()

	if _, err := RefinePrompt("weil", "claude-key", server.URL, "claude-sonnet-5-5"); err != nil {
		t.Fatalf("refine: %v", err)
	}
	if got, err := GenerateExplanation("claude-key", server.URL, "claude-sonnet-5-5", "weil", "Ich bleibe, weil es regnet.", nil); err != nil || got == "" {
		t.Fatalf("explanation: %q %v", got, err)
	}
	if terms, err := ExtractKeyTerms("weil", "claude-key", server.URL, "claude-sonnet-5-5"); err != nil || len(terms) != 2 {
		t.Fatalf("terms: %v %v", terms, err)
	}

	t.Setenv("ENABLE_PROMPT_REFINEMENT", "false")
	topic := &storage.Topic{ID: "t-native", Prompt: "B1 Nebensätze mit weil."}
	for i := 0; i < 2; i++ {
		if ex, err := GenerateExercises(topic, "claude-key", server.URL, "claude-sonnet-5-5", "Term coverage: weil (0)\n"); err != nil || len(ex) != 10 {
			t.Fatalf("generation %d: %d exercises, %v", i, len(ex), err)
		}
	}
	// The cached prefix must be byte-identical across generations of one topic.
	if len(genSystems) != 2 || genSystems[0] != genSystems[1] {
		t.Errorf("system prompt not stable across generations: %q", genSystems)
	}
}

func TestNativeClaudeFallsBackToOpenAI(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "anthropic")
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("request-id", "req_123")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}`))
	}))
	defer primary.Close()
	var fbPath string
	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fbPath = r.URL.Path
		writeChatChoice(w, http.StatusOK, `{"explanation":"ok"}`)
	}))
	defer fallback.Close()
	t.Setenv("LLM_FALLBACK_URL", fallback.URL)
	t.Setenv("LLM_FALLBACK_API_KEY", "fb-key")
	t.Setenv("LLM_FALLBACK_MODEL", "gpt-fallback")

	got, err := GenerateExplanation("claude-key", primary.URL, "claude-sonnet-5-5", "weil", "Ich bleibe, weil es regnet.", nil)
	if err != nil || got != "ok" || fbPath != "/chat/completions" {
		t.Fatalf("got %q err %v fallback path %q", got, err, fbPath)
	}

	// Without a fallback the provider's message and request id surface.
	t.Setenv("LLM_FALLBACK_URL", "")
	_, err = GenerateExplanation("claude-key", primary.URL, "claude-sonnet-5-5", "weil", "x", nil)
	if err == nil || !strings.Contains(err.Error(), "credit balance") || !strings.Contains(err.Error(), "req_123") {
		t.Fatalf("expected provider error, got %v", err)
	}
}

func TestNativeClaudeRejectsTruncatedReply(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "anthropic")
	t.Setenv("LLM_FALLBACK_URL", "")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"{\"explanation\":\"Nach"}],"stop_reason":"max_tokens","usage":{}}`))
	}))
	defer server.Close()
	if _, err := GenerateExplanation("k", server.URL, "m", "weil", "x", nil); err == nil || !strings.Contains(err.Error(), "max_tokens") {
		t.Fatalf("expected max_tokens error, got %v", err)
	}
}
