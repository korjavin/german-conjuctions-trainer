package cli

import (
	"encoding/json"
	"errors"
	"net/http"
)

// Exercise mirrors the JSON shape the server returns from POST /api/exercises.
// ExerciseJSON is left as a raw JSON blob because the server hands it through
// verbatim and the CLI has no need to parse the inner structure for normal
// output — `--json` callers want it preserved, and summary output only counts.
type Exercise struct {
	ID                string          `json:"id"`
	TopicID           string          `json:"topic_id"`
	ExerciseJSON      json.RawMessage `json:"exercise_json"`
	AudioFilePath     string          `json:"audio_file_path"`
	IsFavorite        bool            `json:"is_favorite"`
	RepetitionCounter int             `json:"repetition_counter"`
}

// GenerateExercises posts to /api/exercises with the given topic ID. The
// server-side handler picks exercises from cache, possibly triggering LLM
// generation when the authenticated user's eligible pool is below the
// threshold. The returned slice is nil rather than empty when the server
// sent `"exercises": null` (which can happen for guest callers with no
// cached exercises).
func (c *Client) GenerateExercises(topicID string) ([]Exercise, error) {
	if topicID == "" {
		return nil, errors.New("topic id is required")
	}
	var resp struct {
		Exercises []Exercise `json:"exercises"`
	}
	body := map[string]string{"topic_id": topicID}
	if err := c.Do(http.MethodPost, "/api/exercises", body, &resp); err != nil {
		return nil, err
	}
	return resp.Exercises, nil
}
