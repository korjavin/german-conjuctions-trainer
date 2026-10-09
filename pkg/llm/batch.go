package llm

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"german-conjunctions-trainer/pkg/storage"
)

// Background exercise pre-generation through the Claude Message Batches API
// (50% cheaper, asynchronous). Only for LLM_PROVIDER=anthropic; live requests
// keep the synchronous path. ponytail: no fallback provider, no prompt
// refinement and no corrective retry here — a failed item just waits for the
// next batch or the synchronous path.

// BatchesSupported reports whether the configured provider has the Message Batches API.
func BatchesSupported() bool { return isAnthropicProvider() }

// BatchItem is one topic's request in a batch. It is persisted with the
// batch id, so a restart can still validate and store the results.
type BatchItem struct {
	TopicID    string           `json:"topic_id"`
	PromptHash string           `json:"prompt_hash"`
	Profile    VariationProfile `json:"profile"`
	Prompt     string           `json:"-"`
}

// NewBatchItem builds the same prompt and variation profile as GenerateExercises.
func NewBatchItem(topic *storage.Topic, coverageSection string) BatchItem {
	profile := BuildVariationProfile(topic)
	return BatchItem{
		TopicID:    topic.ID,
		PromptHash: storage.GetPromptHash(topic.Prompt),
		Profile:    profile,
		Prompt:     ensurePromptContainsJSON(BuildGenerationPrompt(topic.Prompt, profile, coverageSection)),
	}
}

func batchCustomID(i int) string { return fmt.Sprintf("t%d", i) }

type messageBatch struct {
	ID               string `json:"id"`
	ProcessingStatus string `json:"processing_status"`
	ResultsURL       string `json:"results_url"`
}

// SubmitExerciseBatch creates a Message Batch with one request per item
// (custom_id "t<index>") and returns its id. A provider rejection (e.g. no
// credits) is returned as an error.
func SubmitExerciseBatch(items []BatchItem) (string, error) {
	apiKey, baseURL, model, err := providerConfig()
	if err != nil {
		return "", err
	}
	type batchRequest struct {
		CustomID string           `json:"custom_id"`
		Params   anthropicRequest `json:"params"`
	}
	reqs := make([]batchRequest, len(items))
	for i, it := range items {
		reqs[i] = batchRequest{CustomID: batchCustomID(i), Params: buildAnthropicRequest(OpenAIRequest{
			Model:        model,
			Messages:     splitGenerationPrompt(it.Prompt),
			OutputSchema: exercisesSchema,
		})}
	}
	timeout := getOpenAITimeout()
	body, _, err := callProvider(&http.Client{Timeout: timeout}, http.MethodPost,
		strings.TrimRight(baseURL, "/")+"/messages/batches", anthropicHeaders(apiKey),
		map[string]any{"requests": reqs}, timeout, "batch submit")
	if err != nil {
		return "", err
	}
	var b messageBatch
	if err := json.Unmarshal(body, &b); err != nil || b.ID == "" {
		return "", fmt.Errorf("batch submit returned no batch id: %s", formatBodySnippet(body))
	}
	return b.ID, nil
}

// PollExerciseBatch returns ended=false while the batch is processing. Once
// it has ended it returns the exercises per item index that parsed and passed
// the quality gate; failed items are logged and left out. A batch the
// provider no longer knows (404) counts as ended with no results.
func PollExerciseBatch(batchID string, items []BatchItem) (bool, map[int][]GeneratedExercise, error) {
	apiKey, baseURL, _, err := providerConfig()
	if err != nil {
		return false, nil, err
	}
	timeout := getOpenAITimeout()
	client := &http.Client{Timeout: timeout}
	headers := anthropicHeaders(apiKey)
	body, _, err := callProvider(client, http.MethodGet,
		strings.TrimRight(baseURL, "/")+"/messages/batches/"+batchID, headers, nil, timeout, "batch poll")
	var statusErr *providerStatusError
	if errors.As(err, &statusErr) && statusErr.status == http.StatusNotFound {
		log.Printf("[BATCH] batch %s not found, dropping it", batchID)
		return true, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	var b messageBatch
	if err := json.Unmarshal(body, &b); err != nil {
		return false, nil, fmt.Errorf("batch poll returned non-JSON response: %s", formatBodySnippet(body))
	}
	if b.ProcessingStatus != "ended" {
		return false, nil, nil
	}
	if b.ResultsURL == "" {
		return true, nil, nil
	}
	body, _, err = callProvider(client, http.MethodGet, b.ResultsURL, headers, nil, timeout, "batch results")
	if err != nil {
		return false, nil, err
	}

	index := make(map[string]int, len(items))
	for i := range items {
		index[batchCustomID(i)] = i
	}
	results := make(map[int][]GeneratedExercise)
	scanner := bufio.NewScanner(bytes.NewReader(body))
	scanner.Buffer(make([]byte, 0, 64<<10), 16<<20)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var r struct {
			CustomID string `json:"custom_id"`
			Result   struct {
				Type    string            `json:"type"`
				Message anthropicResponse `json:"message"`
			} `json:"result"`
		}
		if err := json.Unmarshal(line, &r); err != nil {
			log.Printf("[BATCH] %s: unparsable result line: %s", batchID, formatBodySnippet(line))
			continue
		}
		i, ok := index[r.CustomID]
		if !ok {
			continue
		}
		if r.Result.Type != "succeeded" {
			log.Printf("[BATCH] %s topic=%s result=%s", batchID, items[i].TopicID, r.Result.Type)
			continue
		}
		text, err := r.Result.Message.text()
		if err == nil {
			var exercises []GeneratedExercise
			if exercises, err = parseGeneratedExercises(text); err == nil {
				if err = ValidateExerciseSet(exercises, items[i].Profile); err == nil {
					results[i] = exercises
					continue
				}
			}
		}
		log.Printf("[BATCH] %s topic=%s dropped: %v", batchID, items[i].TopicID, err)
	}
	if err := scanner.Err(); err != nil {
		return false, nil, fmt.Errorf("batch results: %w", err)
	}
	return true, results, nil
}
