import { state, toggleTopicCollapse, isTopicCollapsed, collapseAllTopics, expandAllTopics, addRecentlyUsedTopic } from './state.js';
import { dom } from './dom.js';
import { updateAudioToggleUI, handleAudioToggle, handleReplayAudio } from './audio.js';
import { initVoice, handleVoiceToggle } from './voice.js';
import { initPodcast, loadPodcastFeed, openPodcastDialog } from './podcast.js';
import { initMe } from './me.js';
import { initToday } from './today.js';
import { initRouter, markAuthReady, route, currentRoute } from './router.js';
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
import {
    loadTopics,
    renderTopicsList,
    showAddTopicForm,
    hideAddTopicForm,
    showPromptEditor,
    hidePromptEditor,
    showVersionHistory,
    showLastRefinedPrompt,
    saveTopic,
    savePrompt,
    validateTopicName,
    validateTopicPrompt,
    showFieldError,
    clearFieldError,
    clearFormErrors,
    renderRecentlyUsedTopics,
    updateHierarchyPreview,
    setFormLoading,
    setupFormValidation,
    setupFormKeyboardShortcuts,
    getFolderIcon,
    getFileIcon,
    getTopicPath,
    debounce,
    escapeHtml,
} from './topics.js';
import {
    checkAuthStatus,
} from './auth.js';
import { fetchDatabaseStatsAPI, createCLITokenAPI } from './api.js';
import { updateOfflineCache, flushOfflineQueue, renderOfflineCacheStatus } from './offline.js';
import { initHistory } from './history.js';
import { confirm } from './ui.js';

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
    if (name === 'listen') openPodcastDialog();
    else if (name === 'me') {
        renderOfflineCacheStatus();
        loadPodcastFeed();
    } else if (name === 'manage') {
        if (state.isAdmin) loadTopics(); // Refresh topics when opening Manage
        loadDatabaseStats();
        toggleCLIAccessSection();
    }
});

// Offline chip (top bar + practice bar) follows connectivity.
const syncOfflineChip = () => document.body.classList.toggle('is-offline', navigator.onLine === false);
window.addEventListener('online', syncOfflineChip);
window.addEventListener('offline', syncOfflineChip);
syncOfflineChip();

// --- CLI Access (admin only) ---
// Shows or hides the "CLI Access" panel based on admin status, and clears
// any token left over from a previous open. We never want a token to be
// visible after the user closes and re-opens the modal — it was a one-time
// reveal.
function toggleCLIAccessSection() {
    if (!dom.cliAccessSection) return;
    if (!state.isAdmin) {
        dom.cliAccessSection.classList.add('hidden');
        return;
    }
    dom.cliAccessSection.classList.remove('hidden');
    if (dom.cliTokenResult) dom.cliTokenResult.classList.add('hidden');
    if (dom.cliTokenValue) dom.cliTokenValue.value = '';
    if (dom.cliTokenError) {
        dom.cliTokenError.classList.add('hidden');
        dom.cliTokenError.textContent = '';
    }
}

if (dom.cliTokenGenerateBtn) {
    dom.cliTokenGenerateBtn.addEventListener('click', async () => {
        dom.cliTokenError.classList.add('hidden');
        dom.cliTokenError.textContent = '';
        dom.cliTokenGenerateBtn.disabled = true;
        try {
            const label = (dom.cliTokenLabel.value || '').trim() || 'cli';
            const result = await createCLITokenAPI(label);
            dom.cliTokenValue.value = result.token || '';
            dom.cliTokenResult.classList.remove('hidden');
            dom.cliTokenValue.focus();
            dom.cliTokenValue.select();
        } catch (err) {
            dom.cliTokenError.textContent = err.message || 'Failed to mint CLI token.';
            dom.cliTokenError.classList.remove('hidden');
        } finally {
            dom.cliTokenGenerateBtn.disabled = false;
        }
    });
}

if (dom.cliTokenCopyBtn) {
    dom.cliTokenCopyBtn.addEventListener('click', async () => {
        const value = dom.cliTokenValue.value;
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            const original = dom.cliTokenCopyBtn.textContent;
            dom.cliTokenCopyBtn.textContent = 'Copied!';
            setTimeout(() => { dom.cliTokenCopyBtn.textContent = original; }, 1500);
        } catch (_) {
            // Clipboard API can fail (e.g. insecure context). Fall back to
            // selecting the field so the user can ctrl/cmd-C themselves.
            dom.cliTokenValue.focus();
            dom.cliTokenValue.select();
        }
    });
}

if (dom.topicSort) {
    dom.topicSort.value = state.topicSortOrder;
    dom.topicSort.addEventListener('change', (e) => {
        state.topicSortOrder = e.target.value;
        try {
            localStorage.setItem('topicSortOrder', state.topicSortOrder);
        } catch (error) {
            console.error('Failed to save topic sort order:', error);
        }
        renderTopicsList();
    });
}

dom.collapseAllBtn.addEventListener('click', () => {
    collapseAllTopics();
    renderTopicsList();
});

dom.expandAllBtn.addEventListener('click', () => {
    expandAllTopics();
    renderTopicsList();
});

dom.addTopicBtn.addEventListener('click', () => showAddTopicForm(null));
dom.cancelAddBtn.addEventListener('click', hideAddTopicForm);
dom.saveTopicBtn.addEventListener('click', saveTopic);
dom.cancelEditBtn.addEventListener('click', hidePromptEditor);
dom.savePromptBtn.addEventListener('click', savePrompt);

// Topics search input with debouncing
dom.topicsSearchInput.addEventListener('input', debounce(() => {
    state.topicsSearchQuery = dom.topicsSearchInput.value.trim();
    if (state.topicsSearchQuery) {
        dom.topicsSearchClear.classList.remove('hidden');
    } else {
        dom.topicsSearchClear.classList.add('hidden');
    }
    renderTopicsList();
}, 300));

dom.topicsSearchClear.addEventListener('click', () => {
    dom.topicsSearchInput.value = '';
    state.topicsSearchQuery = '';
    dom.topicsSearchClear.classList.add('hidden');
    renderTopicsList();
    dom.topicsSearchInput.focus();
});

dom.viewVersionsBtn.addEventListener('click', () => {
    if (state.editingTopicId) {
        showVersionHistory(state.editingTopicId);
    }
});

dom.closeVersionsBtn.addEventListener('click', () => {
    dom.versionHistory.classList.add('hidden');
    dom.promptEditor.classList.remove('hidden');
});

// Exercise controls
dom.generateBtn.addEventListener('click', () => startPractice());
dom.audioToggleBtn.addEventListener('click', handleAudioToggle);
initVoice();
initPodcast();
initMe();
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

// Observability
dom.viewLastRefinedPromptBtn.addEventListener('click', showLastRefinedPrompt);
dom.lastRefinedPromptCloseBtn.addEventListener('click', () => {
    dom.lastRefinedPromptModal.close();
});

// Keyboard shortcut for topics search (Ctrl+F / Cmd+F)
document.addEventListener('keydown', (e) => {
    if (state.isAdmin && (e.ctrlKey || e.metaKey) && e.key === 'f') {
        // Prevent default browser find dialog
        e.preventDefault();
        if (currentRoute() !== 'manage') route('manage');
        // Focus search input
        dom.topicsSearchInput.focus();
    }
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

// --- Database Stats ---
async function loadDatabaseStats() {
    if (!state.isAdmin) {
        dom.dbStatsSection.classList.add('hidden');
        return;
    }

    dom.dbStatsSection.classList.remove('hidden');
    dom.dbStatsLoading.classList.remove('hidden');
    dom.dbStatsContent.classList.add('hidden');
    dom.dbStatsError.classList.add('hidden');

    try {
        const stats = await fetchDatabaseStatsAPI();
        renderDatabaseStats(stats);
    } catch (error) {
        dom.dbStatsLoading.classList.add('hidden');
        dom.dbStatsError.classList.remove('hidden');
        dom.dbStatsError.textContent = 'Failed to load database statistics.';
        console.error('Error loading database stats:', error);
    }
}

function renderDatabaseStats(stats) {
    dom.dbStatsLoading.classList.add('hidden');
    dom.dbStatsContent.classList.remove('hidden');

    dom.dbStatExercises.textContent = stats.total_exercises.toLocaleString();
    dom.dbStatTopics.textContent = stats.total_topics.toLocaleString();
    dom.dbStatDbSize.textContent = `${stats.database_size_mb.toFixed(1)} MB`;
    dom.dbStatAudioCache.textContent = `${stats.audio_cache_size_mb.toFixed(1)} MB (${stats.audio_cache_file_count.toLocaleString()} files)`;

    // Per-topic exercise counts
    const perTopic = stats.exercises_per_topic || [];
    if (perTopic.length === 0) {
        dom.dbStatsPerTopic.textContent = 'No topics found.';
    } else {
        dom.dbStatsPerTopic.innerHTML = perTopic
            .map(t => `<div class="db-stats-topic-row"><span class="db-stats-topic-name">${escapeHtml(t.topic_name)}</span><span class="db-stats-topic-count">${t.count}</span></div>`)
            .join('');
    }
}

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

    // Expose functions to global scope for testing (only in development mode)
    const urlParams = new URLSearchParams(window.location.search);
    const isDebugMode = urlParams.get('debug') === 'true';
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ||
        isDebugMode) {
        window.state = state;
        window.renderTopicsList = renderTopicsList;
        window.toggleTopicCollapse = toggleTopicCollapse;
        window.isTopicCollapsed = isTopicCollapsed;
        window.collapseAllTopics = collapseAllTopics;
        window.expandAllTopics = expandAllTopics;
        window.validateTopicName = validateTopicName;
        window.validateTopicPrompt = validateTopicPrompt;
        window.showFieldError = showFieldError;
        window.clearFieldError = clearFieldError;
        window.clearFormErrors = clearFormErrors;
        window.renderRecentlyUsedTopics = renderRecentlyUsedTopics;
        window.updateHierarchyPreview = updateHierarchyPreview;
        window.setFormLoading = setFormLoading;
        window.setupFormValidation = setupFormValidation;
        window.setupFormKeyboardShortcuts = setupFormKeyboardShortcuts;
        window.addRecentlyUsedTopic = addRecentlyUsedTopic;
        window.getFolderIcon = getFolderIcon;
        window.getFileIcon = getFileIcon;
        window.getTopicPath = getTopicPath;
    }
}

init();
