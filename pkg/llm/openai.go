package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"german-conjunctions-trainer/pkg/storage"

	"github.com/google/uuid"
)

// --- Data Structures ---

type GenerateRequest struct {
	TopicID string `json:"topic_id"`
	// Limit caps how many exercises the batch endpoint returns to a signed-in
	// user. 0 means the default of 10; values above 50 are clamped by the
	// handler. Guests always get the fixed 10.
	Limit int `json:"limit,omitempty"`
	// SkipGeneration tells the batch endpoint to serve only what is already
	// cached instead of calling the LLM to top the batch up. Used by the
	// offline prefetch, which must never block on the provider.
	SkipGeneration bool `json:"skip_generation,omitempty"`
}

type ResponseFormat struct {
	Type string `json:"type"`
}

type OpenAIRequest struct {
	Model          string          `json:"model"`
	Messages       []Message       `json:"messages"`
	ResponseFormat *ResponseFormat `json:"response_format,omitempty"`
	// OutputSchema is a JSON schema the native Claude provider enforces via
	// output_config.format; the /chat/completions path ignores it.
	OutputSchema map[string]any `json:"-"`
}

// exercisesSchema is the structured-output schema for exercise generation.
var exercisesSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"exercises": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"english_hint":            map[string]any{"type": "string"},
					"correct_german_sentence": map[string]any{"type": "string"},
				},
				"required":             []string{"english_hint", "correct_german_sentence"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []string{"exercises"},
	"additionalProperties": false,
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type OpenAIResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

type GeneratedExercise struct {
	CorrectGermanSentence string   `json:"correct_german_sentence"`
	ConjunctionTopic      string   `json:"conjunction_topic"`
	EnglishHint           string   `json:"english_hint"`
	ScrambledWords        []string `json:"scrambled_words"`
}

type GenerationDebugInfo struct {
	BatchID               string           `json:"batch_id"`
	TopicID               string           `json:"topic_id"`
	ModelName             string           `json:"model_name"`
	Prompt                string           `json:"prompt"`
	Profile               VariationProfile `json:"profile"`
	RefinementEnabled     bool             `json:"refinement_enabled"`
	RefinementUsed        bool             `json:"refinement_used"`
	RefinementError       string           `json:"refinement_error,omitempty"`
	ProviderRetryCount    int              `json:"provider_retry_count"`
	QualityGateRetryCount int              `json:"quality_gate_retry_count"`
	QualityGateFailures   []string         `json:"quality_gate_failures,omitempty"`
	GeneratedCount        int              `json:"generated_count"`
	GenerationLatencyMS   int64            `json:"generation_latency_ms"`
	LastError             string           `json:"last_error,omitempty"`
	GeneratedAt           time.Time        `json:"generated_at"`
}

// --- Globals ---

type lastGenerationData struct {
	prompt string
	debug  GenerationDebugInfo
}

var (
	lastGeneration      lastGenerationData
	lastGenerationMutex sync.RWMutex
)

const defaultOpenAITimeoutSeconds = 180
const maxErrorSnippetLen = 500

const metaPrompt = `You are a prompt engineering assistant. Your task is to refine the following user-provided topic description to improve the variety and creativity of language exercises.

**Refinement Rules:**
1.  **Expand Vocabulary:** Suggest broader vocabulary themes and specific word categories (e.g., common German verbs, workplace terminology, everyday expressions).
2.  **Diversify Situations:** Add diverse real-life contexts and scenarios (e.g., explaining reasons, expressing goals, giving instructions, casual conversations).
3.  **Clarify Difficulty:** Ensure the difficulty level is clear and appropriate for the stated proficiency level (e.g., A2, B1, B2).
4.  **Maintain Core Topic:** Keep the fundamental grammar concept or topic intact (e.g., conjunctions, sentence structures).
5.  **Be Concise:** The output should be a clear, focused topic description—not a full technical prompt with instructions or examples.
6.  **Output:** Return ONLY the refined topic description, with no extra text, explanations, or markdown formatting.

Here is the topic description to refine:
---
%s
---
`

// --- LLM Functions ---

func getOpenAITimeout() time.Duration {
	timeoutSeconds := defaultOpenAITimeoutSeconds
	if configured := strings.TrimSpace(os.Getenv("OPENAI_TIMEOUT_SECONDS")); configured != "" {
		parsed, err := strconv.Atoi(configured)
		if err != nil || parsed <= 0 {
			log.Printf("Invalid OPENAI_TIMEOUT_SECONDS value '%s', using default %d seconds", configured, defaultOpenAITimeoutSeconds)
		} else {
			timeoutSeconds = parsed
		}
	}
	return time.Duration(timeoutSeconds) * time.Second
}

func isPromptRefinementEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("ENABLE_PROMPT_REFINEMENT")))
	switch value {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func formatBodySnippet(respBody []byte) string {
	if len(respBody) == 0 {
		return "<empty body>"
	}
	snippet := strings.TrimSpace(string(respBody))
	snippet = strings.ReplaceAll(snippet, "\n", " ")
	snippet = strings.ReplaceAll(snippet, "\r", " ")
	if len(snippet) > maxErrorSnippetLen {
		snippet = snippet[:maxErrorSnippetLen] + "..."
	}
	return snippet
}

func looksLikeExercisePayload(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(trimmed)
	return strings.HasPrefix(trimmed, "{") && strings.Contains(lower, "\"exercises\"")
}

func validateRefinedPrompt(prompt string) error {
	trimmed := strings.TrimSpace(prompt)
	if trimmed == "" {
		return fmt.Errorf("refined prompt is empty")
	}
	if looksLikeExercisePayload(trimmed) {
		return fmt.Errorf("refined prompt appears to be generated exercises JSON instead of instructions")
	}
	return nil
}

func ensurePromptContainsJSON(prompt string) string {
	trimmed := strings.TrimSpace(prompt)
	if trimmed == "" {
		return "Return only valid json."
	}
	if strings.Contains(trimmed, "json") {
		return trimmed
	}
	return trimmed + "\n\nImportant: return only valid json."
}

func isMissingJSONPromptError(err error) bool {
	if err == nil {
		return false
	}
	lowerErr := strings.ToLower(err.Error())
	return strings.Contains(lowerErr, "prompt must contain the word 'json'") ||
		strings.Contains(lowerErr, "prompt must contain the word \"json\"")
}

// extractJSONObject returns the outermost JSON object in an LLM reply, so a
// reply wrapped in a ```json fence or in prose still parses. Anthropic's
// OpenAI-compat layer ignores response_format, so every parser goes through here.
func extractJSONObject(content string) []byte {
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end < start {
		return []byte(content)
	}
	return []byte(content[start : end+1])
}

func parseGeneratedExercises(content string) ([]GeneratedExercise, error) {
	var exerciseData struct {
		Exercises []GeneratedExercise `json:"exercises"`
	}
	if err := json.Unmarshal(extractJSONObject(content), &exerciseData); err != nil {
		return nil, fmt.Errorf("failed to parse exercises from provider response: %w", err)
	}
	if len(exerciseData.Exercises) == 0 {
		return nil, fmt.Errorf("provider returned zero exercises")
	}
	return exerciseData.Exercises, nil
}

func cloneGenerationDebugInfo(info GenerationDebugInfo) GenerationDebugInfo {
	copyInfo := info
	copyInfo.Profile.ConjunctionSet = append([]string(nil), info.Profile.ConjunctionSet...)
	copyInfo.Profile.TenseMix = append([]string(nil), info.Profile.TenseMix...)
	copyInfo.Profile.SentenceForms = append([]string(nil), info.Profile.SentenceForms...)
	copyInfo.Profile.ClausePatterns = append([]string(nil), info.Profile.ClausePatterns...)
	copyInfo.QualityGateFailures = append([]string(nil), info.QualityGateFailures...)
	return copyInfo
}

func setLastGenerationData(prompt string, info GenerationDebugInfo) {
	lastGenerationMutex.Lock()
	defer lastGenerationMutex.Unlock()
	lastGeneration.prompt = prompt
	lastGeneration.debug = cloneGenerationDebugInfo(info)
}

// IsTimeoutError identifies timeout-like errors from upstream provider calls.
func IsTimeoutError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	return false
}

// providerStatusError is an HTTP error status (4xx/5xx) from the provider.
type providerStatusError struct {
	status int
	err    error
}

func (e *providerStatusError) Error() string { return e.err.Error() }

// callChatCompletions calls the primary provider (native Claude Messages API
// when LLM_PROVIDER=anthropic, else /chat/completions) and, when it answers with an
// HTTP error status (e.g. 402 out of credits), retries once on the optional
// fallback provider from LLM_FALLBACK_URL / LLM_FALLBACK_API_KEY /
// LLM_FALLBACK_MODEL. Timeouts and transport errors are not retried.
// ponytail: no circuit breaker; while the primary is down every request pays
// one failed primary round trip first.
func callChatCompletions(
	client *http.Client,
	openaiURL string,
	apiKey string,
	reqPayload OpenAIRequest,
	timeout time.Duration,
	stage string,
) (*OpenAIResponse, time.Duration, error) {
	primary := callChatCompletionsOnce
	if isAnthropicProvider() {
		primary = callAnthropicMessages
	}
	resp, elapsed, err := primary(client, openaiURL, apiKey, reqPayload, timeout, stage)
	var statusErr *providerStatusError
	fallbackURL := strings.TrimSpace(os.Getenv("LLM_FALLBACK_URL"))
	if err == nil || fallbackURL == "" || !errors.As(err, &statusErr) {
		if err == nil {
			log.Printf("[LLM] %s served by primary %s model=%s", stage, openaiURL, reqPayload.Model)
		}
		return resp, elapsed, err
	}

	if model := strings.TrimSpace(os.Getenv("LLM_FALLBACK_MODEL")); model != "" {
		reqPayload.Model = model
	}
	log.Printf("[LLM] %s primary failed with status %d, retrying on fallback %s model=%s", stage, statusErr.status, fallbackURL, reqPayload.Model)
	fbResp, fbElapsed, fbErr := callChatCompletionsOnce(client, fallbackURL, os.Getenv("LLM_FALLBACK_API_KEY"), reqPayload, timeout, stage+" (fallback)")
	if fbErr != nil {
		return nil, elapsed + fbElapsed, fmt.Errorf("%v; fallback: %w", err, fbErr)
	}
	log.Printf("[LLM] %s served by fallback %s model=%s", stage, fallbackURL, reqPayload.Model)
	return fbResp, elapsed + fbElapsed, nil
}

func callChatCompletionsOnce(
	client *http.Client,
	openaiURL string,
	apiKey string,
	reqPayload OpenAIRequest,
	timeout time.Duration,
	stage string,
) (*OpenAIResponse, time.Duration, error) {
	respBody, elapsed, err := postProvider(client, strings.TrimRight(openaiURL, "/")+"/chat/completions",
		map[string]string{"Authorization": "Bearer " + apiKey}, reqPayload, timeout, stage)
	if err != nil {
		return nil, elapsed, err
	}

	var openaiResp OpenAIResponse
	if err := json.Unmarshal(respBody, &openaiResp); err != nil {
		return nil, elapsed, fmt.Errorf("%s returned non-JSON response: %s", stage, formatBodySnippet(respBody))
	}

	if openaiResp.Error != nil {
		return nil, elapsed, fmt.Errorf("%s returned API error after %s: %s (type=%s code=%s)", stage, elapsed.Round(time.Millisecond), openaiResp.Error.Message, openaiResp.Error.Type, openaiResp.Error.Code)
	}

	if len(openaiResp.Choices) == 0 || strings.TrimSpace(openaiResp.Choices[0].Message.Content) == "" {
		return nil, elapsed, fmt.Errorf("%s returned empty choices after %s", stage, elapsed.Round(time.Millisecond))
	}

	return &openaiResp, elapsed, nil
}

// postProvider POSTs a JSON payload and returns the raw 2xx body. A non-2xx
// answer becomes a *providerStatusError carrying the provider's error.message
// (OpenAI and Anthropic both use that shape), so callChatCompletions can fall back.
func postProvider(
	client *http.Client,
	url string,
	headers map[string]string,
	payload any,
	timeout time.Duration,
	stage string,
) ([]byte, time.Duration, error) {
	reqBody, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, fmt.Errorf("%s: failed to encode request body: %w", stage, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	apiReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, 0, fmt.Errorf("%s: failed to create request: %w", stage, err)
	}
	apiReq.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		apiReq.Header.Set(k, v)
	}

	start := time.Now()
	resp, err := client.Do(apiReq)
	elapsed := time.Since(start)
	if err != nil {
		if IsTimeoutError(err) {
			return nil, elapsed, fmt.Errorf("%s timed out after %s: %w", stage, elapsed.Round(time.Millisecond), err)
		}
		return nil, elapsed, fmt.Errorf("%s request failed after %s: %w", stage, elapsed.Round(time.Millisecond), err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, elapsed, fmt.Errorf("%s: failed to read response body: %w", stage, err)
	}

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		providerMessage := formatBodySnippet(respBody)
		var errBody struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(respBody, &errBody) == nil && errBody.Error.Message != "" {
			providerMessage = errBody.Error.Message
		}
		requestID := resp.Header.Get("x-request-id")
		if requestID == "" {
			requestID = resp.Header.Get("request-id")
		}
		return nil, elapsed, &providerStatusError{
			status: resp.StatusCode,
			err:    fmt.Errorf("%s failed with status %d after %s (request_id=%s): %s", stage, resp.StatusCode, elapsed.Round(time.Millisecond), requestID, providerMessage),
		}
	}
	return respBody, elapsed, nil
}

// splitGenerationPrompt moves the topic part of a generation prompt (stable
// per topic) into a system message and keeps the per-request variation
// profile, coverage and output contract in the user message. The native
// Claude provider caches the system message, so a second generation for the
// same topic reads it from the prompt cache.
func splitGenerationPrompt(prompt string) []Message {
	stable, variable, found := strings.Cut(prompt, variationProfileHeader)
	if !found || strings.TrimSpace(stable) == "" {
		return []Message{{Role: "user", Content: prompt}}
	}
	return []Message{
		{Role: "system", Content: strings.TrimSpace(stable)},
		{Role: "user", Content: variationProfileHeader + variable},
	}
}

func requestExercisesFromProvider(
	client *http.Client,
	apiKey string,
	openaiURL string,
	modelName string,
	timeout time.Duration,
	prompt string,
	stage string,
) ([]GeneratedExercise, time.Duration, int, error) {
	providerRetries := 0
	totalElapsed := time.Duration(0)

	openaiReq := OpenAIRequest{
		Model:          modelName,
		Messages:       splitGenerationPrompt(prompt),
		ResponseFormat: &ResponseFormat{Type: "json_object"},
		OutputSchema:   exercisesSchema,
	}

	openaiResp, elapsed, err := callChatCompletions(client, openaiURL, apiKey, openaiReq, timeout, stage)
	totalElapsed += elapsed
	if err != nil {
		if isMissingJSONPromptError(err) {
			providerRetries = 1
			last := len(openaiReq.Messages) - 1
			openaiReq.Messages[last].Content = strings.TrimSpace(openaiReq.Messages[last].Content) + "\n\nReminder: respond with valid json."
			openaiResp, elapsed, err = callChatCompletions(client, openaiURL, apiKey, openaiReq, timeout, stage+" retry")
			totalElapsed += elapsed
		}
		if err != nil {
			return nil, totalElapsed, providerRetries, err
		}
	}

	exercises, parseErr := parseGeneratedExercises(openaiResp.Choices[0].Message.Content)
	if parseErr != nil {
		return nil, totalElapsed, providerRetries, parseErr
	}
	return exercises, totalElapsed, providerRetries, nil
}

func RefinePrompt(originalPrompt, apiKey, openaiURL, modelName string) (string, error) {
	timeout := getOpenAITimeout()
	client := &http.Client{Timeout: timeout}
	log.Printf("Refining prompt with model=%s timeout=%s", modelName, timeout)

	refineMessages := []Message{
		{
			Role:    "user",
			Content: fmt.Sprintf(metaPrompt, originalPrompt),
		},
	}

	refineReq := OpenAIRequest{
		Model:    modelName,
		Messages: refineMessages,
	}

	openaiResp, elapsed, err := callChatCompletions(client, openaiURL, apiKey, refineReq, timeout, "prompt refinement")
	if err != nil {
		return "", err
	}

	refinedPrompt := strings.TrimSpace(openaiResp.Choices[0].Message.Content)
	if err := validateRefinedPrompt(refinedPrompt); err != nil {
		return "", err
	}
	log.Printf("Successfully refined prompt in %s.", elapsed.Round(time.Millisecond))
	return refinedPrompt, nil
}

// GenerateExplanation requests a short grammar explanation from the LLM based on user mistakes.
func GenerateExplanation(apiKey, openaiURL, modelName, topic, correctSentence string, mistakes []string) (string, error) {
	prompt := BuildExplanationPrompt(topic, correctSentence, mistakes)

	timeout := getOpenAITimeout()
	client := &http.Client{Timeout: timeout}

	openaiReq := OpenAIRequest{
		Model:          modelName,
		Messages:       []Message{{Role: "user", Content: prompt}},
		ResponseFormat: &ResponseFormat{Type: "json_object"},
	}

	openaiResp, elapsed, err := callChatCompletions(client, openaiURL, apiKey, openaiReq, timeout, "explanation generation")
	if err != nil {
		return "", err
	}

	content := openaiResp.Choices[0].Message.Content
	var respData struct {
		Explanation string `json:"explanation"`
	}
	if err := json.Unmarshal(extractJSONObject(content), &respData); err != nil {
		return "", fmt.Errorf("failed to parse explanation from provider response: %w", err)
	}

	if strings.TrimSpace(respData.Explanation) == "" {
		return "", fmt.Errorf("provider returned empty explanation")
	}

	log.Printf("[EXPLANATION] generated successfully in %s", elapsed.Round(time.Millisecond))
	return strings.TrimSpace(respData.Explanation), nil
}

// GenerateExercises calls the LLM and returns generated exercises without saving them.
func GenerateExercises(topic *storage.Topic, apiKey, openaiURL, modelName, coverageSection string) ([]GeneratedExercise, error) {
	batchID := uuid.NewString()
	profile := BuildVariationProfile(topic)
	generationStarted := time.Now().UTC()

	debugInfo := GenerationDebugInfo{
		BatchID:           batchID,
		TopicID:           topic.ID,
		ModelName:         modelName,
		Profile:           profile,
		RefinementEnabled: isPromptRefinementEnabled(),
		GeneratedAt:       generationStarted,
	}

	basePrompt := topic.Prompt
	if debugInfo.RefinementEnabled {
		refinedPrompt, refineErr := RefinePrompt(basePrompt, apiKey, openaiURL, modelName)
		if refineErr != nil {
			debugInfo.RefinementError = refineErr.Error()
			log.Printf("[GENERATION] batch=%s refinement failed, using base prompt: %v", batchID, refineErr)
		} else {
			basePrompt = refinedPrompt
			debugInfo.RefinementUsed = true
		}
	}

	finalPrompt := BuildGenerationPrompt(basePrompt, profile, coverageSection)
	finalPrompt = ensurePromptContainsJSON(finalPrompt)
	debugInfo.Prompt = finalPrompt

	timeout := getOpenAITimeout()
	client := &http.Client{Timeout: timeout}

	log.Printf("[GENERATION] batch=%s topic=%s model=%s timeout=%s seed=%d conjunction_targets=%d refinement_enabled=%v refinement_used=%v",
		batchID, topic.ID, modelName, timeout, profile.Seed, len(profile.ConjunctionSet), debugInfo.RefinementEnabled, debugInfo.RefinementUsed)

	exercises, elapsed, providerRetries, err := requestExercisesFromProvider(
		client,
		apiKey,
		openaiURL,
		modelName,
		timeout,
		finalPrompt,
		"exercise generation",
	)
	debugInfo.ProviderRetryCount += providerRetries
	debugInfo.GenerationLatencyMS += elapsed.Milliseconds()
	if err != nil {
		debugInfo.LastError = err.Error()
		setLastGenerationData(debugInfo.Prompt, debugInfo)
		return nil, err
	}

	if qualityErr := ValidateExerciseSet(exercises, profile); qualityErr != nil {
		debugInfo.QualityGateFailures = append(debugInfo.QualityGateFailures, qualityErr.Error())
		debugInfo.QualityGateRetryCount = 1

		correctivePrompt := BuildCorrectivePrompt(finalPrompt, profile, qualityErr.Error())
		correctivePrompt = ensurePromptContainsJSON(correctivePrompt)
		debugInfo.Prompt = correctivePrompt

		exercises, elapsed, providerRetries, err = requestExercisesFromProvider(
			client,
			apiKey,
			openaiURL,
			modelName,
			timeout,
			correctivePrompt,
			"exercise generation corrective",
		)
		debugInfo.ProviderRetryCount += providerRetries
		debugInfo.GenerationLatencyMS += elapsed.Milliseconds()
		if err != nil {
			debugInfo.LastError = fmt.Sprintf("quality retry request failed: %v", err)
			setLastGenerationData(debugInfo.Prompt, debugInfo)
			return nil, err
		}

		if secondQualityErr := ValidateExerciseSet(exercises, profile); secondQualityErr != nil {
			debugInfo.QualityGateFailures = append(debugInfo.QualityGateFailures, secondQualityErr.Error())
			debugInfo.LastError = secondQualityErr.Error()
			setLastGenerationData(debugInfo.Prompt, debugInfo)
			return nil, secondQualityErr
		}
	}

	debugInfo.GeneratedCount = len(exercises)
	log.Printf("[GENERATION] batch=%s completed topic=%s exercises=%d latency_ms=%d provider_retries=%d quality_retries=%d",
		batchID, topic.ID, len(exercises), debugInfo.GenerationLatencyMS, debugInfo.ProviderRetryCount, debugInfo.QualityGateRetryCount)

	// Set the final generation data after all retries have been counted
	setLastGenerationData(debugInfo.Prompt, debugInfo)

	return exercises, nil
}

// GenerateAndCacheExercises generates exercises and saves them to storage.
func GenerateAndCacheExercises(topic *storage.Topic, generateAudio bool, coverageSection string) ([]*storage.Exercise, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("OPENAI_API_KEY is not configured")
	}
	openaiURL := os.Getenv("OPENAI_URL")
	if openaiURL == "" {
		openaiURL = "https://api.openai.com/v1"
	}
	modelName := os.Getenv("MODEL_NAME")
	if modelName == "" {
		modelName = "gpt-3.5-turbo-1106"
	}

	generatedExercises, err := GenerateExercises(topic, apiKey, openaiURL, modelName, coverageSection)
	if err != nil {
		return nil, err
	}

	promptHash := storage.GetPromptHash(topic.Prompt)
	var newlyCached []*storage.Exercise
	for _, exData := range generatedExercises {
		var audioPath string
		if generateAudio {
			// NOTE: Audio generation logic (generateAndSaveAudio) is not included in this package.
			log.Printf("Audio generation is requested but not implemented in this package.")
			audioPath = ""
		}

		exJSONBytes, err := json.Marshal(exData)
		if err != nil {
			log.Printf("Warning: failed to re-marshal exercise JSON: %v", err)
			continue
		}

		exercise, err := storage.DB.CreateExercise(topic.ID, promptHash, string(exJSONBytes), audioPath)
		if err != nil {
			log.Printf("Warning: failed to cache exercise: %v", err)
			continue
		}
		newlyCached = append(newlyCached, exercise)
	}

	return newlyCached, nil
}

// GetLastRefinedPrompt is kept for backward compatibility with the existing UI.
func GetLastRefinedPrompt() string {
	lastGenerationMutex.RLock()
	defer lastGenerationMutex.RUnlock()
	return lastGeneration.prompt
}

func GetLastGenerationDebugInfo() GenerationDebugInfo {
	lastGenerationMutex.RLock()
	defer lastGenerationMutex.RUnlock()
	return cloneGenerationDebugInfo(lastGeneration.debug)
}
