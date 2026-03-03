# Variation Profile Plan (Agent Task)

## Context
Current generation relies on a two-step flow:
1. Refine the topic prompt.
2. Generate exercises from the refined prompt.

This improves variety sometimes, but it is fragile across providers and can fail when refinement output is malformed. We need diversity without making generation brittle.

## Objective
Introduce a backend-driven "variation profile" that makes each generation intentionally different while keeping output format stable.

## Non-Goals
- Do not change SRS ranking logic.
- Do not redesign frontend exercise rendering.
- Do not require manual prompt edits for each generation.

## Proposed Design

### 1) Build a Variation Profile per generation request
Create a profile object with constrained random choices:
- `conjunction_set`: subset of target conjunction patterns.
- `tense_mix`: e.g., present/past/perfect distribution.
- `subject_mix`: ich/du/er/sie/plural balance.
- `sentence_forms`: declarative/question/negation/contrast.
- `clause_patterns`: subordinate-main, inversion, long/short clauses.
- `vocabulary_theme`: migration/work/education/family/etc.
- `difficulty_level`: B1 baseline with optional harder variants.
- `max_repetition_rules`: limits for reused words/structures.

Use weighted randomization with a seed so profiles are reproducible in logs.

### 2) Generate from a Stable Template + Profile
Stop depending on free-form refinement as the primary variation mechanism.

Compose final prompt as:
- Base topic prompt.
- Strict json output schema block.
- Variation profile block (explicit constraints).
- Diversity constraints (no near duplicates, varied syntax).

Keep `response_format=json_object`.

### 3) Post-generation Quality Gate
Before caching, validate the generated set:
- Ensure exactly required count.
- Ensure required fields exist.
- Detect near-duplicates by normalized sentence similarity.
- Enforce conjunction coverage requested by `conjunction_set`.

If checks fail, do one bounded retry with a stricter corrective instruction.

### 4) Observability
For each generation, log:
- `generation_batch_id`
- provider/model/latency
- variation profile seed + selected dimensions
- quality gate failures/reasons
- retry count

Expose last used profile in observability endpoint (or new debug endpoint).

## Data Model Changes
Add optional metadata fields to `exercises` storage (or side table):
- `generation_batch_id` (TEXT)
- `generation_profile_json` (TEXT)

If schema change is too heavy for phase 1, log profile only; persist in phase 2.

## Implementation Tasks

1. Add profile builder in `pkg/llm`.
- File: `pkg/llm/variation_profile.go`
- Input: topic prompt, topic id, request timestamp.
- Output: typed `VariationProfile` + seed.

2. Add prompt composer.
- File: `pkg/llm/prompt_builder.go`
- Function: `BuildGenerationPrompt(topicPrompt string, profile VariationProfile) string`.
- Guarantee lowercase `json` in final prompt.

3. Integrate in generation flow.
- File: `pkg/llm/openai.go`
- Replace refine-first path with profile-first path.
- Keep refinement behind feature flag fallback (`ENABLE_PROMPT_REFINEMENT=true`).

4. Add quality gate.
- File: `pkg/llm/quality_gate.go`
- Function: `ValidateExerciseSet(exercises []GeneratedExercise, profile VariationProfile) error`.

5. Add logs and request correlation.
- Add `generation_batch_id` in logs end-to-end.
- Include profile summary (not full prompt) in logs.

6. Add tests.
- Unit: profile builder, prompt composer, duplicate detector.
- Integration: generation with mocked provider responses.
- Regression: malformed refine output does not break generation.

## Rollout Plan

### Phase 1
- Ship profile builder + prompt composer + quality gate.
- Keep refinement disabled by default.
- Observe diversity and failure rate.

### Phase 2
- Persist generation profile metadata.
- Add admin/debug view for last N generation batches.

### Phase 3
- Evaluate removing refinement entirely if metrics are stable.

## Acceptance Criteria
- Generation works reliably across configured providers.
- 400 errors related to missing `json` prompt keyword drop to zero.
- New batches show measurable diversity:
  - lower duplicate/near-duplicate rate,
  - wider conjunction and structure coverage.
- No regression in existing SRS flow and frontend rendering.

## Suggested Metrics
- `generation_success_rate`
- `provider_4xx_rate`
- `json_parse_failure_rate`
- `near_duplicate_rate`
- `avg_generation_latency_ms`

## Agent Execution Notes
- Keep changes incremental and feature-flagged.
- Prefer deterministic tests over snapshot-style prompt tests.
- Do not modify unrelated files in a dirty worktree.
