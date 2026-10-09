import { state } from './state.js';
import { dom } from './dom.js';
import { updateAudioToggleUI, handleAudioToggle, handleReplayAudio } from './audio.js';
import { initVoice, handleVoiceToggle } from './voice.js';
import { initPodcast, loadPodcastFeed, showListen } from './podcast.js';
import { initMe } from './me.js';
import { initManage } from './manage.js';
import { initToday } from './today.js';
import { initRouter, markAuthReady, currentRoute, route } from './router.js';
import { initTopicsBrowser } from './topics-browser.js';
import { initScope, startPractice, refreshProgress } from './scope.js';
import {
    initExercise,
    renderExercise,
    handleHintClick,
    handleKeyPress,
    handleNextExercise,
    confirmSkip,
    handleToggleFavorite,
    handleExplainClick,
} from './exercise.js';
import {
    initSession,
    showStatisticsPage,
    endSession,
    sessionInProgress,
} from './session.js';
import { loadTopics } from './topics.js';
import {
    checkAuthStatus,
} from './auth.js';
import { updateOfflineCache, flushOfflineQueue, renderOfflineCacheStatus } from './offline.js';
import { initHistory } from './history.js';
import { confirm } from './ui.js';

// Wire up cross-module callbacks
initExercise({ onSessionComplete: showStatisticsPage });
initSession({ renderExercise });
// Before the routechange listener below: outside practice, screens read the scope's topic.
initScope();
initToday();
initTopicsBrowser();
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
dom.skipExerciseBtn.addEventListener('click', confirmSkip);

// X in the practice bar: mid-session it asks first; finished sentences are saved either way.
dom.practiceClose?.addEventListener('click', async (e) => {
    if (currentRoute() !== 'practice' || !sessionInProgress()) return; // plain link to Today
    e.preventDefault();
    const choice = await confirm({
        title: 'End this session?',
        body: 'Progress on finished sentences is kept.',
        actions: [{ label: 'End session', kind: 'primary', value: 'end' }, { label: 'Keep practicing', kind: 'ghost' }],
    });
    if (choice !== 'end') return;
    endSession();
    route('today');
});

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

    renderExercise(); // empty practice card until startPractice() loads a session
}

init();
