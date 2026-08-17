import { state, toggleTopicCollapse, isTopicCollapsed, collapseAllTopics, expandAllTopics, addRecentlyUsedTopic } from './state.js';
import { dom } from './dom.js';
import { updateAudioToggleUI, handleAudioToggle, handleReplayAudio } from './audio.js';
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
    fetchExercises,
    showStatisticsPage,
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
    renderTopicDropdown,
    shouldSuppressDropdownClose,
    selectTopic,
    positionDropdown,
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
    resetDropdownCollapseState,
    escapeHtml,
    BLUR_TIMEOUT_MS,
    FOCUSOUT_TIMEOUT_MS,
} from './topics.js';
import {
    checkAuthStatus,
} from './auth.js';
import { fetchDatabaseStatsAPI, createCLITokenAPI } from './api.js';
import { updateOfflineCache, flushOfflineQueue, renderOfflineCacheStatus } from './offline.js';
import {
    showExerciseHistory,
    renderHistoryPage,
    updateHistoryFilterUI,
    updateHistorySortUI,
} from './history.js';

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

// --- Event Listeners ---

// Settings modal
dom.settingsBtn.addEventListener('click', () => {
    loadTopics(); // Refresh topics when opening settings
    dom.settingsModal.showModal();
    loadDatabaseStats();
    toggleCLIAccessSection();
});

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

dom.settingsCloseBtn.addEventListener('click', () => {
    dom.settingsModal.close();
    hideAddTopicForm();
    hidePromptEditor();
    dom.versionHistory.classList.add('hidden');
});

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
dom.generateBtn.addEventListener('click', fetchExercises);
dom.audioToggleBtn.addEventListener('click', handleAudioToggle);
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
document.addEventListener('keydown', handleKeyPress);

// Observability
dom.viewLastRefinedPromptBtn.addEventListener('click', showLastRefinedPrompt);
dom.lastRefinedPromptCloseBtn.addEventListener('click', () => {
    dom.lastRefinedPromptModal.close();
});

// Topic combobox
dom.topicSearch.addEventListener('focus', () => {
    renderTopicDropdown('');
    positionDropdown();
    dom.topicDropdown.classList.remove('hidden');
});

dom.topicSearch.addEventListener('blur', (e) => {
    // Delay hiding so that a click on a dropdown item can be registered
    setTimeout(() => {
        // Don't close if a collapse button click just triggered a re-render
        if (shouldSuppressDropdownClose()) {
            return;
        }

        // Don't close if focus moved inside the dropdown (e.g., to collapse button)
        const activeElement = document.activeElement;
        if (dom.topicDropdown.contains(activeElement)) {
            return;
        }

        dom.topicDropdown.classList.add('hidden');
        resetSearchInputToCanonicalPath();
    }, BLUR_TIMEOUT_MS);
});

// Helper function to reset the search input to the canonical topic path
function resetSearchInputToCanonicalPath() {
    const currentTopic = state.topics.find(t => t.id === state.currentTopicId);
    if (currentTopic) {
        dom.topicSearch.value = getTopicPath(currentTopic.id, state.topics);
    } else {
        dom.topicSearch.value = '';
    }
}

dom.topicSearch.addEventListener('input', () => {
    renderTopicDropdown(dom.topicSearch.value);
    if (!dom.topicDropdown.classList.contains('hidden')) {
        positionDropdown();
    }
});

// Reposition dropdown on window resize and scroll
window.addEventListener('resize', () => {
    if (!dom.topicDropdown.classList.contains('hidden')) {
        positionDropdown();
    }
});

window.addEventListener('scroll', () => {
    if (!dom.topicDropdown.classList.contains('hidden')) {
        positionDropdown();
    }
});

// Hide dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!dom.topicSearch.contains(e.target) && !dom.topicDropdown.contains(e.target)) {
        dom.topicDropdown.classList.add('hidden');
        resetSearchInputToCanonicalPath();
    }
});

// Hide dropdown when focus leaves the dropdown (e.g., tabbing out)
dom.topicDropdown.addEventListener('focusout', (e) => {
    // Small delay to allow the focus transition to complete
    setTimeout(() => {
        // Don't close if a collapse button click just triggered a re-render
        if (shouldSuppressDropdownClose()) {
            return;
        }

        const activeElement = document.activeElement;
        // Close if focus is no longer inside the dropdown or search input
        if (!dom.topicDropdown.contains(activeElement) && !dom.topicSearch.contains(activeElement)) {
            dom.topicDropdown.classList.add('hidden');
            resetSearchInputToCanonicalPath();
        }
    }, FOCUSOUT_TIMEOUT_MS);
});

// Keyboard shortcut for topics search (Ctrl+F / Cmd+F)
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        // Prevent default browser find dialog
        e.preventDefault();
        // Open settings modal if not already open
        if (!dom.settingsModal.open) {
            dom.settingsModal.showModal();
            loadDatabaseStats();
        }
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

// Offline cache (logged-in users only; visibility handled by updateAuthUI)
if (dom.offlineCacheBtn) {
    dom.offlineCacheBtn.addEventListener('click', updateOfflineCache);
}

// Retry queued session results as soon as connectivity is back.
window.addEventListener('online', () => { flushOfflineQueue(); });

// History
dom.historyBtn.addEventListener('click', showExerciseHistory);

dom.historyCloseBtn.addEventListener('click', () => {
    dom.historyModal.close();
});

dom.historyFilterReady.addEventListener('click', () => {
    state.historyFilterReady = !state.historyFilterReady;
    state.historyPage = 1; // Reset to first page
    updateHistoryFilterUI();
    renderHistoryPage();
});

// History Sort Controls
dom.historySortTiming.addEventListener('click', () => {
    state.historySortDimension = state.historySortDimension === 'sooner' ? 'later' : 'sooner';
    state.historyPage = 1;
    updateHistorySortUI();
    renderHistoryPage();
});

dom.historySortErrors.addEventListener('click', () => {
    state.historySortDimension = state.historySortDimension === 'most_errors' ? 'fewest_errors' : 'most_errors';
    state.historyPage = 1;
    updateHistorySortUI();
    renderHistoryPage();
});

dom.historySortDate.addEventListener('click', () => {
    state.historySortDimension = state.historySortDimension === 'newest' ? 'oldest' : 'newest';
    state.historyPage = 1;
    updateHistorySortUI();
    renderHistoryPage();
});

dom.historyFilterFavorites.addEventListener('click', () => {
    state.historyFilterFavorites = !state.historyFilterFavorites;
    state.historyPage = 1; // Reset to first page
    updateHistoryFilterUI();
    renderHistoryPage();
});

dom.historyFilterTrained.addEventListener('click', () => {
    state.historyFilterTrained = !state.historyFilterTrained;
    state.historyPage = 1; // Reset to first page
    updateHistoryFilterUI();
    renderHistoryPage();
});

dom.historyFilterIgnored.addEventListener('click', () => {
    state.historyFilterIgnored = !state.historyFilterIgnored;
    // When showing ignored, clear other filters
    if (state.historyFilterIgnored) {
        state.historyFilterReady = false;
        state.historyFilterTrained = false;
    }
    state.historyPage = 1;
    updateHistoryFilterUI();
    renderHistoryPage();
});

dom.historyPrevBtn.addEventListener('click', () => {
    if (state.historyPage > 1) {
        state.historyPage--;
        renderHistoryPage();
    }
});

dom.historyNextBtn.addEventListener('click', () => {
    // getFilteredHistoryData is internal to history.js; compute total pages here
    const filteredCount = state.historyData.filter(item => {
        if (state.historyFilterIgnored) {
            if (!item.is_hidden) return false;
        } else {
            if (item.is_hidden) return false;
        }
        let matches = true;
        if (state.historyFilterReady) matches = matches && item.ready_to_repeat;
        if (state.historyFilterFavorites) matches = matches && item.is_favorite;
        if (state.historyFilterTrained) matches = matches && !item.ready_to_repeat;
        return matches;
    }).length;
    const totalPages = Math.ceil(filteredCount / state.historyItemsPerPage);
    if (state.historyPage < totalPages) {
        state.historyPage++;
        renderHistoryPage();
    }
});

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
    checkAuthStatus();
    loadTopics();

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
        window.resetDropdownCollapseState = resetDropdownCollapseState;
    }
}

init();
