import { state, toggleTopicCollapse, isTopicCollapsed, addRecentlyUsedTopic } from './state.js';
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
    BLUR_TIMEOUT_MS,
    FOCUSOUT_TIMEOUT_MS,
} from './topics.js';
import {
    checkAuthStatus,
} from './auth.js';
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
});

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

// --- Initialization ---
function init() {
    updateAudioToggleUI();
    checkAuthStatus();
    loadTopics();

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
