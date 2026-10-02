package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/time/rate"

	"german-conjunctions-trainer/pkg/llm"
	"german-conjunctions-trainer/pkg/storage"
)

func postExercisesAs(t *testing.T, app *App, userID string, req llm.GenerateRequest) (*httptest.ResponseRecorder, int) {
	t.Helper()
	body, _ := json.Marshal(req)
	r := httptest.NewRequest(http.MethodPost, "/api/exercises", bytes.NewReader(body))
	r = r.WithContext(context.WithValue(r.Context(), userContextKey, userID))
	rr := httptest.NewRecorder()
	app.handleExercises(rr, r)
	var resp map[string][]json.RawMessage
	json.Unmarshal(rr.Body.Bytes(), &resp)
	return rr, len(resp["exercises"])
}

func assertRateLimited(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Error("missing Retry-After")
	}
	var body struct {
		Error struct {
			Code      string `json:"code"`
			Retryable bool   `json:"retryable"`
		} `json:"error"`
	}
	json.Unmarshal(rr.Body.Bytes(), &body)
	if body.Error.Code != "RATE_LIMITED" || !body.Error.Retryable {
		t.Errorf("want retryable RATE_LIMITED, got %s", rr.Body.String())
	}
}

// setupGenTest has topic "few" with 3 cached exercises and topic "none" with
// none; the generator stub counts calls and adds nothing.
func setupGenTest(t *testing.T) (*App, *atomic.Int32) {
	app, mock := setupTestAppWithMock(t)
	few := &storage.Topic{ID: "few", Prompt: "p1"}
	mock.topics["few"] = few
	mock.topics["none"] = &storage.Topic{ID: "none", Prompt: "p2"}
	for i := 0; i < 3; i++ {
		mock.exercises = append(mock.exercises, &storage.Exercise{
			ID: fmt.Sprint("ex", i), TopicID: "few", PromptHash: storage.GetPromptHash(few.Prompt), ExerciseJSON: `{}`,
		})
	}
	var calls atomic.Int32
	app.generateExercises = func(*storage.Topic, string) ([]*storage.Exercise, error) {
		calls.Add(1)
		return nil, nil
	}
	return app, &calls
}

func TestGenerationUserBurst(t *testing.T) {
	app, calls := setupGenTest(t)

	for i := 0; i < genUserBurst; i++ {
		if rr, _ := postExercisesAs(t, app, "u1", llm.GenerateRequest{TopicID: "few"}); rr.Code != http.StatusOK {
			t.Fatalf("request %d: %d", i, rr.Code)
		}
	}
	if got := calls.Load(); got != genUserBurst {
		t.Fatalf("want %d generations, got %d", genUserBurst, got)
	}

	// Beyond the burst: no generation, the eligible list is still served.
	rr, n := postExercisesAs(t, app, "u1", llm.GenerateRequest{TopicID: "few"})
	if rr.Code != http.StatusOK || n != 3 {
		t.Fatalf("throttled with eligible: want 200 with 3, got %d with %d", rr.Code, n)
	}
	// Nothing eligible: say why instead of an empty batch.
	assertRateLimited(t, func() *httptest.ResponseRecorder {
		rr, _ := postExercisesAs(t, app, "u1", llm.GenerateRequest{TopicID: "none"})
		return rr
	}())
	if got := calls.Load(); got != genUserBurst {
		t.Fatalf("throttled requests generated: %d calls", got)
	}

	// skip_generation never touches the limiter.
	for i := 0; i < 3; i++ {
		if rr, _ := postExercisesAs(t, app, "u1", llm.GenerateRequest{TopicID: "none", SkipGeneration: true}); rr.Code != http.StatusOK {
			t.Fatalf("skip_generation: %d", rr.Code)
		}
	}
	// Another user has their own bucket.
	if rr, _ := postExercisesAs(t, app, "u2", llm.GenerateRequest{TopicID: "none"}); rr.Code != http.StatusOK {
		t.Fatalf("other user: %d", rr.Code)
	}
}

func TestGenerationServerSlots(t *testing.T) {
	app, calls := setupGenTest(t)
	release := make(chan struct{})
	app.generateExercises = func(*storage.Topic, string) ([]*storage.Exercise, error) {
		calls.Add(1)
		<-release
		return nil, nil
	}

	var wg sync.WaitGroup
	for i := 0; i < genMaxConcurrent; i++ {
		wg.Add(1)
		go func(u string) {
			defer wg.Done()
			postExercisesAs(t, app, u, llm.GenerateRequest{TopicID: "none"})
		}(fmt.Sprint("busy", i))
	}
	deadline := time.Now().Add(5 * time.Second)
	for calls.Load() < genMaxConcurrent {
		if time.Now().After(deadline) {
			t.Fatal("generations did not start")
		}
		time.Sleep(time.Millisecond)
	}

	rr, _ := postExercisesAs(t, app, "third", llm.GenerateRequest{TopicID: "none"})
	assertRateLimited(t, rr)
	if got := calls.Load(); got != genMaxConcurrent {
		t.Fatalf("third generation ran: %d calls", got)
	}

	close(release)
	wg.Wait()
	if got := app.genInFlight.Load(); got != 0 {
		t.Fatalf("slots leaked: %d in flight", got)
	}
	// Slots free again; "third" did not spend a user token while refused.
	if rr, _ := postExercisesAs(t, app, "third", llm.GenerateRequest{TopicID: "none"}); rr.Code != http.StatusOK {
		t.Fatalf("after release: %d", rr.Code)
	}
}

func postExplain(app *App, userID, xff, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/explain", strings.NewReader(body))
	r.RemoteAddr = "10.0.0.1:1234"
	if xff != "" {
		r.Header.Set("X-Forwarded-For", xff)
	}
	if userID != "" {
		r = r.WithContext(context.WithValue(r.Context(), userContextKey, userID))
	}
	rr := httptest.NewRecorder()
	app.handleExplain(rr, r)
	return rr
}

func explainBody(mistakes int, size int) string {
	req := map[string]interface{}{"topic": "weil", "correct_sentence": "Ich bleibe, weil es regnet."}
	var ms []string
	for i := 0; i < mistakes; i++ {
		ms = append(ms, strings.Repeat("x", size))
	}
	req["mistakes"] = ms
	b, _ := json.Marshal(req)
	return string(b)
}

func TestExplainLimits(t *testing.T) {
	// The LLM is unreachable: an admitted request fails fast with 502.
	t.Setenv("OPENAI_API_KEY", "dummy-key-for-test")
	t.Setenv("OPENAI_URL", "http://127.0.0.1:0/invalid")

	t.Run("body over 16KB is 413", func(t *testing.T) {
		app, _ := setupTestAppWithMock(t)
		if rr := postExplain(app, "u1", "", explainBody(1, 17<<10)); rr.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("want 413, got %d", rr.Code)
		}
	})

	t.Run("many long mistakes under 16KB pass validation", func(t *testing.T) {
		app, _ := setupTestAppWithMock(t)
		body := explainBody(25, 500)
		if len(body) >= explainMaxBody {
			t.Fatalf("fixture too big: %d", len(body))
		}
		rr := postExplain(app, "u1", "", body)
		if rr.Code == http.StatusBadRequest || rr.Code == http.StatusRequestEntityTooLarge || rr.Code == http.StatusTooManyRequests {
			t.Fatalf("rejected before the LLM: %d %s", rr.Code, rr.Body.String())
		}
	})

	t.Run("sixth call from a user is 429", func(t *testing.T) {
		app, _ := setupTestAppWithMock(t)
		for i := 0; i < explainKeyBurst; i++ {
			if rr := postExplain(app, "u1", "", explainBody(1, 10)); rr.Code == http.StatusTooManyRequests {
				t.Fatalf("call %d limited", i+1)
			}
		}
		assertRateLimited(t, postExplain(app, "u1", "", explainBody(1, 10)))
		if rr := postExplain(app, "u2", "", explainBody(1, 10)); rr.Code == http.StatusTooManyRequests {
			t.Fatal("another user shares the bucket")
		}
	})

	t.Run("spoofed first XFF hop does not reset the guest bucket", func(t *testing.T) {
		app, _ := setupTestAppWithMock(t)
		for i := 0; i < explainKeyBurst; i++ {
			xff := fmt.Sprintf("203.0.113.%d, 198.51.100.7", i)
			if rr := postExplain(app, "", xff, explainBody(1, 10)); rr.Code == http.StatusTooManyRequests {
				t.Fatalf("call %d limited", i+1)
			}
		}
		assertRateLimited(t, postExplain(app, "", "203.0.113.99, 198.51.100.7", explainBody(1, 10)))
	})
}

func TestReserveAllConcurrentRejectionsLeaveNoDebt(t *testing.T) {
	l := rate.NewLimiter(rate.Every(time.Hour), 1)
	if reserveAll(l) != 0 {
		t.Fatal("first token refused")
	}
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if reserveAll(l) == 0 {
				t.Error("admitted with an empty bucket")
			}
		}()
	}
	wg.Wait()
	if tokens := l.Tokens(); tokens < -0.5 {
		t.Fatalf("rejected reservations left token debt: %.2f", tokens)
	}
}
