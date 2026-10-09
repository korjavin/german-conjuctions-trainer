import { state } from './state.js';
import { dom } from './dom.js';
import { updateAudioToggleUI, handleAudioToggle, handleReplayAudio } from './audio.js';
import { initVoice, handleVoiceToggle } from './voice.js';
import { initPodcast, loadPodcastFeed, showListen } from './podcast.js';
import { initMe } from './me.js';
import { initManage } from './manage.js';
import { initToday } from './today.js';
import { initRouter, markAuthReady, currentRoute } from './router.js';
import { initScope, startPractice, refreshProgress } from './scope.js';
import {
    initExercise,
    renderExercise,
    handleHintClick,
    handleKeyPress,
    handleNextExercise,
    handleSkipExercise,
    handleHideExercise,
    handleToggleFavorite,
    handleExplainClick,
} from './exercise.js';
import {
    initSession,
    showStatisticsPage,
} from './session.js';
import { loadTopics } from './topics.js';
import {
    checkAuthStatus,
} from './auth.js';
import { updateOfflineCache, flushOfflineQueue, renderOfflineCacheStatus } from './offline.js';
import { initHistory } from './history.js';

const sampleExercises = {
    "exercises": [
        {
            "conjunction_topic": "weil",
            "english_hint": "He is learning German because he wants to work in Germany.",
            "correct_german_sentence": "Er lernt Deutsch, weil er in Deutschland arbeiten will.",
            "scrambled_words": ["er", "in", "will", "arbeiten", "Deutschland", "lernt", "Deutsch,", "weil"]
        },
        {
            "conjunction_topic": "obwohl",
            "english_hint": "She is going for a walk, although it is raining.",
            "correct_german_sentence": "Sie geht spazieren, obwohl es regnet.",
            "scrambled_words": ["obwohl", "es", "Sie", "geht", "spazieren,", "regnet"]
        }
    ]
};

// Wire up cross-module callbacks
initExercise({ onSessionComplete: showStatisticsPage });
initSession({ renderExercise });
// Before the routechange listener below: outside practice, screens read the scope's topic.
initScope();
initToday();
initHistory();

// --- Event Listeners ---

// Screens (js/router.js): refresh each one's data when it is shown.
window.addEventListener('routechange', ({ detail: { route: name } }) => {
    if (dom.accountMenu?.matches(':popover-open')) dom.accountMenu.hidePopover();
    // Spoken words would otherwise keep driving the hidden, abandoned exercise.
    if (name !== 'practice' && state.voiceActive) handleVoiceToggle();
    if (name === 'listen') showListen();
    else if (name === 'me') {
        renderOfflineCacheStatus();
        loadPodcastFeed();
    }
});

// Offline chip (top bar + practice bar) follows connectivity.
const syncOfflineChip = () => document.body.classList.toggle('is-offline', navigator.onLine === false);
window.addEventListener('online', syncOfflineChip);
window.addEventListener('offline', syncOfflineChip);
syncOfflineChip();

// Exercise controls
dom.generateBtn.addEventListener('click', () => startPractice());
dom.audioToggleBtn.addEventListener('click', handleAudioToggle);
initVoice();
initPodcast();
initMe();
initManage();
dom.hintBtn.addEventListener('click', handleHintClick);
dom.replayAudioBtn.addEventListener('click', handleReplayAudio);
dom.toggleFavoriteBtn.addEventListener('click', handleToggleFavorite);
dom.explainBtn.addEventListener('click', handleExplainClick);

// Skip Dialog handling
dom.skipExerciseBtn.addEventListener('click', () => dom.skipDialog.showModal());
dom.skipSessionBtn.addEventListener('click', () => {
    handleSkipExercise();
    dom.skipDialog.close();
});
dom.skipRemoveBtn.addEventListener('click', () => {
    handleHideExercise();
    dom.skipDialog.close();
});
dom.skipCancelBtn.addEventListener('click', () => dom.skipDialog.close());

dom.nextExerciseBtn.addEventListener('click', handleNextExercise);
// Word hotkeys / Enter only drive the practice screen, never typing in Today/Manage inputs.
document.addEventListener('keydown', (e) => {
    if (currentRoute() === 'practice') handleKeyPress(e);
});

// Auth
dom.loginBtn.addEventListener('click', () => {
    window.location.href = '/auth/google/login';
});

dom.logoutBtn.addEventListener('click', () => {
    window.location.href = '/auth/logout';
});

// Offline cache (Me screen, logged-in users only; visibility handled by updateAuthUI)
if (dom.offlineCacheBtn) {
    dom.offlineCacheBtn.addEventListener('click', updateOfflineCache);
}

// Retry queued session results as soon as connectivity is back.
window.addEventListener('online', () => { flushOfflineQueue(); });

// --- Initialization ---
function init() {
    updateAudioToggleUI();
    initRouter();
    // Re-render once auth and topics are known: #/manage guard, and screens that read the current topic.
    Promise.allSettled([checkAuthStatus(), loadTopics()]).then(() => {
        refreshProgress(); // per-topic due counts need the login state and the topic tree
        markAuthReady();
    });

    // Service worker: caches the app shell + audio so sessions work offline.
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch((error) => {
            console.error('Service worker registration failed:', error);
        });
    }

    renderOfflineCacheStatus();
    flushOfflineQueue();

    // Start with sample exercises for testing
    state.exercises = sampleExercises.exercises;
    state.exerciseIds = []; // Sample exercises don't have IDs
    state.currentExerciseIndex = 0;
    state.mistakes = 0;
    state.hintsUsed = 0;
    state.sessionTime = 0;
    state.isSessionComplete = false;
    state.exercisesWithMistakes = new Set();
    state.exerciseMistakes = {};
    state.exercisesWithHints = new Set();
    state.exercisePerformance = new Map(); // Empty for sample exercises
    state.completedExerciseIds = new Set();
    state.startTime = Date.now();

    renderExercise();
}

init();
