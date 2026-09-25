package app

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	mrand "math/rand"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"german-conjunctions-trainer/pkg/llm"
	"german-conjunctions-trainer/pkg/storage"
)

// Podcast mode: a Glossika-style listening episode built from a topic subtree.
//
//	Part 1 (introduce): EN → DE → DE for every phrase.
//	Part 2 (recall):    EN → silence to say it yourself → DE, reshuffled;
//	                    phrases the user struggles with come back a second time.
//
// Listening does not touch SRS stats.

const (
	podcastPhraseCount = 25
	// podcastMaxRecallRepeats caps how many weak phrases get a second recall.
	podcastMaxRecallRepeats = 5
	// podcastMaxGenerationRounds bounds LLM calls when the subtree is small.
	podcastMaxGenerationRounds = 3
	podcastTTSConcurrency      = 3
	podcastDir                 = "audio_cache/podcasts"
	podcastMaxAge              = 7 * 24 * time.Hour

	podcastLeadIn         = 500 * time.Millisecond
	podcastAfterEnglish   = 700 * time.Millisecond
	podcastBetweenGerman  = 1000 * time.Millisecond
	podcastAfterPhrase    = 2000 * time.Millisecond
	podcastBetweenParts   = 4000 * time.Millisecond
	podcastRecallFactor   = 1.5
	podcastRecallExtra    = 1500 * time.Millisecond
	podcastRecallMinPause = 3000 * time.Millisecond
)

var (
	podcastIDPattern       = regexp.MustCompile(`^[0-9a-f]{32}$`)
	podcastFileNameUnsafe  = regexp.MustCompile(`[^a-z0-9]+`)
	podcastGermanTranslits = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss")
)

type podcastPhrase struct {
	ExerciseID string `json:"exercise_id"`
	English    string `json:"english"`
	German     string `json:"german"`
	// Weak phrases are recalled twice in part 2.
	Weak bool `json:"weak"`
}

// podcastStep is one element of the episode timeline: a spoken clip, a fixed
// pause, or a recall gap sized from the German clip of the phrase.
type podcastStep struct {
	Text   string
	Lang   string
	Pause  time.Duration
	Recall bool
}

// podcastWeight is how likely a phrase is to be picked for an episode:
// unseen = 1, frequent mistakes push it up, a growing SRS streak pushes it
// down. Hidden exercises never reach this function.
func podcastWeight(view *storage.UserExerciseView) float64 {
	if view == nil || view.TotalAttempts == 0 {
		return 1
	}
	failRate := float64(view.FailedAttempts) / float64(view.TotalAttempts)
	w := (1 + 3*failRate) / (1 + 0.5*float64(view.RepetitionCounter))
	if view.IsFavorite {
		w *= 1.5
	}
	return math.Max(w, 0.05)
}

// isWeakPhrase marks phrases worth a second recall: failed on at least a
// third of the attempts and not yet on a success streak.
func isWeakPhrase(view *storage.UserExerciseView) bool {
	if view == nil || view.FailedAttempts == 0 || view.TotalAttempts == 0 {
		return false
	}
	return view.RepetitionCounter <= 1 && float64(view.FailedAttempts)/float64(view.TotalAttempts) >= 1.0/3
}

func parsePodcastPhrase(ex *storage.Exercise) (podcastPhrase, bool) {
	var data struct {
		EnglishHint           string `json:"english_hint"`
		CorrectGermanSentence string `json:"correct_german_sentence"`
	}
	if err := json.Unmarshal([]byte(ex.ExerciseJSON), &data); err != nil {
		return podcastPhrase{}, false
	}
	en := strings.TrimSpace(data.EnglishHint)
	de := strings.TrimSpace(data.CorrectGermanSentence)
	if en == "" || de == "" {
		return podcastPhrase{}, false
	}
	return podcastPhrase{ExerciseID: ex.ID, English: en, German: de}, true
}

// podcastPool turns exercises into phrases, dropping unparsable ones,
// exercises the user hid, and duplicate German sentences.
func podcastPool(exercises []*storage.Exercise, views map[string]*storage.UserExerciseView) ([]podcastPhrase, []*storage.UserExerciseView) {
	seen := make(map[string]bool)
	var phrases []podcastPhrase
	var phraseViews []*storage.UserExerciseView
	for _, ex := range exercises {
		view := views[ex.ID]
		if view != nil && view.IsHidden {
			continue
		}
		p, ok := parsePodcastPhrase(ex)
		if !ok || seen[p.German] {
			continue
		}
		seen[p.German] = true
		phrases = append(phrases, p)
		phraseViews = append(phraseViews, view)
	}
	return phrases, phraseViews
}

// selectPodcastPhrases picks up to n phrases. Without user stats (guests)
// the pick is uniform; otherwise it is weighted by podcastWeight using
// Efraimidis–Spirakis sampling without replacement.
func selectPodcastPhrases(phrases []podcastPhrase, views []*storage.UserExerciseView, n int, rng *mrand.Rand) []podcastPhrase {
	type keyed struct {
		phrase podcastPhrase
		key    float64
	}
	items := make([]keyed, len(phrases))
	for i, p := range phrases {
		var view *storage.UserExerciseView
		if views != nil {
			view = views[i]
		}
		p.Weak = isWeakPhrase(view)
		// key = u^(1/w): the n largest keys are a weighted sample.
		items[i] = keyed{p, math.Pow(rng.Float64(), 1/podcastWeight(view))}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].key > items[j].key })
	if len(items) > n {
		items = items[:n]
	}
	selected := make([]podcastPhrase, len(items))
	for i, it := range items {
		selected[i] = it.phrase
	}
	rng.Shuffle(len(selected), func(i, j int) { selected[i], selected[j] = selected[j], selected[i] })
	return selected
}

// buildPodcastPlan lays out the episode timeline for the selected phrases.
func buildPodcastPlan(phrases []podcastPhrase, rng *mrand.Rand) []podcastStep {
	steps := []podcastStep{{Pause: podcastLeadIn}}

	for _, p := range phrases {
		steps = append(steps,
			podcastStep{Text: p.English, Lang: "en"},
			podcastStep{Pause: podcastAfterEnglish},
			podcastStep{Text: p.German, Lang: "de"},
			podcastStep{Pause: podcastBetweenGerman},
			podcastStep{Text: p.German, Lang: "de"},
			podcastStep{Pause: podcastAfterPhrase},
		)
	}
	steps = append(steps, podcastStep{Pause: podcastBetweenParts})

	recall := append([]podcastPhrase(nil), phrases...)
	rng.Shuffle(len(recall), func(i, j int) { recall[i], recall[j] = recall[j], recall[i] })
	var repeats []podcastPhrase
	for _, p := range recall {
		if p.Weak && len(repeats) < podcastMaxRecallRepeats {
			repeats = append(repeats, p)
		}
	}
	rng.Shuffle(len(repeats), func(i, j int) { repeats[i], repeats[j] = repeats[j], repeats[i] })
	// Never recall the same phrase twice in a row across the seam.
	if len(repeats) > 1 && repeats[0].German == recall[len(recall)-1].German {
		repeats[0], repeats[1] = repeats[1], repeats[0]
	}
	recall = append(recall, repeats...)

	for _, p := range recall {
		steps = append(steps,
			podcastStep{Text: p.English, Lang: "en"},
			podcastStep{Recall: true, Text: p.German, Lang: "de"},
			podcastStep{Text: p.German, Lang: "de"},
			podcastStep{Pause: podcastAfterPhrase},
		)
	}
	return steps
}

func recallPause(germanClip time.Duration) time.Duration {
	d := time.Duration(float64(germanClip)*podcastRecallFactor) + podcastRecallExtra
	if d < podcastRecallMinPause {
		d = podcastRecallMinPause
	}
	return d
}

type podcastClipKey struct{ text, lang string }

// fetchPodcastClips resolves and parses the EN and DE audio of every phrase,
// a few at a time. Clips that fail are left out of the map.
func (a *App) fetchPodcastClips(phrases []podcastPhrase) (map[podcastClipKey]*mp3Clip, error) {
	tts := a.ttsAudio
	if tts == nil {
		tts = a.ensureTTSAudio
	}

	var keys []podcastClipKey
	for _, p := range phrases {
		keys = append(keys, podcastClipKey{p.English, "en"}, podcastClipKey{p.German, "de"})
	}

	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		clips    = make(map[podcastClipKey]*mp3Clip)
		firstErr error
		sem      = make(chan struct{}, podcastTTSConcurrency)
	)
	for _, k := range keys {
		wg.Add(1)
		go func(k podcastClipKey) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			path, err := tts(k.text, k.lang)
			var clip *mp3Clip
			if err == nil {
				var data []byte
				data, err = os.ReadFile(path)
				if err == nil {
					clip, err = parseMP3(data)
				}
			}
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				log.Printf("[PODCAST] Skipping %s clip %q: %v", k.lang, k.text, err)
				if firstErr == nil {
					firstErr = err
				}
				return
			}
			clips[k] = clip
		}(k)
	}
	wg.Wait()
	if len(clips) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return clips, nil
}

// dropPhrasesWithoutAudio removes phrases whose EN or DE clip is missing.
func dropPhrasesWithoutAudio(phrases []podcastPhrase, clips map[podcastClipKey]*mp3Clip) []podcastPhrase {
	var kept []podcastPhrase
	for _, p := range phrases {
		if clips[podcastClipKey{p.English, "en"}] != nil && clips[podcastClipKey{p.German, "de"}] != nil {
			kept = append(kept, p)
		}
	}
	return kept
}

// renderPodcast stitches the plan into one MP3 stream.
func renderPodcast(steps []podcastStep, clips map[podcastClipKey]*mp3Clip) ([]byte, time.Duration, error) {
	var b *mp3Builder
	for _, s := range steps {
		if s.Text != "" && !s.Recall {
			b = newMP3Builder(clips[podcastClipKey{s.Text, s.Lang}])
			break
		}
	}
	if b == nil {
		return nil, 0, fmt.Errorf("podcast has no audio")
	}
	for _, s := range steps {
		switch {
		case s.Recall:
			b.addSilence(recallPause(clips[podcastClipKey{s.Text, s.Lang}].duration()))
		case s.Text != "":
			if err := b.addClip(clips[podcastClipKey{s.Text, s.Lang}]); err != nil {
				return nil, 0, err
			}
		default:
			b.addSilence(s.Pause)
		}
	}
	return b.bytes(), b.duration(), nil
}

func newPodcastID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(buf[:])
}

// cleanupOldPodcasts removes episodes older than podcastMaxAge.
func cleanupOldPodcasts() {
	entries, err := os.ReadDir(podcastDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		info, err := e.Info()
		if err == nil && time.Since(info.ModTime()) > podcastMaxAge {
			os.Remove(filepath.Join(podcastDir, e.Name()))
		}
	}
}

// podcastFileSlug makes an ASCII file name fragment ("verben-mit-praepositionen")
// from a topic name, or a download name the client passed back.
func podcastFileSlug(name string) string {
	slug := podcastGermanTranslits.Replace(strings.ToLower(name))
	slug = strings.Trim(podcastFileNameUnsafe.ReplaceAllString(slug, "-"), "-")
	if len(slug) > 60 {
		slug = strings.Trim(slug[:60], "-")
	}
	if slug == "" {
		slug = "german"
	}
	return slug
}

type podcastResponse struct {
	ID              string          `json:"id"`
	URL             string          `json:"url"`
	DownloadURL     string          `json:"download_url"`
	TopicName       string          `json:"topic_name"`
	DurationSeconds int             `json:"duration_seconds"`
	Phrases         []podcastPhrase `json:"phrases"`
	RecallRepeats   int             `json:"recall_repeats"`
}

// handlePodcast builds an episode: POST /api/podcast {"topic_id": "..."}.
func (a *App) handlePodcast(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed", "", false)
		return
	}
	started := time.Now()

	var req struct {
		TopicID string `json:"topic_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TopicID == "" {
		writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST_BODY", "topic_id is required", "", false)
		return
	}
	topic, err := a.DB.GetTopic(req.TopicID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "TOPIC_NOT_FOUND", "Topic not found", err.Error(), false)
		return
	}

	topicIDs, exercises, err := a.loadSubtreeExercises(topic)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "EXERCISE_LOOKUP_FAILED", "Failed to get exercises", err.Error(), false)
		return
	}

	userID := getUserIDFromRequest(r)
	var views map[string]*storage.UserExerciseView
	if userID != "" {
		views, err = a.DB.GetUserExerciseViews(userID)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "USER_VIEWS_LOOKUP_FAILED", "Failed to get user exercise views", err.Error(), false)
			return
		}
	}

	pool, poolViews := podcastPool(exercises, views)
	for round := 0; len(pool) < podcastPhraseCount && round < podcastMaxGenerationRounds; round++ {
		log.Printf("[PODCAST] Topic %s has %d phrases, generating more (round %d)", topic.ID, len(pool), round+1)
		generated, genErr := a.generateForSubtree(topicIDs, exercises)
		if genErr != nil {
			if len(pool) == 0 {
				status, code := http.StatusBadGateway, "EXERCISE_GENERATION_FAILED"
				if llm.IsTimeoutError(genErr) {
					status, code = http.StatusGatewayTimeout, "UPSTREAM_TIMEOUT"
				}
				writeJSONError(w, status, code, "Failed to generate phrases for the podcast.", genErr.Error(), true)
				return
			}
			log.Printf("[PODCAST] Generation failed, continuing with %d phrases: %v", len(pool), genErr)
			break
		}
		if len(generated) == 0 {
			break
		}
		exercises = append(exercises, generated...)
		pool, poolViews = podcastPool(exercises, views)
	}
	if len(pool) == 0 {
		writeJSONError(w, http.StatusNotFound, "NO_PHRASES", "This topic has no phrases yet.", "", false)
		return
	}
	if views == nil {
		poolViews = nil // guests: uniform random pick, no repeats
	}

	rng := mrand.New(mrand.NewSource(time.Now().UnixNano()))
	phrases := selectPodcastPhrases(pool, poolViews, podcastPhraseCount, rng)

	clips, err := a.fetchPodcastClips(phrases)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, errTTSNotConfigured) {
			status = http.StatusServiceUnavailable
		}
		writeJSONError(w, status, "TTS_FAILED", "Failed to synthesize podcast audio.", err.Error(), true)
		return
	}
	phrases = dropPhrasesWithoutAudio(phrases, clips)
	if len(phrases) == 0 {
		writeJSONError(w, http.StatusBadGateway, "TTS_FAILED", "Failed to synthesize podcast audio.", "", true)
		return
	}

	steps := buildPodcastPlan(phrases, rng)
	audio, duration, err := renderPodcast(steps, clips)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "PODCAST_RENDER_FAILED", "Failed to assemble podcast audio.", err.Error(), false)
		return
	}

	if err := os.MkdirAll(podcastDir, 0o755); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "PODCAST_SAVE_FAILED", "Failed to save podcast.", err.Error(), false)
		return
	}
	cleanupOldPodcasts()
	id := newPodcastID()
	if err := os.WriteFile(filepath.Join(podcastDir, id+".mp3"), audio, 0o644); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "PODCAST_SAVE_FAILED", "Failed to save podcast.", err.Error(), false)
		return
	}

	repeats := 0
	for _, s := range steps {
		if s.Recall {
			repeats++
		}
	}
	repeats -= len(phrases)

	name := fmt.Sprintf("podcast-%s-%s", podcastFileSlug(topic.Name), time.Now().Format("2006-01-02"))
	resp := podcastResponse{
		ID:              id,
		URL:             "/api/podcast/" + id + ".mp3",
		DownloadURL:     "/api/podcast/" + id + ".mp3?download=" + url.QueryEscape(name),
		TopicName:       topic.Name,
		DurationSeconds: int(duration.Round(time.Second).Seconds()),
		Phrases:         phrases,
		RecallRepeats:   repeats,
	}
	log.Printf("[PODCAST] Built episode %s for topic %s userID='%s': %d phrases, %d repeats, %s, %d KB in %s",
		id, topic.ID, userID, len(phrases), repeats, duration.Round(time.Second), len(audio)/1024, time.Since(started).Round(time.Millisecond))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handlePodcastFile serves a built episode: GET /api/podcast/<id>.mp3,
// with ?download=<name> to save it as a file. Served under /api/ so the
// service worker leaves it alone and Range requests reach http.ServeContent.
func (a *App) handlePodcastFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/podcast/"), ".mp3")
	if !podcastIDPattern.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(filepath.Join(podcastDir, id+".mp3"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if name := r.URL.Query().Get("download"); name != "" {
		name = podcastFileSlug(name) + ".mp3"
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	}
	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("Cache-Control", "private, max-age=604800, immutable")
	http.ServeContent(w, r, id+".mp3", info.ModTime(), f)
}
