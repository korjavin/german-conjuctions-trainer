import { state } from './state.js';
import { dom } from './dom.js';
import { fetchExercisesFromAPI } from './api.js';
import { route } from './router.js';
import { flattenExercise, takeStashedExercises, makeBatch, sendBatch, enqueueBatch, SESSION_SIZE } from './offline.js';
import { toast } from './ui.js';
import { tree, scopeNode, short, startPractice } from './scope.js';
import { nextReviewHours, reviewIn, setProgress } from './exercise.js';

let _renderExercise = () => {};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const svg = (name, size = 16) => (typeof window.gctIconSvg === 'function' ? window.gctIconSvg(name, size) : '');

export function initSession({ renderExercise }) {
    _renderExercise = renderExercise;
    // The saved session refreshed the due counts: the summary's due line and footer follow.
    window.addEventListener('progresschange', () => renderSummaryDue(scopeDue()));
}

// state.currentTopicId '' = All topics: the server serves cached due items, never generates.
export async function fetchExercises() {
    dom.loadingSpinner.classList.remove('hidden');
    dom.exerciseContent.classList.add('hidden');
    dom.emptyStateContainer?.classList.add('hidden');
    dom.generateBtn.disabled = true;
    // Seconds counter on the loading card (LLM generation takes 10–30 s).
    clearInterval(state.timerInterval);
    state.timer = 0;
    dom.timer.textContent = state.timer;
    state.timerInterval = setInterval(() => {
        state.timer++;
        dom.timer.textContent = state.timer;
    }, 1000);

    try {
        let exercises;
        if (navigator.onLine === false) {
            // Known offline: don't even try the network, serve the stash.
            exercises = takeStashedExercises(SESSION_SIZE, state.currentTopicId);
        } else {
            try {
                const data = await fetchExercisesFromAPI(state.currentTopicId);
                exercises = (data.exercises || []).map(flattenExercise);
            } catch (error) {
                // Network (or server) failure: fall back to the offline stash.
                // With an empty stash there is nothing to serve, so let the
                // original error reporting below handle it.
                exercises = takeStashedExercises(SESSION_SIZE, state.currentTopicId);
                if (exercises.length === 0) throw error;
                console.warn('Serving exercises from the offline cache:', error);
            }
        }

        if (exercises.length > 0) {
            state.exercises = exercises;
            state.exerciseIds = exercises.map(ex => ex.id);
            state.currentExerciseIndex = 0;
            state.mistakes = 0;
            state.hintsUsed = 0;
            state.sessionTime = 0;
            state.isSessionComplete = false;
            state.exercisesWithMistakes = new Set();
            state.exerciseMistakes = {};
            state.exercisesWithHints = new Set();
            state.exercisePerformance = new Map();
            state.completedExerciseIds = new Set();

            // Initialize performance tracking for each exercise
            state.exerciseIds.forEach(id => {
                state.exercisePerformance.set(id, { hints: 0, mistakes: 0 });
            });

            state.startTime = Date.now();
            _renderExercise();
        } else if (navigator.onLine === false) {
            toast({ tone: 'danger', text: 'You are offline and no exercises are cached for offline practice. Reconnect and press "Update offline cache" to download some.' });
            _renderExercise(); // Render empty state
        } else {
            // This can happen if generation fails or cache is empty and generation is disabled
            toast({ tone: 'danger', text: 'No exercises could be retrieved for this topic. Try another topic or contact support.' });
            _renderExercise(); // Render empty state
        }

    } catch (error) {
        console.error('Error fetching exercises:', error);
        if (error.status === 429) {
            toast({ tone: 'danger', text: `Rate Limit Exceeded: ${error.message}` });
        } else if (error.status === 504 || error.code === 'UPSTREAM_TIMEOUT') {
            toast({ tone: 'danger', text: `The AI provider took too long to respond. Try again in a moment. (${error.message})` });
        } else {
            const retryHint = error.retryable ? ' You can retry this request.' : '';
            toast({ tone: 'danger', text: `Failed to fetch new exercises: ${error.message}.${retryHint}` });
        }
        _renderExercise();
    } finally {
        dom.loadingSpinner.classList.add('hidden');
        clearInterval(state.timerInterval);
        // Keep button disabled and re-enable after 5 seconds
        setTimeout(() => {
            dom.generateBtn.disabled = false;
        }, 5000);
    }
}

// Same numbers the Chart.js summary showed: per-index mistake/hint sets, perfect = neither.
export function sessionStats() {
    let perfect = 0;
    for (let i = 0; i < state.exercises.length; i++) {
        if (!state.exercisesWithMistakes.has(i) && !state.exercisesWithHints.has(i)) perfect++;
    }
    return { perfect, hints: state.exercisesWithHints.size, mistakes: state.exercisesWithMistakes.size, total: state.exercises.length };
}

// Indices of the sentences worth another look (any mistake or hint), in session order.
export const missedIndices = () => [...new Set([...state.exercisesWithMistakes, ...state.exercisesWithHints])]
    .filter((i) => i < state.exercises.length).sort((a, b) => a - b);

// "1 now, 2 in 4 h, 4 in 1 d" for the sentences finished this session.
export function nextReviewsText() {
    const counts = new Map();
    state.exercises.forEach((ex) => {
        if (!state.completedExerciseIds.has(ex.id)) return;
        const h = nextReviewHours(ex, state.exercisePerformance.get(ex.id) || { mistakes: 0, hints: 0 });
        counts.set(h, (counts.get(h) || 0) + 1);
    });
    return [...counts].sort((a, b) => a[0] - b[0]).map(([h, n]) => `${n} ${reviewIn(h)}`).join(', ');
}

export const formatDuration = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

const scopeDue = () => (scopeNode() ? scopeNode().due : tree.due);

// Due line + footer; re-rendered when the saved session refreshes the due counts (progresschange).
function summaryFootHtml(due) {
    const keep = due > 0 && state.isLoggedIn;
    return `<a href="#/today" class="gct-btn gct-btn--${keep ? 'ghost' : 'primary'} gct-btn--lg">Back to Today</a>`
        + (keep ? `<button type="button" class="gct-btn gct-btn--primary gct-btn--lg" data-summary="keep">Keep reviewing · ${due} due${svg('arrow-right')}</button>` : '');
}
const dueLine = (due) => (due > 0 ? `${due} more ${due === 1 ? 'sentence is' : 'sentences are'} due today.` : 'Nothing else is due right now.');

function renderSummaryDue(due) {
    const box = document.getElementById('statistics-container');
    if (!box) return;
    const sub = box.querySelector('[data-summary="due"]');
    if (sub) sub.textContent = dueLine(due);
    box.querySelector('.gct-summary__foot').innerHTML = summaryFootHtml(due);
}

export function showStatisticsPage() {
    state.isSessionComplete = true;
    state.sessionTime = Math.floor((Date.now() - state.startTime) / 1000);

    if (state.isLoggedIn) {
        saveUserStats();
    }

    const { perfect, hints, mistakes, total } = sessionStats();
    const missed = missedIndices();
    const topic = tree.byId.get(state.currentTopicId);
    // Until the saved session refreshes the counts, estimate: the scope's due minus what was just reviewed.
    const due = Math.max(0, scopeDue() - state.completedExerciseIds.size);
    const reviews = state.isLoggedIn ? nextReviewsText() : '';
    const tiles = [['Perfect', perfect, '--outcome-perfect'], ['With hints', hints, '--outcome-hints'], ['With mistakes', mistakes, '--outcome-mistakes']];

    const box = document.createElement('div');
    box.id = 'statistics-container'; // js/router.js guards #/summary on it
    box.className = 'gct-summary';
    box.innerHTML = '<div class="caption gct-summary__caption">Session done</div>'
        + `<div class="gct-summary__head"><span class="gct-summary__score">${perfect}<span>/${total}</span></span>`
        + `<div class="gct-summary__headline"><div class="gct-summary__title">perfect on the first try</div>`
        + `<div class="gct-summary__meta">${esc(topic ? short(topic.name) : 'All topics')} · ${formatDuration(state.sessionTime)}</div></div></div>`
        + '<div class="gct-summary__bar">' + tiles.map(([, v, c]) => (v ? `<div style="flex:${v};background:var(${c})"></div>` : '')).join('') + '</div>'
        + '<div class="gct-summary__tiles">' + tiles.map(([l, v, c]) => `<div class="gct-card gct-summary__tile"><div class="gct-summary__tile-label"><span class="gct-summary__dot" style="background:var(${c})"></span>${l}</div><div class="gct-summary__tile-num">${v}</div></div>`).join('') + '</div>'
        + (state.isLoggedIn ? `<div class="gct-card gct-summary__next">${svg('clock', 22)}<div>${reviews ? `<b>Next reviews:</b> ${reviews}.` : ''}<div class="gct-summary__sub" data-summary="due"></div></div></div>` : '')
        + (missed.length ? '<div class="gct-summary__look-head"><div class="caption">Worth another look</div>'
            + `<button type="button" class="gct-btn gct-btn--secondary gct-btn--sm" data-summary="retry">${svg('retry', 14)}Retry these ${missed.length}</button></div>`
            + '<div class="gct-card gct-summary__list">' + missed.map((i) => {
                const ex = state.exercises[i];
                const perf = state.exercisePerformance.get(ex.id) || { mistakes: 0, hints: 0 };
                const [tone, label] = perf.mistakes > 0 || state.exercisesWithMistakes.has(i)
                    ? ['danger', perf.mistakes > 1 ? `${perf.mistakes} mistakes` : '1 mistake']
                    : ['warning', perf.hints > 1 ? `${perf.hints} hints` : '1 hint'];
                return `<div class="gct-summary__row"><div class="gct-summary__text"><div class="gct-summary__de">${esc(ex.correct_german_sentence)}</div><div class="gct-summary__en">${esc(ex.english_hint)}</div></div>`
                    + `<span class="gct-badge gct-badge--${tone} gct-badge--quiet"><span class="gct-badge__dot"></span>${label}</span></div>`;
            }).join('') + '</div>' : '')
        + `<a href="#/listen" class="gct-summary__podcast">${svg('listen', 18)}Turn this lesson into a podcast for the commute<span class="gct-practice__grow"></span>${svg('chevron-right')}</a>`
        + '<div class="gct-summary__foot"></div>';

    box.addEventListener('click', (e) => {
        const act = e.target.closest('[data-summary]')?.dataset.summary;
        if (act === 'retry') resetForSameExercises(missed);
        else if (act === 'keep') startPractice();
    });

    // The summary is its own route (#/summary); the practice card stays put in #/practice.
    document.getElementById('screen-summary').replaceChildren(box);
    renderSummaryDue(due);
    setProgress(total, total);
    if (dom.exerciseCounter) dom.exerciseCounter.textContent = `${total} of ${total}`;
    route('summary');
}

// X in the practice bar mid-session: finished sentences are saved, the rest is dropped.
export function endSession() {
    if (state.isLoggedIn && state.completedExerciseIds.size > 0) {
        state.sessionTime = Math.floor((Date.now() - state.startTime) / 1000);
        saveUserStats(state.completedExerciseIds.size);
    }
    state.isSessionComplete = true;
    state.exercises = [];
    state.exerciseIds = [];
    _renderExercise();
}

export const sessionInProgress = () => state.exercises.length > 0 && !state.isSessionComplete;

function clearSummary() {
    document.getElementById('statistics-container')?.remove();
    dom.loadingSpinner.classList.add('hidden');
    if (state.timerInterval) clearInterval(state.timerInterval);
    dom.generateBtn.disabled = false;
}

function resetCounters() {
    state.currentExerciseIndex = 0;
    state.mistakes = 0;
    state.hintsUsed = 0;
    state.sessionTime = 0;
    state.isSessionComplete = false;
    state.exercisesWithMistakes = new Set();
    state.exercisesWithHints = new Set();
    state.exerciseMistakes = {};
    state.completedExerciseIds = new Set();
    state.exercisePerformance = new Map(state.exerciseIds.map((id) => [id, { hints: 0, mistakes: 0 }]));
}

export function resetForNewSession() {
    clearSummary();
    route('practice');
    state.exercises = [];
    state.exerciseIds = [];
    resetCounters();
    state.startTime = null;
    setProgress(0, 0);
    if (dom.exerciseCounter) dom.exerciseCounter.textContent = '';
    fetchExercises();
}

// Retry the session (or just the given indices, e.g. the summary's "Retry these N").
export function resetForSameExercises(indices) {
    clearSummary();
    if (indices) {
        state.exercises = indices.map((i) => state.exercises[i]).filter(Boolean);
        state.exerciseIds = state.exercises.map((ex) => ex.id);
    }
    route('practice');
    resetCounters();
    state.startTime = Date.now();
    _renderExercise();
}

export async function saveUserStats(total = state.exercises.length) {
    const stats = {
        total_exercises: total,
        total_mistakes: state.mistakes,
        total_hints: state.hintsUsed,
        total_time: state.sessionTime,
    };

    // Per-exercise completion data — only exercises actually finished by the user
    const completions = [];
    state.completedExerciseIds.forEach((exerciseId) => {
        const perf = state.exercisePerformance.get(exerciseId) || { hints: 0, mistakes: 0 };
        completions.push({
            exercise_id: exerciseId,
            hints_used: perf.hints,
            mistakes: perf.mistakes
        });
    });

    // Anything that doesn't land (offline, server error) is queued and retried
    // later instead of being dropped. sendBatch clears the parts that landed.
    const batch = makeBatch(stats, completions);
    const delivered = await sendBatch(batch);
    if (!delivered) {
        enqueueBatch(batch);
    } else {
        window.dispatchEvent(new Event('sessionsaved')); // js/scope.js refreshes the due counts
    }
}
