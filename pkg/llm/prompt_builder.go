package llm

import (
	"fmt"
	"strings"
)

// BuildGenerationPrompt composes a stable prompt with dynamic variation constraints.
func BuildGenerationPrompt(basePrompt string, profile VariationProfile) string {
	trimmedBase := strings.TrimSpace(basePrompt)
	if trimmedBase == "" {
		trimmedBase = "Generate German language exercises for B1 learners."
	}

	// Check if the prompt already starts with a system role preamble
	// This avoids duplicating the preamble for existing full prompts while still
	// adding it for simple intents (topic + vocab + situations descriptions)
	// Case-insensitive check to handle variations in capitalization
	// Any prompt starting with "you are" is considered to have a preamble
	const youArePrefix = "you are"
	if !strings.HasPrefix(strings.ToLower(trimmedBase), youArePrefix) {
		trimmedBase = "You are an expert German language tutor. Create German language exercises based on the following topic description:\n\n" + trimmedBase
	}

	var b strings.Builder
	b.WriteString(trimmedBase)
	b.WriteString("\n\nSystem-generated variation profile (follow all constraints and do not mention this profile in the output):\n")
	b.WriteString(fmt.Sprintf("- Create exactly %d unique exercises.\n", profile.TargetCount))

	if len(profile.ConjunctionSet) > 0 {
		b.WriteString(fmt.Sprintf("- Cover each of these conjunction patterns at least once across the set: %s.\n", strings.Join(profile.ConjunctionSet, "; ")))
	}
	if len(profile.TenseMix) > 0 {
		b.WriteString(fmt.Sprintf("- Use this tense mix across the set: %s.\n", strings.Join(profile.TenseMix, ", ")))
	}
	if len(profile.SubjectMix) > 0 {
		b.WriteString(fmt.Sprintf("- Rotate subjects so these appear naturally: %s.\n", strings.Join(profile.SubjectMix, ", ")))
	}
	if len(profile.SentenceForms) > 0 {
		b.WriteString(fmt.Sprintf("- Include these sentence forms: %s.\n", strings.Join(profile.SentenceForms, ", ")))
	}
	if len(profile.ClausePatterns) > 0 {
		b.WriteString(fmt.Sprintf("- Use varied clause structures: %s.\n", strings.Join(profile.ClausePatterns, ", ")))
	}

	b.WriteString(fmt.Sprintf("- Keep difficulty around %s.\n", profile.DifficultyLevel))
	b.WriteString(fmt.Sprintf("- Vocabulary theme: %s.\n", profile.VocabularyTheme))
	b.WriteString(fmt.Sprintf("- Limit repeated key terms to at most %d uses when possible.\n", profile.MaxRepetitionPerTerm))
	b.WriteString("- Avoid near-duplicate sentence skeletons.\n")
	b.WriteString("- english_hint must be a natural English translation.\n")
	b.WriteString("- correct_german_sentence must be complete and grammatical.\n")

	b.WriteString("\nOutput contract:\n")
	b.WriteString("- Return only valid json.\n")
	b.WriteString("- Top-level object must contain the key \"exercises\".\n")
	b.WriteString("\nRequired schema (json):\n")
	b.WriteString("{\n")
	b.WriteString("  \"exercises\": [\n")
	b.WriteString("    {\n")
	b.WriteString("      \"english_hint\": \"Natural English translation here\",\n")
	b.WriteString("      \"correct_german_sentence\": \"German sentence here\"\n")
	b.WriteString("    }\n")
	b.WriteString("  ]\n")
	b.WriteString("}\n")

	return b.String()
}

// BuildCorrectivePrompt appends corrective constraints when quality checks fail.
func BuildCorrectivePrompt(previousPrompt string, profile VariationProfile, qualityFailure string) string {
	var b strings.Builder
	b.WriteString(strings.TrimSpace(previousPrompt))
	b.WriteString("\n\nCorrective retry instructions:\n")
	b.WriteString("- Regenerate the entire set from scratch; do not reuse previous wording.\n")
	b.WriteString(fmt.Sprintf("- You must return exactly %d exercises.\n", profile.TargetCount))
	b.WriteString("- Resolve these validation failures: ")
	b.WriteString(qualityFailure)
	b.WriteString("\n")
	b.WriteString("- Return only valid json with top-level key \"exercises\".\n")
	return b.String()
}
