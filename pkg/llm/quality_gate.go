package llm

import (
	"fmt"
	"regexp"
	"strings"
)

var nonWordCharsRegex = regexp.MustCompile(`[^\p{L}\p{N}\s]+`)
var multiSpaceRegex = regexp.MustCompile(`\s+`)

const nearDuplicateThreshold = 0.9
const minTokenCountForNearDuplicate = 5

// ValidateExerciseSet checks output shape and diversity constraints before caching.
func ValidateExerciseSet(exercises []GeneratedExercise, profile VariationProfile) error {
	reasons := make([]string, 0)

	if profile.TargetCount > 0 && len(exercises) != profile.TargetCount {
		reasons = append(reasons, fmt.Sprintf("expected %d exercises but received %d", profile.TargetCount, len(exercises)))
	}

	normalizedToIndex := make(map[string]int, len(exercises))
	normalizedSentences := make([]string, len(exercises))

	for i, ex := range exercises {
		sentence := strings.TrimSpace(ex.CorrectGermanSentence)
		hint := strings.TrimSpace(ex.EnglishHint)

		if sentence == "" {
			reasons = append(reasons, fmt.Sprintf("exercise %d has empty correct_german_sentence", i+1))
			continue
		}
		if hint == "" {
			reasons = append(reasons, fmt.Sprintf("exercise %d has empty english_hint", i+1))
		}

		normalized := normalizeSentence(sentence)
		normalizedSentences[i] = normalized
		if normalized == "" {
			reasons = append(reasons, fmt.Sprintf("exercise %d has invalid normalized sentence", i+1))
			continue
		}

		if firstIndex, exists := normalizedToIndex[normalized]; exists {
			reasons = append(reasons, fmt.Sprintf("exercise %d duplicates exercise %d", i+1, firstIndex))
		} else {
			normalizedToIndex[normalized] = i + 1
		}
	}

	nearDuplicateFindings := findNearDuplicates(normalizedSentences)
	reasons = append(reasons, nearDuplicateFindings...)

	coverageFindings := validateConjunctionCoverage(exercises, profile.ConjunctionSet)
	reasons = append(reasons, coverageFindings...)

	if len(reasons) == 0 {
		return nil
	}

	if len(reasons) > 8 {
		reasons = append(reasons[:8], fmt.Sprintf("... and %d more issues", len(reasons)-8))
	}
	return fmt.Errorf("quality gate failed: %s", strings.Join(reasons, "; "))
}

func normalizeSentence(sentence string) string {
	normalized := strings.ToLower(strings.TrimSpace(sentence))
	normalized = nonWordCharsRegex.ReplaceAllString(normalized, " ")
	normalized = multiSpaceRegex.ReplaceAllString(normalized, " ")
	return strings.TrimSpace(normalized)
}

func findNearDuplicates(normalizedSentences []string) []string {
	findings := make([]string, 0)
	for i := 0; i < len(normalizedSentences); i++ {
		if normalizedSentences[i] == "" {
			continue
		}
		for j := i + 1; j < len(normalizedSentences); j++ {
			if normalizedSentences[j] == "" {
				continue
			}
			tokensI := strings.Fields(normalizedSentences[i])
			tokensJ := strings.Fields(normalizedSentences[j])
			if len(tokensI) < minTokenCountForNearDuplicate || len(tokensJ) < minTokenCountForNearDuplicate {
				continue
			}
			if tokenJaccard(tokensI, tokensJ) >= nearDuplicateThreshold {
				findings = append(findings, fmt.Sprintf("exercise %d and %d are near-duplicates", i+1, j+1))
			}
		}
	}
	return findings
}

func tokenJaccard(a, b []string) float64 {
	if len(a) == 0 && len(b) == 0 {
		return 1
	}
	setA := make(map[string]struct{}, len(a))
	setB := make(map[string]struct{}, len(b))
	for _, token := range a {
		setA[token] = struct{}{}
	}
	for _, token := range b {
		setB[token] = struct{}{}
	}

	intersection := 0
	for token := range setA {
		if _, exists := setB[token]; exists {
			intersection++
		}
	}
	union := len(setA) + len(setB) - intersection
	if union == 0 {
		return 0
	}
	return float64(intersection) / float64(union)
}

func validateConjunctionCoverage(exercises []GeneratedExercise, requiredPatterns []string) []string {
	if len(requiredPatterns) == 0 {
		return nil
	}
	findings := make([]string, 0)
	for _, pattern := range requiredPatterns {
		if !isPatternCovered(exercises, pattern) {
			findings = append(findings, fmt.Sprintf("missing required conjunction coverage for '%s'", pattern))
		}
	}
	return findings
}

func isPatternCovered(exercises []GeneratedExercise, pattern string) bool {
	markers := conjunctionMarkers(pattern)
	if len(markers) == 0 {
		return true
	}

	for _, ex := range exercises {
		sentence := strings.ToLower(ex.CorrectGermanSentence)
		allFound := true
		for _, marker := range markers {
			if !strings.Contains(sentence, marker) {
				allFound = false
				break
			}
		}
		if allFound {
			return true
		}
	}
	return false
}

func conjunctionMarkers(pattern string) []string {
	switch strings.ToLower(strings.TrimSpace(pattern)) {
	case "nicht nur ..., sondern auch":
		return []string{"nicht nur", "sondern auch"}
	case "sowohl ... als auch":
		return []string{"sowohl", "als auch"}
	case "weder ... noch":
		return []string{"weder", "noch"}
	case "entweder ... oder":
		return []string{"entweder", "oder"}
	default:
		return nil
	}
}
