import { state } from './state.js';
import { dom } from './dom.js';
import { fetchTTSFilePathAPI } from './api.js';

const AUDIO_ENABLED_STORAGE_KEY = 'audioEnabled';
const WORD_AUDIO_CACHE_STORAGE_KEY = 'wordAudioCacheV1';
const MAX_WORD_AUDIO_CACHE_ENTRIES = 2000;
const WORD_AUDIO_PRELOAD_CONCURRENCY = 3;

export function isPunctuation(token) {
    return /^[^\p{L}\p{N}]+$/u.test(token);
}

function normalizeWordForCache(word) {
    if (typeof word !== 'string') return '';
    return word.trim();
}

function saveWordAudioCache() {
    try {
        localStorage.setItem(WORD_AUDIO_CACHE_STORAGE_KEY, JSON.stringify(state.wordAudioCache));
    } catch (error) {
        console.error('Failed to persist word audio cache:', error);
    }
}

function getWordAudioPathFromCache(word) {
    const normalizedWord = normalizeWordForCache(word);
    if (!normalizedWord) return '';

    const cacheEntry = state.wordAudioCache[normalizedWord];
    if (!cacheEntry || typeof cacheEntry.filePath !== 'string') {
        return '';
    }

    cacheEntry.updatedAt = Date.now();
    saveWordAudioCache();
    return cacheEntry.filePath;
}

function peekWordAudioPathFromCache(word) {
    const normalizedWord = normalizeWordForCache(word);
    if (!normalizedWord) return '';

    const cacheEntry = state.wordAudioCache[normalizedWord];
    if (!cacheEntry || typeof cacheEntry.filePath !== 'string') {
        return '';
    }

    return cacheEntry.filePath;
}

function updateWordAudioCache(word, filePath) {
    const normalizedWord = normalizeWordForCache(word);
    if (!normalizedWord || !filePath) return;

    state.wordAudioCache[normalizedWord] = {
        filePath,
        updatedAt: Date.now()
    };

    const entries = Object.entries(state.wordAudioCache);
    if (entries.length > MAX_WORD_AUDIO_CACHE_ENTRIES) {
        entries
            .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
            .slice(0, entries.length - MAX_WORD_AUDIO_CACHE_ENTRIES)
            .forEach(([staleWord]) => {
                delete state.wordAudioCache[staleWord];
            });
    }

    saveWordAudioCache();
}

export async function playAudioFile(filePath) {
    if (!state.isAudioEnabled || !filePath) return false;

    let audio = null;
    try {
        if (state.activeAudio) {
            state.activeAudio.pause();
            state.activeAudio.currentTime = 0;
        }

        audio = new Audio(filePath);
        state.activeAudio = audio;

        audio.addEventListener('ended', () => {
            if (state.activeAudio === audio) {
                state.activeAudio = null;
            }
        });
        audio.addEventListener('error', () => {
            if (state.activeAudio === audio) {
                state.activeAudio = null;
            }
        });

        await audio.play();
        return true;
    } catch (error) {
        if (state.activeAudio === audio) {
            state.activeAudio = null;
        }
        console.error('Error playing audio:', error);
        return false;
    }
}

async function fetchTTSFilePath(text) {
    if (!state.isAudioEnabled || !text) return '';
    return fetchTTSFilePathAPI(text);
}

export async function playSentenceAudio(audioPath, text) {
    if (!state.isAudioEnabled) return;

    const playedFromProvidedPath = await playAudioFile(audioPath);
    if (playedFromProvidedPath) {
        return;
    }

    const generatedFilePath = await fetchTTSFilePath(text);
    if (!generatedFilePath) {
        return;
    }

    state.lastAudioUrl = generatedFilePath;
    await playAudioFile(generatedFilePath);
}

async function ensureWordAudioCached(word) {
    if (!state.isAudioEnabled) return '';

    const normalizedWord = normalizeWordForCache(word);
    if (!normalizedWord) return '';

    const cachedFilePath = peekWordAudioPathFromCache(normalizedWord);
    if (cachedFilePath) {
        return cachedFilePath;
    }

    if (state.wordAudioInflight.has(normalizedWord)) {
        return state.wordAudioInflight.get(normalizedWord);
    }

    const preloadPromise = (async () => {
        const generatedFilePath = await fetchTTSFilePath(normalizedWord);
        if (!generatedFilePath) {
            return '';
        }

        updateWordAudioCache(normalizedWord, generatedFilePath);
        return generatedFilePath;
    })();

    state.wordAudioInflight.set(normalizedWord, preloadPromise);
    try {
        return await preloadPromise;
    } finally {
        state.wordAudioInflight.delete(normalizedWord);
    }
}

export async function playWordAudio(word) {
    if (!state.isAudioEnabled) return;

    const normalizedWord = normalizeWordForCache(word);
    if (!normalizedWord) return;

    const cachedFilePath = getWordAudioPathFromCache(normalizedWord);
    if (cachedFilePath) {
        const playedFromCache = await playAudioFile(cachedFilePath);
        if (playedFromCache) {
            return;
        }
    }

    const generatedFilePath = await ensureWordAudioCached(normalizedWord);
    if (!generatedFilePath) {
        return;
    }

    await playAudioFile(generatedFilePath);
}

export function preloadExerciseWordAudio(exercise) {
    if (!state.isAudioEnabled) return;
    if (!exercise || !exercise.correct_german_sentence) return;

    const allTokens = exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];
    const uniqueWords = [...new Set(allTokens.filter(token => !isPunctuation(token)).map(w => w.trim()))].filter(Boolean);
    const wordsToPreload = uniqueWords.filter(word => !peekWordAudioPathFromCache(word));

    if (wordsToPreload.length === 0) return;

    let currentIndex = 0;
    const workerCount = Math.min(WORD_AUDIO_PRELOAD_CONCURRENCY, wordsToPreload.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (currentIndex < wordsToPreload.length) {
            const word = wordsToPreload[currentIndex++];
            await ensureWordAudioCached(word);
        }
    });

    Promise.allSettled(workers).catch(() => {
        // Ignore preload errors; on-demand playback remains available.
    });
}

export function updateAudioToggleUI() {
    if (!dom.audioToggleBtn || !dom.audioToggleIcon) return;

    const isEnabled = state.isAudioEnabled;
    dom.audioToggleIcon.textContent = isEnabled ? '🔊' : '🔇';
    dom.audioToggleBtn.setAttribute('title', isEnabled ? 'Sound: on' : 'Sound: off');
    dom.audioToggleBtn.setAttribute('aria-label', isEnabled ? 'Disable sound' : 'Enable sound');

    if (!isEnabled) {
        dom.audioToggleBtn.classList.add('is-audio-off');
        dom.replayAudioBtn.classList.add('is-audio-off');
    } else {
        dom.audioToggleBtn.classList.remove('is-audio-off');
        dom.replayAudioBtn.classList.remove('is-audio-off');
    }

    dom.replayAudioBtn.disabled = !isEnabled;
}

export function setAudioEnabled(isEnabled) {
    state.isAudioEnabled = Boolean(isEnabled);
    localStorage.setItem(AUDIO_ENABLED_STORAGE_KEY, String(state.isAudioEnabled));

    if (!state.isAudioEnabled && state.activeAudio) {
        state.activeAudio.pause();
        state.activeAudio.currentTime = 0;
        state.activeAudio = null;
    }

    updateAudioToggleUI();
}

export function handleAudioToggle() {
    setAudioEnabled(!state.isAudioEnabled);
}

export function handleReplayAudio() {
    if (!state.isAudioEnabled) return;
    playSentenceAudio(state.lastAudioUrl, state.lastAudioText);
}
