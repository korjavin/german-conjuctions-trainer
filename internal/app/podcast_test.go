package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	mrand "math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"german-conjunctions-trainer/pkg/storage"
)

// MPEG1 Layer III, 128 kbps, 44.1 kHz, mono, no CRC — what ElevenLabs sends.
var testMP3Header = []byte{0xFF, 0xFB, 0x90, 0xC4}

const testMP3FrameLen = 417 // 144*128000/44100

// fakeMP3 builds a structurally valid MP3 stream of n audio frames, with an
// optional ID3v2 tag, Xing/Info frame and trailing ID3v1 tag.
func fakeMP3(n int, withTags bool) []byte {
	var buf bytes.Buffer
	if withTags {
		buf.Write([]byte{'I', 'D', '3', 3, 0, 0, 0, 0, 0, 10})
		buf.Write(make([]byte, 10))
		info := make([]byte, testMP3FrameLen)
		copy(info, testMP3Header)
		copy(info[4+17:], "Info")
		buf.Write(info)
	}
	for i := 0; i < n; i++ {
		frame := bytes.Repeat([]byte{0x55}, testMP3FrameLen)
		copy(frame, testMP3Header)
		buf.Write(frame)
	}
	if withTags {
		tag := make([]byte, 128)
		copy(tag, "TAG")
		buf.Write(tag)
	}
	return buf.Bytes()
}

func TestParseMP3StripsTagsAndInfoFrame(t *testing.T) {
	clip, err := parseMP3(fakeMP3(10, true))
	if err != nil {
		t.Fatal(err)
	}
	if clip.frameCount != 10 {
		t.Errorf("frameCount = %d, want 10", clip.frameCount)
	}
	if len(clip.frames) != 10*testMP3FrameLen {
		t.Errorf("frames bytes = %d, want %d", len(clip.frames), 10*testMP3FrameLen)
	}
	if bytes.Contains(clip.frames, []byte("Info")) || bytes.Contains(clip.frames, []byte("TAG")) {
		t.Error("metadata leaked into audio frames")
	}
	samples := 10 * 1152
	want := time.Duration(float64(samples) / 44100 * float64(time.Second))
	if clip.duration() != want {
		t.Errorf("duration = %v, want %v", clip.duration(), want)
	}
}

func TestParseMP3RejectsNonAudio(t *testing.T) {
	if _, err := parseMP3([]byte("<html>not audio</html>")); err == nil {
		t.Error("expected error for non-MP3 data")
	}
}

func TestMP3BuilderSilenceAndClips(t *testing.T) {
	clip, err := parseMP3(fakeMP3(5, false))
	if err != nil {
		t.Fatal(err)
	}
	b := newMP3Builder(clip)
	if err := b.addClip(clip); err != nil {
		t.Fatal(err)
	}
	b.addSilence(time.Second) // round(44100/1152) = 38 frames
	if err := b.addClip(clip); err != nil {
		t.Fatal(err)
	}

	out, err := parseMP3(b.bytes())
	if err != nil {
		t.Fatal(err)
	}
	if out.frameCount != 5+38+5 {
		t.Errorf("frameCount = %d, want 48", out.frameCount)
	}
	if b.duration() != out.duration() {
		t.Errorf("builder duration %v != parsed %v", b.duration(), out.duration())
	}
	silent := b.bytes()[5*testMP3FrameLen : 6*testMP3FrameLen]
	if !bytes.Equal(silent[:4], testMP3Header) {
		t.Errorf("silent frame header = % x, want % x", silent[:4], testMP3Header)
	}
	if !bytes.Equal(silent[4:], make([]byte, testMP3FrameLen-4)) {
		t.Error("silent frame body must be all zeros")
	}
}

func TestPodcastWeightOrdering(t *testing.T) {
	unseen := podcastWeight(nil)
	struggling := podcastWeight(&storage.UserExerciseView{TotalAttempts: 4, FailedAttempts: 3})
	mastered := podcastWeight(&storage.UserExerciseView{TotalAttempts: 6, SuccessfulAttempts: 6, RepetitionCounter: 6})
	if !(struggling > unseen && unseen > mastered) {
		t.Errorf("want struggling > unseen > mastered, got %.2f, %.2f, %.2f", struggling, unseen, mastered)
	}
	if mastered <= 0 {
		t.Error("mastered phrases must still have a chance")
	}
	if !isWeakPhrase(&storage.UserExerciseView{TotalAttempts: 3, FailedAttempts: 2}) {
		t.Error("2 of 3 failed should be weak")
	}
	if isWeakPhrase(&storage.UserExerciseView{TotalAttempts: 10, FailedAttempts: 2, RepetitionCounter: 4}) {
		t.Error("phrase on a success streak should not be weak")
	}
}

func testPhraseExercise(id string) *storage.Exercise {
	return &storage.Exercise{
		ID:           id,
		TopicID:      "t1",
		ExerciseJSON: fmt.Sprintf(`{"english_hint":"English %s","correct_german_sentence":"Deutsch %s."}`, id, id),
	}
}

func TestPodcastPoolSkipsHiddenInvalidAndDuplicates(t *testing.T) {
	dup := testPhraseExercise("a")
	dup.ID = "a2"
	exercises := []*storage.Exercise{
		testPhraseExercise("a"),
		dup,
		testPhraseExercise("hidden"),
		{ID: "broken", ExerciseJSON: `{"english_hint":"only english"}`},
		testPhraseExercise("b"),
	}
	views := map[string]*storage.UserExerciseView{"hidden": {IsHidden: true}}
	pool, poolViews := podcastPool(exercises, views)
	if len(pool) != 2 || pool[0].ExerciseID != "a" || pool[1].ExerciseID != "b" {
		t.Fatalf("pool = %+v, want phrases a and b", pool)
	}
	if len(poolViews) != len(pool) {
		t.Errorf("views not aligned with pool: %d vs %d", len(poolViews), len(pool))
	}
}

func TestSelectPodcastPhrasesPrefersWeakOverMastered(t *testing.T) {
	var phrases []podcastPhrase
	var views []*storage.UserExerciseView
	for i := 0; i < 50; i++ {
		phrases = append(phrases, podcastPhrase{ExerciseID: fmt.Sprint(i), German: fmt.Sprint("de", i), English: fmt.Sprint("en", i)})
		if i < 25 {
			views = append(views, &storage.UserExerciseView{TotalAttempts: 5, FailedAttempts: 4})
		} else {
			views = append(views, &storage.UserExerciseView{TotalAttempts: 8, SuccessfulAttempts: 8, RepetitionCounter: 8})
		}
	}
	rng := mrand.New(mrand.NewSource(1))
	weakPicks, trials := 0, 200
	for i := 0; i < trials; i++ {
		selected := selectPodcastPhrases(phrases, views, 10, rng)
		if len(selected) != 10 {
			t.Fatalf("selected %d phrases, want 10", len(selected))
		}
		seen := map[string]bool{}
		for _, p := range selected {
			if seen[p.ExerciseID] {
				t.Fatalf("phrase %s selected twice", p.ExerciseID)
			}
			seen[p.ExerciseID] = true
			if p.Weak {
				weakPicks++
			}
		}
	}
	if share := float64(weakPicks) / float64(trials*10); share < 0.8 {
		t.Errorf("weak phrases were %.0f%% of picks, want >= 80%%", share*100)
	}
}

func TestSelectPodcastPhrasesGuestIsUniformWithoutWeak(t *testing.T) {
	phrases := []podcastPhrase{{German: "a"}, {German: "b"}, {German: "c"}}
	selected := selectPodcastPhrases(phrases, nil, 25, mrand.New(mrand.NewSource(1)))
	if len(selected) != 3 {
		t.Fatalf("selected %d, want all 3 when pool is smaller than n", len(selected))
	}
	for _, p := range selected {
		if p.Weak {
			t.Error("guests have no stats, nothing may be weak")
		}
	}
}

func TestBuildPodcastPlanStructure(t *testing.T) {
	var phrases []podcastPhrase
	for i := 0; i < 8; i++ {
		phrases = append(phrases, podcastPhrase{English: fmt.Sprint("en", i), German: fmt.Sprint("de", i), Weak: i < 7})
	}
	steps := buildPodcastPlan(phrases, mrand.New(mrand.NewSource(3)))

	var partBreak int
	for i, s := range steps {
		if s.Pause == podcastBetweenParts {
			partBreak = i
		}
	}
	part1, part2 := steps[:partBreak], steps[partBreak+1:]

	// Part 1 keeps phrase order and says EN, DE, DE for each.
	var spoken []string
	for _, s := range part1 {
		if s.Text != "" {
			if s.Recall {
				t.Fatal("no recall gaps in part 1")
			}
			spoken = append(spoken, s.Text)
		}
	}
	if len(spoken) != 3*len(phrases) {
		t.Fatalf("part 1 has %d clips, want %d", len(spoken), 3*len(phrases))
	}
	for i, p := range phrases {
		if spoken[3*i] != p.English || spoken[3*i+1] != p.German || spoken[3*i+2] != p.German {
			t.Errorf("phrase %d part 1 = %v", i, spoken[3*i:3*i+3])
		}
	}

	// Part 2: EN, recall gap, DE per item; all phrases plus at most 5 repeats.
	recalls := map[string]int{}
	var order []string
	for i, s := range part2 {
		if s.Recall {
			if part2[i-1].Lang != "en" || part2[i+1].Text != s.Text || part2[i+1].Recall {
				t.Fatalf("recall gap at %d not framed by EN and DE clips", i)
			}
			recalls[s.Text]++
			order = append(order, s.Text)
		}
	}
	extra := len(order) - len(phrases)
	if extra != podcastMaxRecallRepeats {
		t.Errorf("repeats = %d, want %d (7 weak phrases, capped)", extra, podcastMaxRecallRepeats)
	}
	for i, p := range phrases {
		if recalls[p.German] < 1 || (!p.Weak && recalls[p.German] != 1) {
			t.Errorf("phrase %d recalled %d times", i, recalls[p.German])
		}
	}
	for i := 1; i < len(order); i++ {
		if order[i] == order[i-1] {
			t.Errorf("phrase %s recalled twice in a row", order[i])
		}
	}
}

func TestRecallPauseScalesWithSentence(t *testing.T) {
	if got := recallPause(500 * time.Millisecond); got != podcastRecallMinPause {
		t.Errorf("short sentence pause = %v, want minimum %v", got, podcastRecallMinPause)
	}
	if got := recallPause(4 * time.Second); got != 7500*time.Millisecond {
		t.Errorf("4s sentence pause = %v, want 7.5s", got)
	}
}

func TestPodcastFileSlug(t *testing.T) {
	cases := map[string]string{
		"Verben mit Präpositionen": "verben-mit-praepositionen",
		"weil / dass / ob":         "weil-dass-ob",
		"Straße":                   "strasse",
		"../../etc/passwd":         "etc-passwd",
		"???":                      "german",
	}
	for in, want := range cases {
		if got := podcastFileSlug(in); got != want {
			t.Errorf("podcastFileSlug(%q) = %q, want %q", in, got, want)
		}
	}
}

// setupPodcastTest runs the handler in a temp working dir with fake TTS
// (every clip is a 20-frame MP3) and a fake LLM generator.
func setupPodcastTest(t *testing.T, cached int) (*App, *mockStorage, *int) {
	t.Helper()
	wd, _ := os.Getwd()
	dir := t.TempDir()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chdir(wd) })
	os.MkdirAll("audio_cache", 0o755)

	app, mock := setupTestAppWithMock(t)
	topic := &storage.Topic{ID: "t1", Name: "Konjunktionen", Prompt: "p"}
	mock.topics["t1"] = topic
	hash := storage.GetPromptHash(topic.Prompt)
	for i := 0; i < cached; i++ {
		ex := testPhraseExercise(fmt.Sprint("c", i))
		ex.PromptHash = hash
		mock.exercises = append(mock.exercises, ex)
	}

	clip := fakeMP3(20, true)
	app.ttsAudio = func(_ context.Context, text, lang string) (string, error) {
		path := filepath.Join("audio_cache", fmt.Sprintf("%x.mp3", []byte(lang+text)))
		return path, writeFileAtomic(path, clip)
	}
	generated := 0
	app.generateExercises = func(topic *storage.Topic, _ string) ([]*storage.Exercise, error) {
		var out []*storage.Exercise
		for i := 0; i < 10; i++ {
			generated++
			ex := testPhraseExercise(fmt.Sprint("g", generated))
			ex.PromptHash = storage.GetPromptHash(topic.Prompt)
			out = append(out, ex)
		}
		return out, nil
	}
	return app, mock, &generated
}

// writeFileAtomic lets parallel fake builds share clip files safely.
func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".fake-*")
	if err != nil {
		return err
	}
	tmp.Write(data)
	tmp.Close()
	return os.Rename(tmp.Name(), path)
}

func postPodcast(t *testing.T, app *App, userID string) (*httptest.ResponseRecorder, podcastResponse) {
	t.Helper()
	return postPodcastFrom(t, app, userID, "192.0.2.1:1234")
}

func postPodcastFrom(t *testing.T, app *App, userID, remoteAddr string) (*httptest.ResponseRecorder, podcastResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/podcast", strings.NewReader(`{"topic_id":"t1"}`))
	req.RemoteAddr = remoteAddr
	if userID != "" {
		req = req.WithContext(context.WithValue(req.Context(), userContextKey, userID))
	}
	rr := httptest.NewRecorder()
	app.handlePodcast(rr, req)
	var resp podcastResponse
	json.Unmarshal(rr.Body.Bytes(), &resp)
	return rr, resp
}

func TestHandlePodcastBuildsEpisode(t *testing.T) {
	app, mock, generated := setupPodcastTest(t, 40)
	mock.userViews = map[string]*storage.UserExerciseView{
		"c0": {IsHidden: true},
		"c1": {TotalAttempts: 3, FailedAttempts: 3},
	}

	rr, resp := postPodcast(t, app, "user1")
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	if *generated != 0 {
		t.Errorf("generated %d exercises although 39 were cached", *generated)
	}
	if len(resp.Phrases) != podcastPhraseCount {
		t.Errorf("phrases = %d, want %d", len(resp.Phrases), podcastPhraseCount)
	}
	for _, p := range resp.Phrases {
		if p.ExerciseID == "c0" {
			t.Error("hidden exercise ended up in the podcast")
		}
	}
	// Fake clips are 0.5s; pauses alone add ~3 minutes for 25 phrases.
	if resp.DurationSeconds < 3*60 {
		t.Errorf("duration %ds is implausibly short for 25 phrases", resp.DurationSeconds)
	}

	// The episode file is served with Range support and a download name.
	fileReq := httptest.NewRequest(http.MethodGet, resp.DownloadURL, nil)
	fileRR := httptest.NewRecorder()
	app.handlePodcastFile(fileRR, fileReq)
	if fileRR.Code != http.StatusOK {
		t.Fatalf("file status %d", fileRR.Code)
	}
	if ct := fileRR.Header().Get("Content-Type"); ct != "audio/mpeg" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cd := fileRR.Header().Get("Content-Disposition"); !strings.Contains(cd, "podcast-konjunktionen-") {
		t.Errorf("Content-Disposition = %q", cd)
	}
	clip, err := parseMP3(fileRR.Body.Bytes())
	if err != nil {
		t.Fatalf("served file is not MP3: %v", err)
	}
	if got := int(clip.duration().Round(time.Second).Seconds()); got != resp.DurationSeconds {
		t.Errorf("file duration %ds != reported %ds", got, resp.DurationSeconds)
	}
}

func TestHandlePodcastGeneratesWhenTopicIsSmall(t *testing.T) {
	app, _, generated := setupPodcastTest(t, 4)
	rr, resp := postPodcast(t, app, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	if *generated != 30 { // 4 cached + 3 rounds of 10 until >= 25
		t.Errorf("generated %d, want 30", *generated)
	}
	if len(resp.Phrases) != podcastPhraseCount {
		t.Errorf("phrases = %d, want %d", len(resp.Phrases), podcastPhraseCount)
	}
	if resp.RecallRepeats != 0 {
		t.Errorf("guest episode has %d repeats, want 0", resp.RecallRepeats)
	}
}

func TestHandlePodcastFileRejectsBadIDs(t *testing.T) {
	app := &App{}
	for _, path := range []string{"/api/podcast/../../app.db", "/api/podcast/xyz.mp3", "/api/podcast/"} {
		rr := httptest.NewRecorder()
		app.handlePodcastFile(rr, httptest.NewRequest(http.MethodGet, path, nil))
		if rr.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", path, rr.Code)
		}
	}
}

func TestPodcastRateLimitsRepeatedRequests(t *testing.T) {
	app, _, _ := setupPodcastTest(t, 30)

	// Guests: podcastGuestBurst builds per IP, then 429 with Retry-After.
	for i := 0; i < podcastGuestBurst; i++ {
		if rr, _ := postPodcastFrom(t, app, "", "198.51.100.7:5000"); rr.Code != http.StatusOK {
			t.Fatalf("guest build %d: status %d: %s", i+1, rr.Code, rr.Body.String())
		}
	}
	rr, _ := postPodcastFrom(t, app, "", "198.51.100.7:5001")
	if rr.Code != http.StatusTooManyRequests || !strings.Contains(rr.Body.String(), "PODCAST_RATE_LIMITED") {
		t.Fatalf("guest over limit: status %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Error("429 without Retry-After")
	}

	// A spoofed X-Forwarded-For first hop does not buy a fresh bucket: the
	// proxy-appended last hop is what counts.
	req := httptest.NewRequest(http.MethodPost, "/api/podcast", strings.NewReader(`{"topic_id":"t1"}`))
	req.Header.Set("X-Forwarded-For", "203.0.113.99, 198.51.100.7")
	spoofed := httptest.NewRecorder()
	app.handlePodcast(spoofed, req)
	if spoofed.Code != http.StatusTooManyRequests {
		t.Errorf("spoofed XFF: status %d, want 429", spoofed.Code)
	}

	// Another guest still gets through, until the shared guest bucket runs dry.
	if rr, _ := postPodcastFrom(t, app, "", "198.51.100.8:5000"); rr.Code != http.StatusOK {
		t.Errorf("other guest: status %d", rr.Code)
	}
	guestBuilds := podcastGuestBurst + 1
	for ip := 9; guestBuilds < podcastAllGuestsBurst; ip++ {
		if rr, _ := postPodcastFrom(t, app, "", fmt.Sprintf("198.51.100.%d:5000", ip)); rr.Code == http.StatusOK {
			guestBuilds++
		}
	}
	if rr, _ := postPodcastFrom(t, app, "", "198.51.100.200:5000"); rr.Code != http.StatusTooManyRequests {
		t.Errorf("fresh IP after all-guests bucket is empty: status %d, want 429", rr.Code)
	}

	// Logged-in users have their own, larger bucket.
	for i := 0; i < podcastUserBurst; i++ {
		if rr, _ := postPodcast(t, app, "user1"); rr.Code != http.StatusOK {
			t.Fatalf("user build %d: status %d", i+1, rr.Code)
		}
	}
	if rr, _ := postPodcast(t, app, "user1"); rr.Code != http.StatusTooManyRequests {
		t.Errorf("user over limit: status %d, want 429", rr.Code)
	}
	if rr, _ := postPodcast(t, app, "user2"); rr.Code != http.StatusOK {
		t.Errorf("other user: status %d", rr.Code)
	}
}

func TestPodcastConcurrentBuildsAreCapped(t *testing.T) {
	app, _, _ := setupPodcastTest(t, 30)
	realTTS := app.ttsAudio
	release := make(chan struct{})
	app.ttsAudio = func(ctx context.Context, text, lang string) (string, error) {
		select {
		case <-release:
		case <-ctx.Done():
			return "", ctx.Err()
		}
		return realTTS(ctx, text, lang)
	}

	codes := make(chan int, podcastMaxConcurrentBuilds)
	for i := 0; i < podcastMaxConcurrentBuilds; i++ {
		go func(i int) {
			rr, _ := postPodcast(t, app, fmt.Sprint("busy", i))
			codes <- rr.Code
		}(i)
	}
	deadline := time.Now().Add(5 * time.Second)
	for app.podcast.inFlight() < podcastMaxConcurrentBuilds {
		if time.Now().After(deadline) {
			t.Fatal("builds never took their slots")
		}
		time.Sleep(5 * time.Millisecond)
	}

	rr, _ := postPodcast(t, app, "late")
	if rr.Code != http.StatusTooManyRequests || !strings.Contains(rr.Body.String(), "PODCAST_BUSY") {
		t.Fatalf("build over capacity: status %d: %s", rr.Code, rr.Body.String())
	}

	close(release)
	for i := 0; i < podcastMaxConcurrentBuilds; i++ {
		if code := <-codes; code != http.StatusOK {
			t.Errorf("blocked build finished with %d", code)
		}
	}
	if n := app.podcast.inFlight(); n != 0 {
		t.Errorf("%d slots still held after builds finished", n)
	}
	// The late user was turned away before spending a token, so a retry works.
	if rr, _ := postPodcast(t, app, "late"); rr.Code != http.StatusOK {
		t.Errorf("retry after capacity freed: status %d", rr.Code)
	}
}

func TestPodcastStalledTTSReleasesSlot(t *testing.T) {
	app, _, _ := setupPodcastTest(t, 30)
	app.podcast.buildTimeout = 100 * time.Millisecond
	var cancelled int32
	var mu sync.Mutex
	app.ttsAudio = func(ctx context.Context, text, lang string) (string, error) {
		<-ctx.Done() // a stalled upstream
		mu.Lock()
		cancelled++
		mu.Unlock()
		return "", ctx.Err()
	}

	started := time.Now()
	rr, _ := postPodcast(t, app, "user1")
	if rr.Code != http.StatusGatewayTimeout {
		t.Fatalf("status %d, want 504: %s", rr.Code, rr.Body.String())
	}
	if elapsed := time.Since(started); elapsed > 3*time.Second {
		t.Errorf("stalled build took %v to give up", elapsed)
	}
	if cancelled == 0 {
		t.Error("TTS calls never saw the cancellation")
	}
	if cancelled > podcastTTSConcurrency {
		t.Errorf("%d TTS calls started after the deadline, want at most %d in flight", cancelled, podcastTTSConcurrency)
	}
	if n := app.podcast.inFlight(); n != 0 {
		t.Errorf("%d slots still held after timeout", n)
	}
}

func TestPodcastSurvivesAudioCacheCleanup(t *testing.T) {
	app, _, _ := setupPodcastTest(t, 30)
	rr, resp := postPodcast(t, app, "user1")
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	if time.Until(resp.ExpiresAt) < podcastMaxAge-time.Minute {
		t.Errorf("expires_at %v, want ~%v from now", resp.ExpiresAt, podcastMaxAge)
	}

	// Push the TTS cache over its cap with older clips, so LRU eviction runs.
	old := time.Now().Add(-time.Hour)
	for i := 0; i < 3; i++ {
		path := filepath.Join("audio_cache", fmt.Sprintf("filler%d.mp3", i))
		os.WriteFile(path, make([]byte, 1<<20), 0o644)
		os.Chtimes(path, old, old)
	}
	episode := filepath.Join(podcastDir, resp.ID+".mp3")
	os.Chtimes(episode, old.Add(-time.Hour), old.Add(-time.Hour)) // oldest file of all
	app.ElevenLabs.AudioCacheMaxSizeMB = 1
	app.cleanupAudioCache()

	if _, err := os.Stat(filepath.Join("audio_cache", "filler0.mp3")); err == nil {
		t.Fatal("cleanup did not run: filler clip still present")
	}
	fileRR := httptest.NewRecorder()
	app.handlePodcastFile(fileRR, httptest.NewRequest(http.MethodGet, resp.URL, nil))
	if fileRR.Code != http.StatusOK {
		t.Fatalf("episode after cache cleanup: status %d", fileRR.Code)
	}
	cc := fileRR.Header().Get("Cache-Control")
	if !strings.Contains(cc, "max-age=") || strings.Contains(cc, "max-age=604800") {
		t.Errorf("Cache-Control %q should carry the remaining lifetime", cc)
	}
}

func TestPodcastExpiresAfterRetention(t *testing.T) {
	app, _, _ := setupPodcastTest(t, 30)
	rr, resp := postPodcast(t, app, "user1")
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	episode := filepath.Join(podcastDir, resp.ID+".mp3")
	expired := time.Now().Add(-podcastMaxAge - time.Minute)
	os.Chtimes(episode, expired, expired)

	fileRR := httptest.NewRecorder()
	app.handlePodcastFile(fileRR, httptest.NewRequest(http.MethodGet, resp.URL, nil))
	if fileRR.Code != http.StatusNotFound {
		t.Errorf("expired episode: status %d, want 404", fileRR.Code)
	}
	podcastStoreSize()
	if _, err := os.Stat(episode); !os.IsNotExist(err) {
		t.Error("expired episode was not pruned")
	}
}

func TestPodcastRefusedWhenStoreIsFull(t *testing.T) {
	app, _, generated := setupPodcastTest(t, 4)
	app.podcast.storeMaxBytes = podcastEstimatedBytes + 1<<20
	os.MkdirAll(podcastDir, 0o755)
	os.WriteFile(filepath.Join(podcastDir, "0123456789abcdef0123456789abcdef.mp3"), make([]byte, 2<<20), 0o644)

	rr, _ := postPodcast(t, app, "user1")
	if rr.Code != http.StatusServiceUnavailable || !strings.Contains(rr.Body.String(), "PODCAST_STORAGE_FULL") {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	if *generated != 0 {
		t.Errorf("generated %d exercises for a build that was refused", *generated)
	}
	// Existing episodes are kept, not evicted to make room.
	if _, err := os.Stat(filepath.Join(podcastDir, "0123456789abcdef0123456789abcdef.mp3")); err != nil {
		t.Error("existing episode was evicted")
	}
}
