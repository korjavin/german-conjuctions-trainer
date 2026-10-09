package app

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	mrand "math/rand"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"german-conjunctions-trainer/pkg/llm"
	"german-conjunctions-trainer/pkg/storage"
)

// Background pre-generation: with LLM_PROVIDER=anthropic and
// LLM_BATCH_MIN_POOL=N (N>0), every pregenInterval the topics with fewer than
// N cached exercises get one Message Batch request each. The in-flight batch
// is persisted next to the database, so a restart resumes polling instead of
// resubmitting. ponytail: one batch at a time, no queue table.

const (
	pregenInterval  = 15 * time.Minute
	pregenMaxTopics = 50 // requests per batch, bounds one cycle's spend
	pregenStateFile = "llm_batch.json"
)

// pregenBackoff skips a topic whose batch item failed `fails` times in a row
// until `until`: pregenInterval doubled per failure, capped at maxPregenBackoff.
// ponytail: in memory, a restart retries every topic once.
type pregenBackoff struct {
	fails int
	until time.Time
}

const maxPregenBackoff = 24 * time.Hour

type pregenState struct {
	BatchID string          `json:"batch_id"`
	Items   []llm.BatchItem `json:"items"`
}

// pregenThreshold returns the pool size to top up to, 0 = job disabled.
func pregenThreshold() int {
	if !llm.BatchesSupported() {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(os.Getenv("LLM_BATCH_MIN_POOL")))
	return max(n, 0)
}

func (a *App) pregenStatePath() string {
	return filepath.Join(filepath.Dir(a.DBPath), pregenStateFile)
}

// runPregen runs a cycle now (resuming a persisted batch) and then every pregenInterval.
func (a *App) runPregen(threshold int) {
	ticker := time.NewTicker(pregenInterval)
	defer ticker.Stop()
	for {
		a.pregenCycle(threshold)
		select {
		case <-ticker.C:
		case <-a.shutdown:
			return
		}
	}
}

// pregenCycle polls the in-flight batch if there is one, else submits a new
// batch for the topics below threshold. Every failure is logged and the cycle
// is skipped; nothing here touches live requests.
func (a *App) pregenCycle(threshold int) {
	path := a.pregenStatePath()
	if a.pregenBatch == nil {
		if raw, err := os.ReadFile(path); err == nil {
			var st pregenState
			if err := json.Unmarshal(raw, &st); err != nil || st.BatchID == "" {
				log.Printf("[PREGEN] dropping unreadable state %s: %v", path, err)
				os.Remove(path)
				return
			}
			a.pregenBatch = &st
		} else if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("[PREGEN] cannot read state %s: %v", path, err)
			return
		}
	}
	if a.pregenBatch != nil {
		a.pollPregenBatch(path)
		return
	}

	items, err := a.pregenItems(threshold)
	if err != nil {
		log.Printf("[PREGEN] skipping cycle: %v", err)
		return
	}
	if len(items) == 0 {
		return
	}
	batchID, err := llm.SubmitExerciseBatch(items)
	if err != nil {
		log.Printf("[PREGEN] batch rejected, skipping cycle: %v", err)
		return
	}
	log.Printf("[PREGEN] submitted batch %s for %d topics", batchID, len(items))
	// The batch is polled from memory; the file only survives restarts.
	// ponytail: a crash before this write (or a failed write) loses the batch
	// across a restart and the next cycle resubmits once.
	a.pregenBatch = &pregenState{BatchID: batchID, Items: items}
	raw, _ := json.Marshal(a.pregenBatch)
	err = os.WriteFile(path+".tmp", raw, 0o600)
	if err == nil {
		err = os.Rename(path+".tmp", path)
	}
	if err != nil {
		log.Printf("[PREGEN] batch %s state not saved, a restart would resubmit: %v", batchID, err)
	}
}

func (a *App) pollPregenBatch(path string) {
	st := *a.pregenBatch
	ended, results, err := llm.PollExerciseBatch(st.BatchID, st.Items)
	if err != nil {
		log.Printf("[PREGEN] poll of batch %s failed, retrying next cycle: %v", st.BatchID, err)
		return
	}
	if !ended {
		return
	}
	if results != nil { // nil = batch vanished (404), not the topics' fault
		a.notePregenOutcomes(st.Items, results)
	}
	stored := 0
	for i, exercises := range results {
		item := st.Items[i]
		topic, err := a.DB.GetTopic(item.TopicID)
		if err != nil || storage.GetPromptHash(topic.Prompt) != item.PromptHash {
			log.Printf("[PREGEN] topic %s deleted or edited since submit, dropping its results", item.TopicID)
			continue
		}
		stored += len(llm.CacheExercises(a.DB, item.TopicID, item.PromptHash, exercises))
	}
	a.pregenBatch = nil
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		log.Printf("[PREGEN] cannot remove state %s: %v", path, err)
	}
	log.Printf("[PREGEN] batch %s ended: %d/%d topics, %d exercises stored", st.BatchID, len(results), len(st.Items), stored)
}

// notePregenOutcomes clears the backoff of topics that got exercises and
// extends it for the ones that failed, so they are not resubmitted every cycle.
func (a *App) notePregenOutcomes(items []llm.BatchItem, results map[int][]llm.GeneratedExercise) {
	if a.pregenBackoff == nil {
		a.pregenBackoff = make(map[string]pregenBackoff)
	}
	now := time.Now()
	for i, item := range items {
		key := item.TopicID + "/" + item.PromptHash // an edited prompt starts fresh
		if _, ok := results[i]; ok {
			delete(a.pregenBackoff, key)
			continue
		}
		b := a.pregenBackoff[key]
		b.fails++
		// 30m, 1h, 2h ... capped; the inner min keeps the shift from overflowing.
		b.until = now.Add(min(pregenInterval<<min(b.fails, 7), maxPregenBackoff))
		a.pregenBackoff[key] = b
		log.Printf("[PREGEN] topic %s failed %d time(s) in a row, skipped until %s", item.TopicID, b.fails, b.until.Format(time.RFC3339))
	}
}

// pregenItems returns a batch item for each non-archived topic with a prompt
// whose current-prompt pool is below threshold and that is not backing off.
func (a *App) pregenItems(threshold int) ([]llm.BatchItem, error) {
	ids, err := a.nonArchivedTopicIDs()
	if err != nil {
		return nil, err
	}
	exercises, err := a.loadTopicsExercises(ids)
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int)
	for _, ex := range exercises {
		counts[ex.TopicID]++
	}
	// Shuffled, so topics that keep failing cannot starve the rest past the cap.
	mrand.Shuffle(len(ids), func(i, j int) { ids[i], ids[j] = ids[j], ids[i] })
	var items []llm.BatchItem
	now := time.Now()
	for _, id := range ids {
		if counts[id] >= threshold {
			continue
		}
		topic, err := a.DB.GetTopic(id)
		if err != nil || strings.TrimSpace(topic.Prompt) == "" ||
			now.Before(a.pregenBackoff[id+"/"+storage.GetPromptHash(topic.Prompt)].until) {
			continue
		}
		items = append(items, llm.NewBatchItem(topic, a.coverageSection(topic, exercises)))
		if len(items) == pregenMaxTopics {
			break
		}
	}
	return items, nil
}
