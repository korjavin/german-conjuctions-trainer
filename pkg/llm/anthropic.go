package llm

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// Native Claude Messages API (POST {OPENAI_URL}/messages), selected with
// LLM_PROVIDER=anthropic. OPENAI_URL is then https://api.anthropic.com/v1 and
// OPENAI_API_KEY the Anthropic key; the LLM_FALLBACK_* provider stays
// OpenAI-compatible.

const (
	anthropicVersion   = "2023-06-01"
	anthropicMaxTokens = 16000
)

func isAnthropicProvider() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("LLM_PROVIDER")), "anthropic")
}

type anthropicCacheControl struct {
	Type string `json:"type"`
}

type anthropicTextBlock struct {
	Type         string                 `json:"type"`
	Text         string                 `json:"text"`
	CacheControl *anthropicCacheControl `json:"cache_control,omitempty"`
}

type anthropicRequest struct {
	Model     string               `json:"model"`
	MaxTokens int                  `json:"max_tokens"`
	System    []anthropicTextBlock `json:"system,omitempty"`
	Messages  []Message            `json:"messages"`
}

type anthropicResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	StopReason string `json:"stop_reason"`
	Usage      struct {
		InputTokens              int `json:"input_tokens"`
		OutputTokens             int `json:"output_tokens"`
		CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
		CacheReadInputTokens     int `json:"cache_read_input_tokens"`
	} `json:"usage"`
}

// buildAnthropicRequest maps system messages to the top-level system field
// (cache breakpoint on the last block). Deliberately no structured outputs
// (output_config json_schema): under that grammar Claude closed the exercises
// array after one item in most replies (gct-6d0). The prompt's json contract
// plus extractJSONObject yields the full set.
func buildAnthropicRequest(req OpenAIRequest) anthropicRequest {
	out := anthropicRequest{Model: req.Model, MaxTokens: anthropicMaxTokens}
	for _, m := range req.Messages {
		if m.Role == "system" {
			out.System = append(out.System, anthropicTextBlock{Type: "text", Text: m.Content})
		} else {
			out.Messages = append(out.Messages, m)
		}
	}
	if n := len(out.System); n > 0 {
		out.System[n-1].CacheControl = &anthropicCacheControl{Type: "ephemeral"}
	}
	return out
}

// callAnthropicMessages has callChatCompletionsOnce's signature and returns the
// reply text as Choices[0], so every caller works unchanged on either provider.
func callAnthropicMessages(
	client *http.Client,
	baseURL string,
	apiKey string,
	reqPayload OpenAIRequest,
	timeout time.Duration,
	stage string,
) (*OpenAIResponse, time.Duration, error) {
	respBody, elapsed, err := callProvider(client, http.MethodPost, strings.TrimRight(baseURL, "/")+"/messages",
		anthropicHeaders(apiKey),
		buildAnthropicRequest(reqPayload), timeout, stage)
	if err != nil {
		return nil, elapsed, err
	}

	var msg anthropicResponse
	if err := json.Unmarshal(respBody, &msg); err != nil {
		return nil, elapsed, fmt.Errorf("%s returned non-JSON response: %s", stage, formatBodySnippet(respBody))
	}
	u := msg.Usage
	log.Printf("[LLM] %s usage model=%s input_tokens=%d output_tokens=%d cache_creation_input_tokens=%d cache_read_input_tokens=%d stop_reason=%s",
		stage, reqPayload.Model, u.InputTokens, u.OutputTokens, u.CacheCreationInputTokens, u.CacheReadInputTokens, msg.StopReason)

	text, err := msg.text()
	if err != nil {
		return nil, elapsed, fmt.Errorf("%s %v after %s", stage, err, elapsed.Round(time.Millisecond))
	}

	var out OpenAIResponse
	out.Choices = make([]struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}, 1)
	out.Choices[0].Message.Content = text
	return &out, elapsed, nil
}

func anthropicHeaders(apiKey string) map[string]string {
	return map[string]string{"x-api-key": apiKey, "anthropic-version": anthropicVersion}
}

// text joins the reply's text blocks; a refusal, a cut-off or an empty reply is an error.
func (m anthropicResponse) text() (string, error) {
	if m.StopReason == "refusal" || m.StopReason == "max_tokens" {
		return "", fmt.Errorf("stopped with stop_reason=%s", m.StopReason)
	}
	var text strings.Builder
	for _, block := range m.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	if strings.TrimSpace(text.String()) == "" {
		return "", fmt.Errorf("returned no text")
	}
	return text.String(), nil
}
