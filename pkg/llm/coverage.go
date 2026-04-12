package llm

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"german-conjunctions-trainer/pkg/storage"
)

// ComputeTermCoverage counts how many cached exercises contain each key term.
func ComputeTermCoverage(exercises []*storage.Exercise, terms []string) map[string]int {
	counts := make(map[string]int, len(terms))
	for _, term := range terms {
		counts[term] = 0
	}

	lowerTerms := make([]string, len(terms))
	for i, t := range terms {
		lowerTerms[i] = strings.ToLower(t)
	}

	for _, ex := range exercises {
		sentence := extractGermanSentence(ex.ExerciseJSON)
		if sentence == "" {
			continue
		}
		lower := strings.ToLower(sentence)
		for i, lt := range lowerTerms {
			if strings.Contains(lower, lt) {
				counts[terms[i]]++
			}
		}
	}
	return counts
}

// BuildCoverageSection formats term coverage stats into a compact prompt section.
func BuildCoverageSection(terms []string, counts map[string]int) string {
	if len(terms) == 0 {
		return ""
	}

	var uncovered, low, adequate []string
	for _, term := range terms {
		c := counts[term]
		switch {
		case c == 0:
			uncovered = append(uncovered, term)
		case c <= 2:
			low = append(low, fmt.Sprintf("%s (%d)", term, c))
		default:
			adequate = append(adequate, fmt.Sprintf("%s (%d)", term, c))
		}
	}

	var b strings.Builder
	b.WriteString("Term coverage in existing exercises (prioritize under-covered terms):\n")
	if len(uncovered) > 0 {
		b.WriteString(fmt.Sprintf("- UNCOVERED: %s\n", strings.Join(uncovered, ", ")))
	}
	if len(low) > 0 {
		b.WriteString(fmt.Sprintf("- Low (1-2 uses): %s\n", strings.Join(low, ", ")))
	}
	if len(adequate) > 0 {
		b.WriteString(fmt.Sprintf("- Adequate (3+): %s\n", strings.Join(adequate, ", ")))
	}
	b.WriteString("Focus new exercises on UNCOVERED and Low-coverage terms. Avoid over-repeating Adequate terms.\n")
	return b.String()
}

func extractGermanSentence(exerciseJSON string) string {
	var data struct {
		CorrectGermanSentence string `json:"correct_german_sentence"`
	}
	if err := json.Unmarshal([]byte(exerciseJSON), &data); err != nil {
		return ""
	}
	return data.CorrectGermanSentence
}

// ExtractKeyTerms calls the LLM to extract key terms from a topic prompt.
func ExtractKeyTerms(prompt, apiKey, openaiURL, modelName string) ([]string, error) {
	extractionPrompt := fmt.Sprintf(`You are a language education assistant. Given the following topic description for a German language exercise generator, extract all key terms that exercises should practice.

Key terms include: conjunctions, verbs, prepositions, verb+preposition combinations, fixed phrases, vocabulary items, and any other specific German language elements mentioned or implied by the topic.

Return ONLY a JSON object with a single key "terms" containing an array of strings. Each term should be in German, lowercase, and represent a single concept (e.g., "weil", "sich freuen auf", "nicht nur ... sondern auch", "die Ampel").

Extract between 5 and 50 terms depending on the topic scope. Include both explicitly mentioned terms and terms strongly implied by the topic context.

Topic description:
---
%s
---`, prompt)

	timeout := getOpenAITimeout()
	client := &http.Client{Timeout: timeout}

	openaiReq := OpenAIRequest{
		Model:          modelName,
		Messages:       []Message{{Role: "user", Content: extractionPrompt}},
		ResponseFormat: &ResponseFormat{Type: "json_object"},
	}

	openaiResp, _, err := callChatCompletions(client, openaiURL, apiKey, openaiReq, timeout, "key term extraction")
	if err != nil {
		return nil, fmt.Errorf("key term extraction failed: %w", err)
	}

	var result struct {
		Terms []string `json:"terms"`
	}
	if err := json.Unmarshal([]byte(openaiResp.Choices[0].Message.Content), &result); err != nil {
		return nil, fmt.Errorf("failed to parse key terms response: %w", err)
	}

	// Deduplicate and lowercase
	seen := make(map[string]struct{}, len(result.Terms))
	var terms []string
	for _, t := range result.Terms {
		t = strings.TrimSpace(strings.ToLower(t))
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		terms = append(terms, t)
	}
	sort.Strings(terms)
	return terms, nil
}
