package app

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"german-conjunctions-trainer/pkg/storage"
)

// Podcast tests without a backing store just skip the feed row.
func (m *mockStorage) CreatePodcastEpisode(ep *storage.PodcastEpisode) error {
	if m.Storage == nil {
		return nil
	}
	return m.Storage.CreatePodcastEpisode(ep)
}

func asUser(r *http.Request, userID string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), userContextKey, userID))
}

func feedURLFor(t *testing.T, app *App, userID string, regenerate bool) string {
	t.Helper()
	method, handler := http.MethodGet, app.handlePodcastFeedURL
	if regenerate {
		method, handler = http.MethodPost, app.handlePodcastFeedRegenerate
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(method, "/api/podcast/feed", nil)
	req.Header.Set("Content-Type", "application/json")
	handler(rr, asUser(req, userID))
	if rr.Code != http.StatusOK {
		t.Fatalf("feed url status %d: %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		FeedURL string `json:"feed_url"`
	}
	json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp.FeedURL
}

func getFeed(app *App, feedURL string) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	app.handlePodcastFeed(rr, httptest.NewRequest(http.MethodGet, strings.TrimPrefix(feedURL, app.PublicBaseURL), nil))
	return rr
}

func feedItems(t *testing.T, rr *httptest.ResponseRecorder) []rssItem {
	t.Helper()
	if rr.Code != http.StatusOK {
		t.Fatalf("feed status %d: %s", rr.Code, rr.Body.String())
	}
	var feed struct {
		Channel struct {
			Items []struct {
				Title     string       `xml:"title"`
				GUID      string       `xml:"guid"`
				Enclosure rssEnclosure `xml:"enclosure"`
			} `xml:"item"`
		} `xml:"channel"`
	}
	if err := xml.Unmarshal(rr.Body.Bytes(), &feed); err != nil {
		t.Fatalf("feed is not XML: %v\n%s", err, rr.Body.String())
	}
	var items []rssItem
	for _, it := range feed.Channel.Items {
		items = append(items, rssItem{Title: it.Title, GUID: rssGUID{Value: it.GUID}, Enclosure: it.Enclosure})
	}
	return items
}

func TestPodcastFeedListsOnlyOwnLiveEpisodes(t *testing.T) {
	app, mock, _ := setupPodcastTest(t, 30)
	store, err := storage.NewSQLiteStorage(filepath.Join(t.TempDir(), "feed.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	mock.Storage = store
	app.PublicBaseURL = "https://gct.example"

	alice, _ := store.CreateUser("g-alice")
	bob, _ := store.CreateUser("g-bob")
	var aliceIDs []string
	for i := 0; i < 2; i++ {
		rr, resp := postPodcast(t, app, alice.ID)
		if rr.Code != http.StatusOK {
			t.Fatalf("build status %d: %s", rr.Code, rr.Body.String())
		}
		aliceIDs = append(aliceIDs, resp.ID)
	}
	if rr, _ := postPodcast(t, app, bob.ID); rr.Code != http.StatusOK {
		t.Fatalf("bob build status %d", rr.Code)
	}
	postPodcast(t, app, "") // guests get no feed row

	aliceURL := feedURLFor(t, app, alice.ID, false)
	if !strings.HasPrefix(aliceURL, "https://gct.example/podcast/feed/") || !strings.HasSuffix(aliceURL, ".xml") {
		t.Fatalf("feed url = %q", aliceURL)
	}
	if again := feedURLFor(t, app, alice.ID, false); again != aliceURL {
		t.Errorf("feed url changed between calls: %q -> %q", aliceURL, again)
	}

	rr := getFeed(app, aliceURL)
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/rss+xml") {
		t.Errorf("Content-Type = %q", ct)
	}
	items := feedItems(t, rr)
	if len(items) != 2 {
		t.Fatalf("alice's feed has %d items, want 2", len(items))
	}
	for _, it := range items {
		if it.GUID.Value != aliceIDs[0] && it.GUID.Value != aliceIDs[1] {
			t.Errorf("foreign episode %s in alice's feed", it.GUID.Value)
		}
		if it.Enclosure.URL != "https://gct.example/api/podcast/"+it.GUID.Value+".mp3" || it.Enclosure.Type != "audio/mpeg" {
			t.Errorf("enclosure = %+v", it.Enclosure)
		}
		info, err := os.Stat(filepath.Join(podcastDir, it.GUID.Value+".mp3"))
		if err != nil || info.Size() != it.Enclosure.Length {
			t.Errorf("enclosure length %d does not match file (%v)", it.Enclosure.Length, err)
		}
		if !strings.HasPrefix(it.Title, "Konjunktionen - ") {
			t.Errorf("title = %q", it.Title)
		}
	}
	if items := feedItems(t, getFeed(app, feedURLFor(t, app, bob.ID, false))); len(items) != 1 {
		t.Errorf("bob's feed has %d items, want 1", len(items))
	}

	// Missing files and episodes past retention are not listed.
	os.Remove(filepath.Join(podcastDir, aliceIDs[0]+".mp3"))
	old := newPodcastID()
	os.WriteFile(filepath.Join(podcastDir, old+".mp3"), []byte("x"), 0o644)
	store.CreatePodcastEpisode(&storage.PodcastEpisode{ID: old, UserID: alice.ID, TopicID: "t1", Title: "Old", SizeBytes: 1, CreatedAt: time.Now().Add(-podcastMaxAge - time.Hour)})
	items = feedItems(t, getFeed(app, aliceURL))
	if len(items) != 1 || items[0].GUID.Value != aliceIDs[1] {
		t.Errorf("after removal feed = %+v, want only %s", items, aliceIDs[1])
	}

	// A cross-site form POST (no JSON content type) cannot rotate the token.
	formRR := httptest.NewRecorder()
	formReq := httptest.NewRequest(http.MethodPost, "/api/podcast/feed/regenerate", strings.NewReader("x=1"))
	formReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	app.handlePodcastFeedRegenerate(formRR, asUser(formReq, alice.ID))
	if formRR.Code != http.StatusUnsupportedMediaType {
		t.Errorf("form POST status %d, want 415", formRR.Code)
	}

	// Regenerating kills the old URL.
	newURL := feedURLFor(t, app, alice.ID, true)
	if newURL == aliceURL {
		t.Fatal("regenerate returned the same URL")
	}
	if rr := getFeed(app, aliceURL); rr.Code != http.StatusNotFound {
		t.Errorf("old feed url status %d, want 404", rr.Code)
	}
	if items := feedItems(t, getFeed(app, newURL)); len(items) != 1 {
		t.Errorf("new feed has %d items, want 1", len(items))
	}

	for _, path := range []string{"/podcast/feed/" + newPodcastID() + ".xml", "/podcast/feed/nope.xml", "/podcast/feed/"} {
		rr := httptest.NewRecorder()
		app.handlePodcastFeed(rr, httptest.NewRequest(http.MethodGet, path, nil))
		if rr.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", path, rr.Code)
		}
	}

	if err := store.DeletePodcastEpisodesBefore(time.Now().Add(-podcastMaxAge)); err != nil {
		t.Fatal(err)
	}
	left, _ := store.ListPodcastEpisodes(alice.ID, time.Time{})
	if len(left) != 2 {
		t.Errorf("after pruning alice has %d rows, want 2 (the expired one deleted)", len(left))
	}
}

func listEpisodes(t *testing.T, app *App, userID, topicID string) []podcastResponse {
	t.Helper()
	rr := httptest.NewRecorder()
	app.handlePodcastEpisodes(rr, asUser(httptest.NewRequest(http.MethodGet, "/api/podcast/episodes?topic_id="+topicID, nil), userID))
	if rr.Code != http.StatusOK {
		t.Fatalf("episodes status %d: %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Episodes []podcastResponse `json:"episodes"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	return resp.Episodes
}

func TestPodcastEpisodesListsWholeSubtree(t *testing.T) {
	app, mock, _ := setupPodcastTest(t, 30)
	store, err := storage.NewSQLiteStorage(filepath.Join(t.TempDir(), "episodes.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	mock.Storage = store
	mock.descendants = map[string][]string{"t1": {"t1-child"}}

	alice, _ := store.CreateUser("g-alice")
	bob, _ := store.CreateUser("g-bob")
	var built []podcastResponse
	for i := 0; i < 2; i++ {
		rr, resp := postPodcast(t, app, alice.ID)
		if rr.Code != http.StatusOK {
			t.Fatalf("build status %d: %s", rr.Code, rr.Body.String())
		}
		built = append(built, resp)
	}
	if built[0].ID == built[1].ID {
		t.Fatal("two builds returned the same episode")
	}
	addEpisode := func(userID, topicID, title string, age time.Duration) string {
		id := newPodcastID()
		os.WriteFile(filepath.Join(podcastDir, id+".mp3"), []byte("x"), 0o644)
		store.CreatePodcastEpisode(&storage.PodcastEpisode{ID: id, UserID: userID, TopicID: topicID, Title: title, SizeBytes: 1, PhraseCount: 3, CreatedAt: time.Now().Add(-age)})
		return id
	}
	child := addEpisode(alice.ID, "t1-child", "Weil", time.Hour)
	addEpisode(alice.ID, "other", "Other", time.Hour)
	addEpisode(bob.ID, "t1", "Bob's", time.Hour)
	addEpisode(alice.ID, "t1", "Expired", podcastMaxAge+time.Hour)

	got := listEpisodes(t, app, alice.ID, "t1")
	if len(got) != 3 {
		t.Fatalf("t1 lists %d episodes, want 3: %+v", len(got), got)
	}
	// Newest first; built episodes keep their transcript.
	if got[0].ID != built[1].ID || got[1].ID != built[0].ID || got[2].ID != child {
		t.Errorf("order = %s %s %s, want %s %s %s", got[0].ID, got[1].ID, got[2].ID, built[1].ID, built[0].ID, child)
	}
	if len(got[0].Phrases) != len(built[1].Phrases) || got[0].Phrases[0] != built[1].Phrases[0] {
		t.Errorf("stored transcript differs from the built one")
	}
	if got[0].RecallRepeats != built[1].RecallRepeats || got[0].DurationSeconds != built[1].DurationSeconds || got[0].DownloadURL != built[1].DownloadURL {
		t.Errorf("stored episode %+v differs from built %+v", got[0], built[1])
	}
	if got[2].TopicName != "Weil" || got[2].TopicID != "t1-child" || got[2].Phrases == nil || got[2].PhraseCount != 3 {
		t.Errorf("child episode = %+v", got[2])
	}

	if got := listEpisodes(t, app, alice.ID, "t1-child"); len(got) != 1 || got[0].ID != child {
		t.Errorf("child topic lists %+v, want only %s", got, child)
	}
	if got := listEpisodes(t, app, bob.ID, "t1"); len(got) != 1 || got[0].TopicName != "Bob's" {
		t.Errorf("bob lists %+v, want only his own", got)
	}

	// A deleted file drops the episode from the list.
	os.Remove(filepath.Join(podcastDir, built[0].ID+".mp3"))
	if got := listEpisodes(t, app, alice.ID, "t1"); len(got) != 2 {
		t.Errorf("after removal t1 lists %d episodes, want 2", len(got))
	}
}

func TestPodcastFeedDisabledWithoutPublicBaseURL(t *testing.T) {
	app := &App{}
	rr := httptest.NewRecorder()
	app.handlePodcastFeedURL(rr, asUser(httptest.NewRequest(http.MethodGet, "/api/podcast/feed", nil), "u"))
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("status %d, want 503", rr.Code)
	}
}

func TestPublicOrigin(t *testing.T) {
	for in, want := range map[string]string{
		"https://gct.example/auth/google/callback": "https://gct.example",
		"https://gct.example:8443/":                "https://gct.example:8443",
		" https://gct.example ":                    "https://gct.example",
		"gct.example":                              "",
		"":                                         "",
	} {
		if got := PublicOrigin(in); got != want {
			t.Errorf("PublicOrigin(%q) = %q, want %q", in, got, want)
		}
	}
}
