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

type anthropicFormat struct {
	Type   string         `json:"type"`
	Schema map[string]any `json:"schema"`
}

type anthropicOutputConfig struct {
	Format anthropicFormat `json:"format"`
}

type anthropicRequest struct {
	Model        string                 `json:"model"`
	MaxTokens    int                    `json:"max_tokens"`
	System       []anthropicTextBlock   `json:"system,omitempty"`
	Messages     []Message              `json:"messages"`
	OutputConfig *anthropicOutputConfig `json:"output_config,omitempty"`
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
// (cache breakpoint on the last block) and OutputSchema to structured outputs.
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
	if req.OutputSchema != nil {
		out.OutputConfig = &anthropicOutputConfig{Format: anthropicFormat{Type: "json_schema", Schema: req.OutputSchema}}
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
	respBody, elapsed, err := postProvider(client, strings.TrimRight(baseURL, "/")+"/messages",
		map[string]string{"x-api-key": apiKey, "anthropic-version": anthropicVersion},
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

	if msg.StopReason == "refusal" || msg.StopReason == "max_tokens" {
		return nil, elapsed, fmt.Errorf("%s stopped with stop_reason=%s after %s", stage, msg.StopReason, elapsed.Round(time.Millisecond))
	}
	var text strings.Builder
	for _, block := range msg.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	if strings.TrimSpace(text.String()) == "" {
		return nil, elapsed, fmt.Errorf("%s returned no text after %s", stage, elapsed.Round(time.Millisecond))
	}

	var out OpenAIResponse
	out.Choices = make([]struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}, 1)
	out.Choices[0].Message.Content = text.String()
	return &out, elapsed, nil
}
