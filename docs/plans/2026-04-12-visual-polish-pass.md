# Visual Polish Pass

## Overview
Add four visual polish improvements to the German Grammar Trainer that enhance the feeling of using the app without changing any functionality. All changes are CSS/HTML-only (with minor JS for confetti triggers and proverb rotation). No backend changes.

Features:
1. **Success celebration** — CSS confetti burst on correct answer
2. **Empty state personality** — rotating German proverbs with translations
3. **Alive progress bar** — shimmer animation, milestone markers, counting number
4. **Breathing background** — slow gradient position animation

## Context (from discovery)
- Files involved: `style.css`, `index.html`, `js/exercise.js` (confetti trigger + proverb rotation)
- Current empty state: `#empty-state-container` with plain text (index.html:86-89)
- Current progress bar: HTML `<progress>` element (index.html:67)
- Current success feedback: `.correct-answer-feedback` class applied in exercise.js
- Background: body radial/linear gradients (style.css:58-61)
- No test changes needed — these are purely visual, non-functional changes

## Development Approach
- **Testing approach**: Regular (no unit tests for CSS-only visual changes)
- Complete each task fully before moving to the next
- Make small, focused changes
- Visual verification after each task — load the app and confirm the effect
- Run existing tests after each task to ensure nothing breaks

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix

## Implementation Steps

### Task 1: CSS confetti burst on correct answer
- [x] Add confetti keyframe animation to `style.css` — 8-12 small colored dots that burst outward from center, scale up, and fade out over ~0.8s
- [x] Add `.confetti-burst` container class and `.confetti-dot` particle styles (absolute positioned, various colors from the warm palette + green for success)
- [x] In `js/exercise.js`, when correct answer is detected (where `.correct-answer-feedback` is shown), inject a temporary confetti container into `#feedback-area` with 10 dot elements, remove after animation completes (~1s)
- [x] Ensure confetti does not affect layout (absolute/fixed positioning, pointer-events: none, overflow considerations)
- [x] Run existing tests (`npx vitest run`) — must pass

### Task 2: Empty state with rotating German proverbs
- [x] Replace static empty state text in `index.html` (`#empty-state-container`) with a structure that supports rotating content: a proverb line (German) and a translation line (English), plus the existing CTA text
- [x] Add 6-8 German proverbs with translations as a JS array in `js/exercise.js` (or inline in the empty state logic), e.g. "Übung macht den Meister — Practice makes perfect"
- [x] Add JS to rotate proverbs every 6-8 seconds with a CSS crossfade transition (opacity 0→1→0)
- [x] Style the proverb text distinctively — larger font, italic German text, muted translation below
- [x] Add CSS transition for the crossfade (`.proverb-fade-in`, `.proverb-fade-out` keyframes)
- [x] Run existing tests (`npx vitest run`) — must pass

### Task 3: Alive progress bar with shimmer and counting
- [x] Replace HTML `<progress>` element with a custom div-based progress bar in `index.html` (a track div containing a fill div) to enable CSS animations
- [x] Add shimmer animation to the fill bar — a subtle light streak moving left-to-right every 2-3s (CSS gradient animation on pseudo-element)
- [x] Add milestone markers at 25%, 50%, 75% as small tick marks or dots on the track
- [x] Update `js/exercise.js` (or wherever progress is updated) to set the fill width via CSS custom property or inline style, and animate the percentage counter with a brief counting-up effect (requestAnimationFrame or CSS counter, ~300ms transition)
- [x] Ensure the custom bar matches the existing orange gradient style and rounded corners
- [x] Run existing tests (`npx vitest run`) — must pass; update any tests that reference the `<progress>` element if needed

### Task 4: Breathing background gradient
- [x] Add a slow CSS keyframe animation (`@keyframes background-breathe`) that shifts the radial gradient positions over 20-30 seconds — e.g. circle center moves from `10% 8%` to `15% 12%` and back
- [x] Apply animation to `body` background with `animation: background-breathe 25s ease-in-out infinite`
- [x] Use `background-size: 400% 400%` or animated `background-position` to keep the effect smooth and imperceptible at a glance
- [x] Verify no jank or repaint cost on mobile (the animation should be GPU-composited)
- [x] Add `prefers-reduced-motion` media query to disable the background animation for accessibility
- [x] Run existing tests (`npx vitest run`) — must pass

### Task 5: Verify acceptance criteria
- [x] Verify confetti fires on every correct answer and cleans up
- [x] Verify empty state shows rotating proverbs with smooth transitions
- [x] Verify progress bar has shimmer, milestones, and counting animation
- [x] Verify background subtly animates without distraction
- [x] Verify `prefers-reduced-motion` disables background animation
- [x] Run full test suite (`npx vitest run`)
- [x] Visual check on mobile viewport (responsive, no overflow issues)

### Task 6: [Final] Update cache version
- [x] Bump the CSS cache version in `index.html` (`style.css?v=...`) to ensure users get the updated styles

## Technical Details

**Confetti implementation:**
- 10 `.confetti-dot` elements, each 6-8px circles
- Colors: `#ef8639`, `#2f9f59`, `#f59e44`, `#d86424`, `#fbbf24` (warm palette + success green + gold)
- Animation: random spread via `nth-child` selectors setting different `translate()` endpoints and rotation
- Duration: 0.8s ease-out, removed from DOM after 1s via `setTimeout`

**Proverb rotation:**
- Array of `{de: "...", en: "..."}` objects
- `setInterval` every 7s, with CSS opacity transition (0.5s fade out, swap text, 0.5s fade in)
- Only active when empty state is visible; clear interval when exercises start

**Progress bar:**
- Track: `div.progress-track` with existing `rgba(163, 63, 17, 0.15)` background
- Fill: `div.progress-fill` with existing orange gradient, width set via `style.width`
- Shimmer: `::after` pseudo-element with translucent white gradient, `translateX(-100% → 100%)` over 2.5s
- Milestones: 3 small `div.progress-milestone` elements at 25/50/75%, absolute positioned
- Number: `transition: all 0.3s` on the percentage text for smooth counting feel

**Background breathing:**
- Animate `background-position` rather than redefining gradients (cheaper)
- Use `background-size: 200% 200%` and shift position in a figure-8 pattern
- 25s cycle, `ease-in-out`, `infinite`

## Post-Completion

**Manual verification:**
- Test on Chrome, Safari, Firefox (CSS animation compatibility)
- Test with `prefers-reduced-motion: reduce` enabled in dev tools
- Verify no performance regression on mobile (check FPS in dev tools)
