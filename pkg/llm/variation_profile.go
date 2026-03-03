package llm

import (
	"hash/fnv"
	mrand "math/rand"
	"strings"
	"time"

	"german-conjunctions-trainer/pkg/storage"
)

// VariationProfile describes deterministic constraints used to diversify each generation batch.
type VariationProfile struct {
	Seed                 int64    `json:"seed"`
	TargetCount          int      `json:"target_count"`
	ConjunctionSet       []string `json:"conjunction_set,omitempty"`
	TenseMix             []string `json:"tense_mix"`
	SubjectMix           []string `json:"subject_mix"`
	SentenceForms        []string `json:"sentence_forms"`
	ClausePatterns       []string `json:"clause_patterns"`
	VocabularyTheme      string   `json:"vocabulary_theme"`
	DifficultyLevel      string   `json:"difficulty_level"`
	MaxRepetitionPerTerm int      `json:"max_repetition_per_term"`
}

const targetExerciseCount = 10

var knownConjunctionPatterns = []string{
	"nicht nur ..., sondern auch",
	"sowohl ... als auch",
	"weder ... noch",
	"entweder ... oder",
}

var tenseMixOptions = [][]string{
	{"present"},
	{"present", "perfect"},
	{"present", "preterite", "perfect"},
}

var subjectPool = []string{
	"ich",
	"du",
	"er/sie",
	"wir",
	"viele Menschen",
	"die Familie",
	"die Auswanderer",
	"die Rueckkehrer",
}

var sentenceFormPool = []string{
	"statement",
	"goal",
	"contrast",
	"negation",
	"question",
}

var clausePatternPool = []string{
	"short-main-clause",
	"subordinate-then-main",
	"inversion-after-adverb",
	"two-clause-comma-structure",
	"modal-verb-structure",
}

// BuildVariationProfile creates one profile per generation request.
func BuildVariationProfile(topic *storage.Topic) VariationProfile {
	seed := createVariationSeed(topic)
	rng := mrand.New(mrand.NewSource(seed))

	conjunctionPool := extractConjunctionPatterns(topic.Prompt)
	selectedConjunctions := selectConjunctionTargets(rng, conjunctionPool)

	return VariationProfile{
		Seed:                 seed,
		TargetCount:          targetExerciseCount,
		ConjunctionSet:       selectedConjunctions,
		TenseMix:             chooseStringSlice(rng, tenseMixOptions),
		SubjectMix:           pickRandomSubset(rng, subjectPool, 3, 5),
		SentenceForms:        pickRandomSubset(rng, sentenceFormPool, 3, 5),
		ClausePatterns:       pickRandomSubset(rng, clausePatternPool, 2, 4),
		VocabularyTheme:      inferVocabularyTheme(topic.Prompt),
		DifficultyLevel:      "B1",
		MaxRepetitionPerTerm: 2 + rng.Intn(2),
	}
}

func createVariationSeed(topic *storage.Topic) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(topic.ID))
	_, _ = h.Write([]byte(topic.Prompt))
	baseHash := int64(h.Sum64())
	return time.Now().UnixNano() ^ baseHash
}

func extractConjunctionPatterns(prompt string) []string {
	lower := strings.ToLower(prompt)
	patterns := make([]string, 0, len(knownConjunctionPatterns))

	if strings.Contains(lower, "nicht nur") && strings.Contains(lower, "sondern auch") {
		patterns = append(patterns, "nicht nur ..., sondern auch")
	}
	if strings.Contains(lower, "sowohl") && strings.Contains(lower, "als auch") {
		patterns = append(patterns, "sowohl ... als auch")
	}
	if strings.Contains(lower, "weder") && strings.Contains(lower, "noch") {
		patterns = append(patterns, "weder ... noch")
	}
	if strings.Contains(lower, "entweder") && strings.Contains(lower, "oder") {
		patterns = append(patterns, "entweder ... oder")
	}

	return patterns
}

func selectConjunctionTargets(rng *mrand.Rand, pool []string) []string {
	if len(pool) == 0 {
		return nil
	}
	candidates := append([]string(nil), pool...)
	rng.Shuffle(len(candidates), func(i, j int) {
		candidates[i], candidates[j] = candidates[j], candidates[i]
	})

	targetCount := len(candidates)
	if len(candidates) > 2 && rng.Intn(100) < 35 {
		targetCount = 2 + rng.Intn(len(candidates)-1)
	}

	selected := append([]string(nil), candidates[:targetCount]...)
	return selected
}

func inferVocabularyTheme(prompt string) string {
	lower := strings.ToLower(prompt)
	switch {
	case strings.Contains(lower, "migration") || strings.Contains(lower, "integration") || strings.Contains(lower, "auswander") || strings.Contains(lower, "rueckkehr"):
		return "migration-integration-living-abroad"
	case strings.Contains(lower, "stud") || strings.Contains(lower, "school") || strings.Contains(lower, "university"):
		return "education-and-career"
	case strings.Contains(lower, "family") || strings.Contains(lower, "famil"):
		return "family-and-daily-life"
	default:
		return "general-b1-context"
	}
}

func chooseStringSlice(rng *mrand.Rand, options [][]string) []string {
	if len(options) == 0 {
		return nil
	}
	picked := options[rng.Intn(len(options))]
	return append([]string(nil), picked...)
}

func pickRandomSubset(rng *mrand.Rand, pool []string, minCount, maxCount int) []string {
	if len(pool) == 0 {
		return nil
	}
	if minCount < 1 {
		minCount = 1
	}
	if maxCount < minCount {
		maxCount = minCount
	}
	if maxCount > len(pool) {
		maxCount = len(pool)
	}
	if minCount > len(pool) {
		minCount = len(pool)
	}

	count := minCount
	if maxCount > minCount {
		count = minCount + rng.Intn(maxCount-minCount+1)
	}

	items := append([]string(nil), pool...)
	rng.Shuffle(len(items), func(i, j int) {
		items[i], items[j] = items[j], items[i]
	})
	return append([]string(nil), items[:count]...)
}
