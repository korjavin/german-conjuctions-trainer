package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"german-conjunctions-trainer/pkg/llm"
	"german-conjunctions-trainer/pkg/storage"
)

func (m *mockStorage) GetAllTopics() ([]*storage.Topic, error) {
	var out []*storage.Topic
	for _, t := range m.topics {
		out = append(out, t)
	}
	return out, nil
}

// addArchive puts an archive root with one archived child topic holding n
// current-prompt exercises into the mock.
func addArchive(mock *mockStorage, n int) {
	mock.topics[storage.ArchiveTopicID] = &storage.Topic{ID: storage.ArchiveTopicID, Name: "Archive", IsArchive: true}
	old := &storage.Topic{ID: "old", Name: "Old", Prompt: "old prompt"}
	mock.topics["old"] = old
	mock.descendants[storage.ArchiveTopicID] = []string{"old"}
	for i := 0; i < n; i++ {
		ex := testPhraseExercise(fmt.Sprint("arch", i))
		ex.TopicID, ex.PromptHash = "old", storage.GetPromptHash(old.Prompt)
		mock.exercises = append(mock.exercises, ex)
	}
}

func TestExercisesAllTopicsServesCacheOnly(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "dummy-key-for-test")
	t.Setenv("OPENAI_URL", "http://127.0.0.1:0/invalid")

	app, mock := setupTestAppWithMock(t)
	app.generateExercises = func(*storage.Topic, string) ([]*storage.Exercise, error) {
		t.Error("the All topics scope must never call the LLM")
		return nil, nil
	}
	for _, id := range []string{"t1", "t2"} {
		topic := &storage.Topic{ID: id, Prompt: "prompt " + id}
		mock.topics[id] = topic
		ex := testPhraseExercise("ex-" + id)
		ex.TopicID, ex.PromptHash = id, storage.GetPromptHash(topic.Prompt)
		mock.exercises = append(mock.exercises, ex)
	}
	addArchive(mock, 3)

	got, rr := postExercises(t, app, llm.GenerateRequest{TopicID: ""})
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	if got != 2 {
		t.Errorf("all topics served %d exercises, want the 2 non-archived: %s", got, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), `"old"`) {
		t.Errorf("archived exercises leaked into All topics: %s", rr.Body.String())
	}

	if _, rr := postExercises(t, app, llm.GenerateRequest{TopicID: storage.ArchiveTopicID}); rr.Code != http.StatusBadRequest {
		t.Errorf("archive root status %d, want 400", rr.Code)
	}
}

func postAllTopicsPodcast(t *testing.T, app *App) (*httptest.ResponseRecorder, podcastResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/podcast", strings.NewReader(`{"topic_id":""}`))
	req.RemoteAddr = "192.0.2.1:1234"
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, "user1"))
	rr := httptest.NewRecorder()
	app.handlePodcast(rr, req)
	var resp podcastResponse
	json.Unmarshal(rr.Body.Bytes(), &resp)
	return rr, resp
}

func TestPodcastAllTopicsUsesCachedPhrasesOnly(t *testing.T) {
	app, mock, generated := setupPodcastTest(t, 10)
	addArchive(mock, 20)

	rr, resp := postAllTopicsPodcast(t, app)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	if *generated != 0 {
		t.Errorf("generated %d phrases, want none for All topics", *generated)
	}
	if resp.TopicID != "" || resp.TopicName != podcastAllTopicsTitle || len(resp.Phrases) != 10 {
		t.Errorf("episode topic=%q name=%q phrases=%d", resp.TopicID, resp.TopicName, len(resp.Phrases))
	}
	for _, p := range resp.Phrases {
		if strings.HasPrefix(p.ExerciseID, "arch") {
			t.Errorf("archived phrase %s in All topics episode", p.ExerciseID)
		}
	}
}

func TestPodcastAllTopicsWithoutPhrasesIsInvalid(t *testing.T) {
	app, _, generated := setupPodcastTest(t, 0)
	rr, _ := postAllTopicsPodcast(t, app)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "INVALID_REQUEST") {
		t.Errorf("status %d body %s, want 400 INVALID_REQUEST", rr.Code, rr.Body.String())
	}
	if *generated != 0 {
		t.Errorf("generated %d phrases, want none", *generated)
	}
}

func TestHandleTopicProgress(t *testing.T) {
	store, err := storage.NewSQLiteStorage(filepath.Join(t.TempDir(), "progress.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	app := &App{DB: store}

	user, _ := store.CreateUser("g-progress")
	topic, _ := store.CreateTopic("T", "p", nil, 0)
	ex1, _ := store.CreateExercise(topic.ID, "h", `{}`, "")
	store.CreateExercise(topic.ID, "h", `{}`, "")
	store.UpdateUserExerciseViews([]*storage.UserExerciseView{
		{UserID: user.ID, ExerciseID: ex1.ID, LastViewed: time.Now().Add(-2 * time.Hour), RepetitionCounter: 1},
	})

	rr := httptest.NewRecorder()
	app.handleTopicProgress(rr, asUser(httptest.NewRequest(http.MethodGet, "/api/topics/progress", nil), user.ID))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Topics map[string]storage.TopicProgress `json:"topics"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if got := resp.Topics[topic.ID]; got != (storage.TopicProgress{Exercises: 2, Seen: 1, Due: 1}) {
		t.Errorf("progress = %+v, body %s", got, rr.Body.String())
	}
}

func TestHandleUserActivity(t *testing.T) {
	app, cleanup := setupIntegrationApp(t)
	defer cleanup()

	user, _ := app.DB.CreateUser("g-activity")
	parent, _ := app.DB.CreateTopic("P", "p", nil, 0)
	child, _ := app.DB.CreateTopic("C", "c", &parent.ID, 0)
	other, _ := app.DB.CreateTopic("O", "o", nil, 0)
	ex, _ := app.DB.CreateExercise(child.ID, "h", `{}`, "")

	// Two completions today, then a replay of the first batch.
	for _, batch := range []string{"b1", "b2", "b1"} {
		if rr := postCompletion(t, app, user.ID, ex.ID, batch, 0); rr.Code != http.StatusOK {
			t.Fatalf("completion %s: %d %s", batch, rr.Code, rr.Body.String())
		}
	}

	get := func(query string) []storage.DayCount {
		t.Helper()
		rr := httptest.NewRecorder()
		app.handleUserActivity(rr, asUser(httptest.NewRequest(http.MethodGet, "/api/user/activity"+query, nil), user.ID))
		if rr.Code != http.StatusOK {
			t.Fatalf("%s: status %d: %s", query, rr.Code, rr.Body.String())
		}
		var resp struct {
			Days []storage.DayCount `json:"days"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		return resp.Days
	}

	for query, wantToday := range map[string]int{"": 2, "?topic_id=" + parent.ID: 2, "?topic_id=" + other.ID: 0} {
		days := get(query)
		if len(days) != 7 || days[6].Date != time.Now().Format("2006-01-02") {
			t.Fatalf("%q: bad days %+v", query, days)
		}
		for i, d := range days {
			want := 0
			if i == 6 {
				want = wantToday
			}
			if d.Count != want {
				t.Errorf("%q: day %s count %d, want %d", query, d.Date, d.Count, want)
			}
		}
	}

	if days := get("?days=3"); len(days) != 3 {
		t.Errorf("days=3 returned %d days", len(days))
	}
	rr := httptest.NewRecorder()
	app.handleUserActivity(rr, asUser(httptest.NewRequest(http.MethodGet, "/api/user/activity?days=0", nil), user.ID))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("days=0: status %d, want 400", rr.Code)
	}
}
