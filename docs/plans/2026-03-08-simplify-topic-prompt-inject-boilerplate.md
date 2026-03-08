---
# Simplify Topic Prompt: Inject Boilerplate Automatically

## Overview
Currently, `topic.Prompt` requires admins to manually write full technical prompts including JSON schema definitions and output format instructions. This plan separates user intent from technical boilerplate: users write only topic + vocabulary + situations, while the backend assembles the complete prompt automatically.

## Context
- Files involved:
  - `pkg/llm/openai.go` — `metaPrompt` constant, `validateRefinedPrompt()`
  - `pkg/llm/prompt_builder.go` — `BuildGenerationPrompt()`
  - `pkg/llm/openai_test.go` — update tests for new behavior
  - `index.html` — prompt textarea placeholders and hint text
- Current flow: `topic.Prompt` (full prompt with JSON schema) → optional `RefinePrompt` → `BuildGenerationPrompt` (adds variation profile + JSON schema again) → send to LLM
- New flow: `topic.Prompt` (simple intent: topic + vocab + situations) → optional `RefinePrompt` (now enhances intent, not full prompt) → `BuildGenerationPrompt` (adds system role preamble + variation profile + JSON schema) → send to LLM
- The `validateRefinedPrompt` currently rejects prompts without the word "json", which will always fail with simple intent prompts
- The `metaPrompt` references "Do Not Change the JSON Schema" which is irrelevant for simple intents

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: Update `metaPrompt` and `validateRefinedPrompt` in openai.go

**Files:**
- Modify: `pkg/llm/openai.go`

- [x] Rewrite the `metaPrompt` constant to target simple intent descriptions. New focus: expand vocabulary range with specific examples, suggest diverse real-life situations, clarify difficulty level, keep the result concise (not a full technical prompt). Remove all references to JSON schema.
- [x] Remove the `!strings.Contains(strings.ToLower(trimmed), "json")` check from `validateRefinedPrompt` — it's enforced downstream by `BuildGenerationPrompt` + `ensurePromptContainsJSON`; the check will always fail for simple intents
- [x] Update `TestRefinePrompt` in `openai_test.go`: change the mock server response to a simple intent without "json" (e.g., "Enhanced topic: B1 conjunctions in daily life and work contexts, varied vocabulary."), remove the assertion that the result contains "json"
- [x] Update `TestGenerateExercisesRefinementFallbackWhenMalformed` in `openai_test.go`: change `basePrompt` from `"Generate grammar exercises and return json."` to a simple intent like `"B1 conjunctions um..zu and damit in daily life situations."` — this exercises the fallback path without requiring "json" in the base prompt
- [x] Run `go test ./pkg/llm/... -run TestRefine` — must pass

### Task 2: Update `BuildGenerationPrompt` to frame simple intents

**Files:**
- Modify: `pkg/llm/prompt_builder.go`

- [x] At the top of `BuildGenerationPrompt`, check if `trimmedBase` already starts with "you are" (case-insensitive). If not, prepend: `"You are an expert German language tutor. Create German language exercises based on the following topic description:\n\n"`. This ensures simple intents get proper system role framing without duplicating the header for old full prompts.
- [x] Add tests in `openai_test.go` (or a new `prompt_builder_test.go`):
  - `TestBuildGenerationPromptAddsPreambleForSimpleIntent`: a simple intent like `"B1 level, um..zu conjunctions"` → result must start with "You are an expert"
  - `TestBuildGenerationPromptNoPreambleForFullPrompt`: a prompt starting with `"You are an expert..."` → preamble NOT duplicated
- [x] Run `go test ./pkg/llm/... -run TestBuildGeneration` — must pass

### Task 3: Update frontend UI prompt fields

**Files:**
- Modify: `index.html`

- [ ] Replace the placeholder on `#new-topic-prompt` textarea (currently `"Enter the prompt for generating exercises..."`) with a structured example:
  ```
  Topic: [grammar concept, e.g. "um...zu" and "damit" conjunctions]
  Level: B1
  Vocabulary: [themes, e.g. daily life, travel, work, common German verbs]
  Situations: [contexts, e.g. explaining reasons, expressing goals, giving instructions]
  ```
- [ ] Add a `<p>` hint element below each prompt textarea (both `#new-topic-prompt` and `#prompt-textarea`) with text: "Describe what to practice: grammar topic, vocabulary themes, and situations. Technical details (JSON format, etc.) are handled automatically."
- [ ] No JS changes needed — this is purely HTML
- [ ] Verify rendering by running the server and viewing the admin panel

### Task 4: Verify acceptance criteria

- [ ] Run full test suite: `go test ./...` — must pass
- [ ] Run linter: `go vet ./...` — must pass
- [ ] Manual test: create a new topic with a simple intent prompt (no JSON schema), trigger exercise generation, verify exercises are generated correctly
- [ ] Manual test: verify existing topics with full prompts (that include JSON schema) still generate exercises correctly (backward compatibility)
- [ ] Verify the "View Last Refined Prompt" debug button shows the final assembled prompt with the system role preamble + variation profile + JSON schema

### Task 5: Update documentation

- [ ] Update README.md if it mentions prompt format
- [ ] Move this plan to `docs/plans/completed/`
