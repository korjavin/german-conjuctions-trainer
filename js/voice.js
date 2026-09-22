// Voice input: speak the words, the matching word buttons get clicked.
// Web Speech API only (Chrome / Android Chrome), no external models.
import { state } from './state.js';
import { dom } from './dom.js';
import { handleWordClick, handleHintClick, handleNextExercise, handleSkipExercise, nextCorrectWord, remainingCorrectWords } from './exercise.js';

// ponytail: STT returns digits, sentences spell numbers out; extend when a miss shows up
const NUMBERS = {
    '0': 'null', '1': 'eins', '2': 'zwei', '3': 'drei', '4': 'vier', '5': 'fünf',
    '6': 'sechs', '7': 'sieben', '8': 'acht', '9': 'neun', '10': 'zehn', '11': 'elf',
    '12': 'zwölf', '13': 'dreizehn', '14': 'vierzehn', '15': 'fünfzehn', '16': 'sechzehn',
    '17': 'siebzehn', '18': 'achtzehn', '19': 'neunzehn', '20': 'zwanzig', '30': 'dreißig',
    '40': 'vierzig', '50': 'fünfzig', '60': 'sechzig', '70': 'siebzig', '80': 'achtzig',
    '90': 'neunzig', '100': 'hundert', '1000': 'tausend',
};
const NEXT_CMDS = new Set(['weiter', 'next', 'nächste', 'nächstes']);
const HINT_CMDS = new Set(['hinweis', 'hint', 'tipp']);
const SKIP_CMDS = new Set(['skip', 'überspringen', 'auslassen']);
const isCommand = tok => NEXT_CMDS.has(tok) || HINT_CMDS.has(tok) || SKIP_CMDS.has(tok);

// A command word that also occurs in the current sentence is never a command for that
// exercise (so the sentence TTS echo can't trigger it either); say the English one instead.
function sentenceWords() {
    const exercise = state.exercises[state.currentExerciseIndex];
    return new Set(tokenize(exercise ? exercise.correct_german_sentence : ''));
}
const FUZZY_MIN_LEN = 4; // im/in, er/es, das/was: too close to fuzzy-match safely

export function normalize(token) {
    const t = token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    return NUMBERS[t] || t;
}

export function tokenize(text) {
    return (text.match(/[\p{L}\p{N}']+/gu) || []).map(normalize).filter(Boolean);
}

export function levenshtein(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 1) return 2; // we only care about <=1
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}

// candidates: [{ key, button }]. Exact match wins; otherwise Levenshtein<=1 if unambiguous.
export function matchCandidate(spoken, candidates) {
    const exact = candidates.find(c => c.key === spoken);
    if (exact) return exact;
    if (spoken.length < FUZZY_MIN_LEN) return null;
    const fuzzy = candidates.filter(c => levenshtein(spoken, c.key) <= 1);
    const distinct = new Set(fuzzy.map(c => c.key));
    return distinct.size === 1 ? fuzzy[0] : null;
}

function similar(spoken, key) {
    return spoken === key || (spoken.length >= FUZZY_MIN_LEN && levenshtein(spoken, key) <= 1);
}

// STT merges/drops function words ("zu einem Termin" -> "zum Termin"); pick the
// alternative that follows the expected word order the furthest.
export function bestAlternative(alternatives, expectedRaw) {
    const expected = expectedRaw.map(normalize);
    let best = alternatives[0] || '';
    let bestScore = -1;
    for (const alt of alternatives) {
        const toks = tokenize(alt);
        let j = 0;
        for (const tok of toks) {
            if (j < expected.length && similar(tok, expected[j])) j++;
        }
        const score = j + (toks.some(isCommand) ? 0.5 : 0); // tie-break towards a command word
        if (score > bestScore) { bestScore = score; best = alt; }
    }
    return best;
}

// Buttons still in the bank; the one holding the raw expected word (Sie vs sie) sorts first.
function availableCandidates(nextRaw) {
    return Array.from(dom.scrambledWordsContainer.querySelectorAll('.btn-word:not(.word-collected)'))
        .map(button => ({ key: normalize(button.dataset.word), button }))
        .sort((a, b) => (b.button.dataset.word === nextRaw) - (a.button.dataset.word === nextRaw));
}

function buzz() {
    if (!state.isAudioEnabled) return;
    try {
        const ctx = buzz.ctx || (buzz.ctx = new (window.AudioContext || window.webkitAudioContext)());
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = 160;
        gain.gain.value = 0.15;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
    } catch (e) { /* no audio, fine */ }
}

// Returns the set of token indices that were acted on. Interim results only accept
// expected-word hits. Commands run on final results. A mistake is recorded only for
// a final single-word utterance: inside a longer phrase a mismatch is more likely the
// recogniser merging/dropping words than the learner, so we just stop there.
// `skip` = indices already acted on by an earlier (interim) pass of the same result.
export function applyTokens(tokens, final, skip = new Set()) {
    const penalize = final && tokens.length === 1;
    const applied = new Set();
    tokens.forEach((tok, i) => {
        if (skip.has(i)) return;
        const nextRaw = nextCorrectWord();
        const expected = normalize(nextRaw);
        const candidates = state.isLocked ? [] : availableCandidates(nextRaw);
        const inSentence = sentenceWords().has(tok);
        if (!inSentence && NEXT_CMDS.has(tok)) {
            // Acts on interim results too: Chrome only finalises after a pause, and once the
            // sentence is complete there is nothing a misheard 'next' could break.
            if (!dom.exerciseControls.classList.contains('hidden')) { handleNextExercise(); applied.add(i); }
            return;
        }
        if (!inSentence && HINT_CMDS.has(tok)) {
            if (final) { handleHintClick(); applied.add(i); }
            return;
        }
        if (!inSentence && SKIP_CMDS.has(tok)) {
            if (final && !state.isLocked) { handleSkipExercise(); applied.add(i); }
            return;
        }
        const hit = matchCandidate(tok, candidates);
        if (!hit) return; // not in the bank: STT noise, not the learner's fault
        if (hit.key !== expected) {
            if (!penalize) return; // interim guess or mid-phrase mismatch: don't punish
            buzz();
        }
        handleWordClick(hit.button.dataset.word, hit.button);
        applied.add(i);
    });
    return applied;
}

let recognition = null;
let active = false;
const consumed = new Map(); // result index -> Set of token indices already acted on

// phase: 'listening' (mic open, silence) | 'speaking' (voice detected) | 'thinking' (speech ended, waiting for final)
function setPhase(phase, transcript = '') {
    if (!dom.voiceStatus) return;
    dom.voiceStatus.classList.remove('speaking', 'thinking');
    if (phase !== 'listening') dom.voiceStatus.classList.add(phase);
    dom.voiceStatusLabel.textContent = { listening: 'Listening…', speaking: 'Hearing you…', thinking: 'Recognizing…' }[phase];
    dom.voiceTranscript.textContent = transcript;
}

function onResult(event) {
    const last = event.results[event.results.length - 1];
    setPhase(last.isFinal ? 'listening' : 'speaking', last.isFinal ? '' : last[0].transcript.trim());
    // Sentence TTS echo is harmless: the bank is empty while it plays, and its words are never commands.
    for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const alternatives = Array.from({ length: r.length }, (_, k) => r[k].transcript);
        const tokens = tokenize(r.isFinal ? bestAlternative(alternatives, remainingCorrectWords()) : r[0].transcript);
        const seen = consumed.get(i) || new Set();
        for (const idx of applyTokens(tokens, r.isFinal, seen)) seen.add(idx);
        consumed.set(i, seen);
    }
}

function updateUI() {
    if (!dom.voiceToggleBtn) return;
    dom.voiceToggleBtn.classList.toggle('voice-active', active);
    dom.voiceToggleBtn.title = active ? 'Voice input: on' : 'Voice input: off';
    dom.voiceToggleBtn.setAttribute('aria-pressed', String(active));
    if (dom.voiceStatus) dom.voiceStatus.classList.toggle('hidden', !active);
    if (active) setPhase('listening');
}

function stop() {
    active = false;
    state.voiceActive = false;
    if (recognition) {
        recognition.onend = null;
        recognition.onresult = null;
        recognition.abort();
        recognition = null;
    }
    updateUI();
}

function start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = 'de-DE';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    recognition.onresult = onResult;
    recognition.onspeechstart = () => setPhase('speaking', dom.voiceTranscript.textContent);
    recognition.onspeechend = () => setPhase('thinking', dom.voiceTranscript.textContent);
    recognition.onstart = () => { consumed.clear(); setPhase('listening'); };
    recognition.onend = () => { if (active) try { recognition.start(); } catch (e) { /* already running */ } };
    recognition.onerror = (e) => {
        // no-speech / aborted are routine; anything else (no mic, offline, denied) must not restart-loop
        if (e.error !== 'no-speech' && e.error !== 'aborted') stop();
    };
    recognition.start();
    active = true;
    state.voiceActive = true;
    updateUI();
}

export function handleVoiceToggle() {
    if (active) stop(); else start();
}

export function initVoice() {
    if (!dom.voiceToggleBtn) return;
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
        dom.voiceToggleBtn.classList.add('hidden');
        return;
    }
    dom.voiceToggleBtn.addEventListener('click', handleVoiceToggle);
    updateUI();
}
