import { state } from './state.js';
import { dom } from './dom.js';
import { isPunctuation, playWordAudio, playSentenceAudio, preloadExerciseWordAudio } from './audio.js';
import { toggleFavoriteAPI, toggleHideExerciseAPI, fetchExplainAPI } from './api.js';
import { toast, confirm } from './ui.js';
import { short } from './scope.js';

let _onSessionComplete = () => {};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const svg = (name, size = 16) => (typeof window.gctIconSvg === 'function' ? window.gctIconSvg(name, size) : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const WRONG_MS = 900;
let wrongTimer = 0;

const currentPerf = () => state.exercisePerformance.get(state.exerciseIds[state.currentExerciseIndex]) || { mistakes: 0, hints: 0 };

// SRS (server: next review after counter² hours): the counter after this answer.
export function nextReviewHours(exercise, perf) {
    const old = exercise.repetition_counter || 0;
    const next = perf.mistakes > 0 ? Math.max(0, old - 1) : perf.hints > 0 ? old : old + 1;
    return next * next;
}

// 0 -> 'now', 4 -> 'in 4 h', 30 -> 'in 2 d'
export function reviewIn(hours) {
    if (hours <= 0) return 'now';
    return hours < 24 ? `in ${hours} h` : `in ${Math.ceil(hours / 24)} d`;
}

// Outcome of a finished sentence: [badge tone, label].
export function outcome(perf) {
    if (perf.mistakes > 0) return ['danger', perf.mistakes === 1 ? 'With 1 mistake' : `With ${perf.mistakes} mistakes`];
    if (perf.hints > 0) return ['warning', 'With hints'];
    return ['success', 'Perfect'];
}

// Progress = answered / total, so the bar is 0% before the first answer.
export function setProgress(answered, total = state.exercises.length) {
    const pct = total ? Math.min(100, (answered / total) * 100) : 0;
    if (dom.progressBar) dom.progressBar.style.width = `${pct}%`;
    if (dom.progressPercentage) dom.progressPercentage.textContent = `${Math.round(pct)}%`;
}

// Status line under the word bank: a wrong pick, else "N mistakes · N hints" (css swaps in the voice commands while listening).
function renderStatus(wrong = '') {
    const el = dom.practiceStatus;
    if (!el) return;
    const perf = currentPerf();
    el.classList.toggle('is-wrong', Boolean(wrong));
    el.innerHTML = wrong
        ? `${svg('x', 14)}<span>“${esc(wrong)}” doesn’t go here yet</span>`
        : `<span class="gct-practice__counts">${plural(perf.mistakes, 'mistake')} · ${plural(perf.hints, 'hint')}</span>`
            + '<span class="gct-practice__listening">Listening · or say <b>weiter</b>, <b>hinweis</b>, <b>überspringen</b></span>';
}

function renderSentence() {
    dom.constructedSentenceEl.innerHTML = state.userSentence.map((w) => (isPunctuation(w)
        ? `<span class="gct-practice__punct">${esc(w)}</span>`
        : `<span class="gct-chip gct-chip--placed">${esc(w)}</span>`)).join('');
    const started = state.userSentence.some((w) => !isPunctuation(w));
    dom.answerPrompt.classList.toggle('hidden', started);
    dom.answerArea?.classList.toggle('is-started', started);
}

const PROVERBS = [
    { de: 'Übung macht den Meister', en: 'Practice makes perfect' },
    { de: 'Aller Anfang ist schwer', en: 'Every beginning is hard' },
    { de: 'Wer rastet, der rostet', en: 'If you rest, you rust' },
    { de: 'Ohne Fleiß kein Preis', en: 'No pain, no gain' },
    { de: 'Es ist noch kein Meister vom Himmel gefallen', en: 'No one is born a master' },
    { de: 'Der Weg ist das Ziel', en: 'The journey is the destination' },
    { de: 'Wissen ist Macht', en: 'Knowledge is power' },
];

let proverbInterval = null;
let proverbIndex = 0;

function showProverb() {
    const deEl = document.getElementById('proverb-de');
    const enEl = document.getElementById('proverb-en');
    if (!deEl || !enEl) return;
    const p = PROVERBS[proverbIndex % PROVERBS.length];
    deEl.textContent = `„${p.de}"`;
    enEl.textContent = p.en;
}

function startProverbRotation() {
    proverbIndex = Math.floor(Math.random() * PROVERBS.length);
    showProverb();
    stopProverbRotation();
    proverbInterval = setInterval(() => {
        const deEl = document.getElementById('proverb-de');
        const enEl = document.getElementById('proverb-en');
        if (!deEl || !enEl) return;
        deEl.classList.add('proverb-fade-out');
        enEl.classList.add('proverb-fade-out');
        setTimeout(() => {
            proverbIndex++;
            showProverb();
            deEl.classList.remove('proverb-fade-out');
            enEl.classList.remove('proverb-fade-out');
        }, 500);
    }, 7000);
}

function stopProverbRotation() {
    if (proverbInterval) {
        clearInterval(proverbInterval);
        proverbInterval = null;
    }
}

function spawnConfetti() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const burst = document.createElement('div');
    burst.className = 'confetti-burst';
    for (let i = 0; i < 10; i++) {
        const dot = document.createElement('div');
        dot.className = 'confetti-dot';
        burst.appendChild(dot);
    }
    dom.feedbackArea.appendChild(burst);
    setTimeout(() => burst.remove(), 1000);
}

export function initExercise({ onSessionComplete }) {
    _onSessionComplete = onSessionComplete;
}

export function getHotkey(index) {
    if (index < 9) {
        return (index + 1).toString(); // 1-9
    } else {
        return String.fromCharCode(97 + index - 9); // a, b, c, etc.
    }
}

export function addPunctuationIfNeeded(exercise, userSentence) {
    const correctWordArray = exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];

    while (userSentence.length < correctWordArray.length) {
        const nextToken = correctWordArray[userSentence.length];
        if (isPunctuation(nextToken)) {
            userSentence.push(nextToken);
        } else {
            break;
        }
    }
}

export function renderExercise() {
    state.isLocked = false;
    state.userSentence = [];
    clearTimeout(wrongTimer);

    // Pending state: word bank + Skip/Hint row; the finished block stays hidden.
    dom.exerciseControls.classList.add('hidden');
    dom.hintBtn.classList.remove('hidden');
    dom.skipExerciseBtn.classList.remove('hidden');
    dom.scrambledWordsContainer.classList.remove('hidden');
    if (dom.scrambledWordsHeader) dom.scrambledWordsHeader.classList.remove('hidden');
    dom.answerArea?.classList.remove('is-done', 'is-mistakes');

    if (state.exercises.length === 0) {
        dom.exerciseContent.classList.add('hidden');
        dom.emptyStateContainer.classList.remove('hidden');
        dom.exerciseCounter.classList.add('hidden');
        dom.hintBtn.classList.add('hidden');
        setProgress(0);
        startProverbRotation();
        return;
    }

    dom.exerciseContent.classList.remove('hidden');
    dom.emptyStateContainer.classList.add('hidden');
    dom.exerciseCounter.classList.remove('hidden');
    stopProverbRotation();

    const exercise = state.exercises[state.currentExerciseIndex];

    addPunctuationIfNeeded(exercise, state.userSentence);

    dom.exerciseCounter.textContent = `${state.currentExerciseIndex + 1} of ${state.exercises.length}`;
    setProgress(state.currentExerciseIndex);

    updateFavoriteButtonState(exercise.is_favorite);

    dom.englishHintEl.textContent = exercise.english_hint;
    dom.scrambledWordsContainer.innerHTML = '';
    dom.correctSentenceDisplay.textContent = '';
    if (dom.nextReviewLabel) dom.nextReviewLabel.textContent = '';

    dom.explanationContainer.classList.add('hidden');
    dom.explainBtn.classList.add('hidden');
    state.explanationText = '';

    // Card caption: the exercise's topic (mobile always; desktop only when it differs from the practised topic).
    const topic = state.topics.find(t => t.id === (exercise.topic_id || state.currentTopicId));
    if (dom.exerciseTopicLabel) {
        dom.exerciseTopicLabel.textContent = topic ? short(topic.name) : '';
        dom.exerciseTopicLabel.classList.toggle('is-other', Boolean(topic && exercise.topic_id && exercise.topic_id !== state.currentTopicId));
    }

    renderSentence();
    renderStatus();

    // Tokenize the correct sentence to create word chips, then shuffle them.
    const allTokens = exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];
    const wordsToDisplay = allTokens.filter(token => !isPunctuation(token));
    for (let i = wordsToDisplay.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [wordsToDisplay[i], wordsToDisplay[j]] = [wordsToDisplay[j], wordsToDisplay[i]];
    }

    // Word chips; the hotkey badge is only shown with a keyboard (css/practice.css).
    wordsToDisplay.forEach((word, index) => {
        const button = document.createElement('button');
        const hotkey = getHotkey(index);
        button.type = 'button';
        button.className = 'btn-word gct-chip'; // .btn-word / .word-collected / .hint-word: hooks for voice.js and hints
        button.dataset.hotkey = hotkey;
        button.dataset.word = word;
        button.innerHTML = `<span class="gct-chip__key" aria-hidden="true">${esc(hotkey)}</span>${esc(word)}`;
        button.addEventListener('click', () => handleWordClick(word, button));
        dom.scrambledWordsContainer.appendChild(button);
    });

    preloadExerciseWordAudio(exercise);
}

// Raw words the learner still has to pick, in order ([] when the sentence is complete).
export function remainingCorrectWords() {
    const exercise = state.exercises[state.currentExerciseIndex];
    if (!exercise) return [];
    const words = (exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [])
        .filter(token => !isPunctuation(token));
    const done = state.userSentence.filter(token => !isPunctuation(token)).length;
    return words.slice(done);
}

export function nextCorrectWord() {
    return remainingCorrectWords()[0] || '';
}

export function handleWordClick(word, button) {
    if (state.isLocked) return;

    const exercise = state.exercises[state.currentExerciseIndex];
    const correctWordArray = exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];

    if (word === nextCorrectWord()) {
        // Correct word
        state.userSentence.push(word);
        addPunctuationIfNeeded(exercise, state.userSentence);

        // The chip stays in the bank, dimmed (gct-chip--used look), so the layout doesn't jump.
        button.classList.add('word-collected');
        button.classList.remove('hint-word');
        clearTimeout(wrongTimer);
        dom.scrambledWordsContainer.querySelectorAll(".gct-chip--wrong").forEach((b) => b.classList.remove("gct-chip--wrong", "gct-shake"));
        renderSentence();
        renderStatus();

        // Check if sentence is complete
        if (state.userSentence.length === correctWordArray.length) {
            handleSentenceCompletion(exercise, correctWordArray, word);
        } else {
            playWordAudio(word);
        }
    } else {
        // Incorrect word
        state.mistakes++;
        state.exercisesWithMistakes.add(state.currentExerciseIndex);

        // Track per-exercise mistake using actual ID instead of index
        const exerciseId = state.exerciseIds[state.currentExerciseIndex];

        // Track specific wrong words along with their context for better explanations
        if (!state.exerciseMistakes[exerciseId]) {
            state.exerciseMistakes[exerciseId] = new Set();
        }
        
        let contextStr = state.userSentence.join(' ').trim();
        let mistakeDesc = contextStr 
            ? `Tried to use "${word}" as the next word after successfully building: "${contextStr} "`
            : `Tried to use "${word}" as the very first word of the sentence`;
            
        state.exerciseMistakes[exerciseId].add(mistakeDesc);

        if (exerciseId && state.exercisePerformance.has(exerciseId)) {
            const perf = state.exercisePerformance.get(exerciseId);
            perf.mistakes++;
        }

        // Wrong chip: red + 300ms shake; the status line names it for WRONG_MS.
        dom.scrambledWordsContainer.querySelectorAll('.gct-chip--wrong').forEach((b) => b.classList.remove('gct-chip--wrong', 'gct-shake'));
        button.classList.add('gct-chip--wrong');
        button.classList.add('gct-shake');
        renderStatus(word);
        clearTimeout(wrongTimer);
        wrongTimer = setTimeout(() => {
            button.classList.remove('gct-chip--wrong', 'gct-shake');
            renderStatus();
        }, WRONG_MS);
    }
}

async function handleSentenceCompletion(exercise, correctWordArray, lastWord = '') {
    state.isLocked = true;
    const isCorrect = state.userSentence.join(' ') === correctWordArray.join(' ');

    if (isCorrect) {
        const exerciseId = state.exerciseIds[state.currentExerciseIndex];
        const perf = state.exercisePerformance.get(exerciseId) || { mistakes: 0, hints: 0 };
        const [tone, label] = outcome(perf);
        if (tone === 'success') spawnConfetti(); // confetti only for Perfect
        dom.correctSentenceDisplay.textContent = '';

        dom.completionStatusIndicator.innerHTML = `<span class="gct-badge gct-badge--${tone}"><span class="gct-badge__dot"></span>${label}</span>`;
        if (dom.nextReviewLabel) {
            dom.nextReviewLabel.textContent = state.isLoggedIn ? `Next review ${reviewIn(nextReviewHours(exercise, perf))}` : '';
        }
        dom.answerArea?.classList.add('is-done');
        dom.answerArea?.classList.toggle('is-mistakes', perf.mistakes > 0);

        state.lastAudioUrl = exercise.audio_file_path;
        state.lastAudioText = exercise.correct_german_sentence;

        if (exerciseId) {
            state.completedExerciseIds.add(exerciseId);
        }
        setProgress(state.currentExerciseIndex + 1);

        // Finished block replaces the word bank and the Skip/Hint row.
        dom.exerciseControls.classList.remove('hidden');
        dom.hintBtn.classList.add('hidden');
        dom.skipExerciseBtn.classList.add('hidden');
        dom.scrambledWordsContainer.classList.add('hidden');
        if (dom.scrambledWordsHeader) dom.scrambledWordsHeader.classList.add('hidden');

        // Explain only when this exercise had mistakes.
        if (state.exerciseMistakes[exerciseId] && state.exerciseMistakes[exerciseId].size > 0) {
            dom.explainBtn.classList.remove('hidden');
        }

        if (lastWord) {
            await playWordAudio(lastWord);
        }
        if (state.autoplaySentence) playSentenceAudio(state.lastAudioUrl, state.lastAudioText);
    } else {
        state.mistakes++;

        const wrongWords = dom.scrambledWordsContainer.querySelectorAll('.btn-word.word-collected');
        wrongWords.forEach(btn => {
            btn.classList.add('gct-chip--wrong', 'gct-shake');
            setTimeout(() => btn.classList.remove('gct-chip--wrong', 'gct-shake'), WRONG_MS);
        });

        // Reset for another try
        setTimeout(() => {
            state.userSentence = [];
            renderExercise();
        }, 1500);
    }
}

export function handleHintClick() {
    if (state.isLocked || state.exercises.length === 0) return;

    const exercise = state.exercises[state.currentExerciseIndex];
    const correctWordArray = exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];
    const nonPunctuationWords = correctWordArray.filter(token => !isPunctuation(token));

    const userWords = state.userSentence.filter(token => !isPunctuation(token));

    if (userWords.length < nonPunctuationWords.length) {
        const nextCorrectWord = nonPunctuationWords[userWords.length];
        const availableButtons = dom.scrambledWordsContainer.querySelectorAll('.btn-word:not(.word-collected)');

        for (const button of availableButtons) {
            if (button.dataset.word === nextCorrectWord) {
                button.classList.add('hint-word');
                state.hintsUsed++;
                state.exercisesWithHints.add(state.currentExerciseIndex);

                // Track per-exercise hint
                const exerciseId = state.exerciseIds[state.currentExerciseIndex];
                if (exerciseId && state.exercisePerformance.has(exerciseId)) {
                    const perf = state.exercisePerformance.get(exerciseId);
                    perf.hints++;
                }
                renderStatus(); // the hint stays highlighted until that chip is picked
                break;
            }
        }
    }
}

export function handleKeyPress(event) {
    if (event.key === 'Enter' && !dom.exerciseControls.classList.contains('hidden')) {
        handleNextExercise();
        return;
    }
    if (state.isLocked) return;

    const key = event.key.toLowerCase();
    const wordButtons = dom.scrambledWordsContainer.querySelectorAll('.btn-word:not(.word-collected)');

    for (const button of wordButtons) {
        if (button.dataset.hotkey === key) {
            button.click();
            break;
        }
    }
}

export async function handleExplainClick() {
    if (state.isExplaining) return;

    const exercise = state.exercises[state.currentExerciseIndex];
    const exerciseId = state.exerciseIds[state.currentExerciseIndex];
    const correctSentence = exercise.correct_german_sentence;
    const topic = exercise.conjunction_topic || "Grammar Rule";

    // Capture the exact exercise ID to avoid race conditions when navigating away
    const requestingExerciseId = exerciseId;

    let mistakesArray = [];
    if (state.exerciseMistakes[requestingExerciseId]) {
        mistakesArray = Array.from(state.exerciseMistakes[requestingExerciseId]);
    }

    state.isExplaining = true;

    // UI Loading state
    dom.explainBtn.disabled = true;
    const btnText = dom.explainBtn.querySelector('.gct-practice__explain-text');
    const spinner = dom.explainBtn.querySelector('.gct-practice__spinner');

    if (btnText && spinner) {
        btnText.textContent = 'Explaining…';
        spinner.classList.remove('hidden');
    }

    try {
        const data = await fetchExplainAPI(topic, correctSentence, mistakesArray);

        // Only update UI and state if the user hasn't navigated to the next exercise
        const currentExerciseId = state.exerciseIds[state.currentExerciseIndex];
        if (currentExerciseId === requestingExerciseId) {
            state.explanationText = data.explanation;
            dom.explanationText.textContent = state.explanationText;
            dom.explanationContainer.classList.remove('hidden');
            
            // Limit abuse: remove the button once explanation is successfully loaded
            dom.explainBtn.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error fetching explanation:', error);
        toast({ tone: 'danger', text: 'Failed to load the explanation. Please try again.' });
    } finally {
        state.isExplaining = false;
        dom.explainBtn.disabled = false;

        if (btnText && spinner) {
            btnText.textContent = 'Explain mistakes';
            spinner.classList.add('hidden');
        }
    }
}

export function handleNextExercise() {
    if (state.currentExerciseIndex < state.exercises.length - 1) {
        state.currentExerciseIndex++;
        renderExercise();
    } else {
        _onSessionComplete();
    }
}

// Shift an index-keyed set after removing queue item i (the summary reads these by index).
const dropIndex = (set, i) => new Set([...set].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j)));

// Remove the current exercise from the session queue (client-side only) and move on.
function dropCurrent() {
    const i = state.currentExerciseIndex;
    const wasLastExercise = i === state.exercises.length - 1;
    const exerciseId = state.exerciseIds[i];
    if (exerciseId) {
        state.exercisePerformance.delete(exerciseId);
        state.completedExerciseIds.delete(exerciseId);
        delete state.exerciseMistakes[exerciseId];
    }
    state.exercises.splice(i, 1);
    state.exerciseIds.splice(i, 1);
    state.exercisesWithMistakes = dropIndex(state.exercisesWithMistakes, i);
    state.exercisesWithHints = dropIndex(state.exercisesWithHints, i);

    if (state.exercises.length === 0 || wasLastExercise) {
        _onSessionComplete();
        return;
    }
    if (state.currentExerciseIndex >= state.exercises.length) {
        state.currentExerciseIndex = state.exercises.length - 1;
    }
    renderExercise();
}

export function handleSkipExercise() {
    dropCurrent();
}

export async function handleHideExercise() {
    if (!state.isLoggedIn) return;
    const exerciseId = state.exerciseIds[state.currentExerciseIndex];
    try {
        await toggleHideExerciseAPI(exerciseId);
    } catch (error) {
        console.error('Error hiding exercise:', error);
        toast({ tone: 'danger', text: 'Failed to remove the exercise. Please try again.' });
        return;
    }
    // The learner may have moved on during the request; only drop the item that was hidden.
    if (state.exerciseIds[state.currentExerciseIndex] === exerciseId) dropCurrent();
}

export async function handleToggleFavorite() {
    if (!state.isLoggedIn) return;

    const exercise = state.exercises[state.currentExerciseIndex];
    const exerciseId = state.exerciseIds[state.currentExerciseIndex];

    // Optimistic UI update
    const newStatus = !exercise.is_favorite;
    exercise.is_favorite = newStatus;
    updateFavoriteButtonState(newStatus);

    try {
        const data = await toggleFavoriteAPI(exerciseId);
        // Ensure state matches server response
        exercise.is_favorite = data.is_favorite;
        updateFavoriteButtonState(exercise.is_favorite);
    } catch (error) {
        console.error('Error toggling favorite:', error);
        // Revert on error
        exercise.is_favorite = !newStatus;
        updateFavoriteButtonState(exercise.is_favorite);
        toast({ tone: 'danger', text: 'Failed to update the favorite. Please try again.' });
    }
}

export function updateFavoriteButtonState(isFavorite) {
    const on = Boolean(isFavorite);
    dom.toggleFavoriteBtn.setAttribute('aria-pressed', String(on)); // css fills the star
    dom.toggleFavoriteBtn.title = on ? 'Remove from favorites' : 'Add to favorites';
}

// Skip button: skip for now, or (logged in) hide it from every future session.
export async function confirmSkip() {
    const actions = [{ label: 'Skip for now', kind: 'primary', value: 'skip' }];
    if (state.isLoggedIn) actions.push({ label: 'Never show again', kind: 'secondary', value: 'hide' });
    actions.push({ label: 'Cancel', kind: 'ghost' });
    const choice = await confirm({
        title: 'Skip this sentence?',
        body: state.isLoggedIn ? 'Skipping keeps it in your reviews. Hiding removes it from every future session.' : 'It stays in the pool for a later session.',
        actions,
    });
    if (choice === 'skip') handleSkipExercise();
    else if (choice === 'hide') handleHideExercise();
}

