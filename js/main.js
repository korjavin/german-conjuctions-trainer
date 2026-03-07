import { state, toggleTopicCollapse, isTopicCollapsed } from './state.js';
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
    selectTopic,
    positionDropdown,
    saveTopic,
    savePrompt,
} from './topics.js';
import {
    checkAuthStatus,
    showUserExerciseStats,
} from './auth.js';
import {
    showExerciseHistory,
    renderHistoryPage,
    updateHistoryFilterUI,
} from './history.js';
import { getTopicPath } from './topics.js';

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
        localStorage.setItem('topicSortOrder', state.topicSortOrder);
        renderTopicsList();
    });
}

dom.addTopicBtn.addEventListener('click', () => showAddTopicForm(null));
dom.cancelAddBtn.addEventListener('click', hideAddTopicForm);
dom.saveTopicBtn.addEventListener('click', saveTopic);
dom.cancelEditBtn.addEventListener('click', hidePromptEditor);
dom.savePromptBtn.addEventListener('click', savePrompt);

// Topics search input
dom.topicsSearchInput.addEventListener('input', () => {
    state.topicsSearchQuery = dom.topicsSearchInput.value.trim();
    if (state.topicsSearchQuery) {
        dom.topicsSearchClear.classList.remove('hidden');
    } else {
        dom.topicsSearchClear.classList.add('hidden');
    }
    renderTopicsList();
});

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
dom.skipExerciseBtn.addEventListener('click', handleSkipExercise);
dom.hideExerciseBtn.addEventListener('click', handleHideExercise);
dom.nextExerciseBtn.addEventListener('click', handleNextExercise);
document.addEventListener('keydown', handleKeyPress);

// Observability
dom.viewLastRefinedPromptBtn.addEventListener('click', showLastRefinedPrompt);
dom.lastRefinedPromptCloseBtn.addEventListener('click', () => {
    dom.lastRefinedPromptModal.close();
});

// Topic combobox
dom.topicSearch.addEventListener('focus', () => {
    renderTopicDropdown(state.topics);
    positionDropdown();
    dom.topicDropdown.classList.remove('hidden');
});

dom.topicSearch.addEventListener('blur', () => {
    // Delay hiding so that a click on a dropdown item can be registered
    setTimeout(() => {
        dom.topicDropdown.classList.add('hidden');
        // If the search input doesn't match a topic name, reset it
        const currentTopic = state.topics.find(t => t.id === state.currentTopicId);
        if (currentTopic) {
            dom.topicSearch.value = getTopicPath(currentTopic.id, state.topics);
        } else {
            dom.topicSearch.value = '';
        }
    }, 200);
});

dom.topicSearch.addEventListener('input', () => {
    const searchTerm = dom.topicSearch.value.toLowerCase();
    const filteredTopics = state.topics.filter(topic => {
        const fullPath = getTopicPath(topic.id, state.topics).toLowerCase();
        return fullPath.includes(searchTerm);
    });
    renderTopicDropdown(filteredTopics);
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
    }
});

// Keyboard shortcut for topics search (Ctrl+F / Cmd+F)
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        // Only focus search if settings modal is open
        if (dom.settingsModal.open && !dom.topicsSearchInput.contains(e.target)) {
            e.preventDefault();
            dom.topicsSearchInput.focus();
        }
    }
});

// Auth
dom.loginBtn.addEventListener('click', () => {
    window.location.href = '/auth/google/login';
});

dom.logoutBtn.addEventListener('click', () => {
    window.location.href = '/auth/logout';
});

dom.statsBtn.addEventListener('click', showUserExerciseStats);

dom.statsCloseBtn.addEventListener('click', () => {
    dom.statsModal.close();
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

dom.historyFilterFavorites.addEventListener('click', () => {
    state.historyFilterFavorites = !state.historyFilterFavorites;
    state.historyPage = 1; // Reset to first page
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
        let matches = true;
        if (state.historyFilterReady) matches = matches && item.ready_to_repeat;
        if (state.historyFilterFavorites) matches = matches && item.is_favorite;
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
    state.exercisesWithHints = new Set();
    state.exercisePerformance = new Map(); // Empty for sample exercises
    state.completedExerciseIds = new Set();
    state.startTime = Date.now();

    renderExercise();

    // Expose functions to global scope for testing
    window.state = state;
    window.renderTopicsList = renderTopicsList;
    window.toggleTopicCollapse = toggleTopicCollapse;
    window.isTopicCollapsed = isTopicCollapsed;
}

init();
