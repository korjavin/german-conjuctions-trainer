const AUDIO_ENABLED_STORAGE_KEY = 'audioEnabled';
const WORD_AUDIO_CACHE_STORAGE_KEY = 'wordAudioCacheV1';
const TOPIC_COLLAPSE_STATE_STORAGE_KEY = 'topicCollapseState';

function _loadAudioEnabled() {
    const savedValue = localStorage.getItem(AUDIO_ENABLED_STORAGE_KEY);
    if (savedValue === null) return true;
    return savedValue === 'true';
}

function _loadTopicCollapseState() {
    try {
        const savedValue = localStorage.getItem(TOPIC_COLLAPSE_STATE_STORAGE_KEY);
        if (!savedValue) return new Set();
        const parsed = JSON.parse(savedValue);
        if (Array.isArray(parsed)) {
            return new Set(parsed);
        }
        return new Set();
    } catch (error) {
        console.error('Failed to load topic collapse state:', error);
        return new Set();
    }
}

function _saveTopicCollapseState(collapsedIds) {
    try {
        localStorage.setItem(TOPIC_COLLAPSE_STATE_STORAGE_KEY, JSON.stringify([...collapsedIds]));
    } catch (error) {
        console.error('Failed to save topic collapse state:', error);
    }
}

function _loadWordAudioCache() {
    try {
        const rawCache = localStorage.getItem(WORD_AUDIO_CACHE_STORAGE_KEY);
        if (!rawCache) return {};

        const parsedCache = JSON.parse(rawCache);
        if (!parsedCache || typeof parsedCache !== 'object' || Array.isArray(parsedCache)) {
            return {};
        }

        const normalizedCache = {};
        Object.entries(parsedCache).forEach(([word, entry]) => {
            if (typeof entry === 'string' && entry) {
                normalizedCache[word] = {
                    filePath: entry,
                    updatedAt: Date.now()
                };
                return;
            }

            if (!entry || typeof entry !== 'object') return;
            if (typeof entry.filePath !== 'string' || !entry.filePath) return;

            const updatedAt = Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now();
            normalizedCache[word] = {
                filePath: entry.filePath,
                updatedAt
            };
        });

        return normalizedCache;
    } catch (error) {
        console.error('Failed to load word audio cache:', error);
        return {};
    }
}

export const state = {
    lastAudioUrl: '',
    lastAudioText: '',
    isAudioEnabled: _loadAudioEnabled(),
    wordAudioCache: _loadWordAudioCache(),
    wordAudioInflight: new Map(),
    activeAudio: null,
    currentTopicId: '',
    topics: [],
    topicSortOrder: localStorage.getItem('topicSortOrder') || 'tree',
    collapsedTopicIds: _loadTopicCollapseState(),
    exercises: [],
    exerciseIds: [],
    currentExerciseIndex: 0,
    userSentence: [],
    isLocked: false,
    mistakes: 0,
    hintsUsed: 0,
    exercisesWithMistakes: new Set(),
    exercisesWithHints: new Set(),
    exercisePerformance: new Map(),
    completedExerciseIds: new Set(), // Track finished exercises so only completed items affect SRS
    startTime: null,
    sessionTime: 0,
    isSessionComplete: false,
    editingTopicId: null,
    timer: 60,
    timerInterval: null,
    isLoggedIn: false,
    userId: null,
    isAdmin: false,
    historyData: [],
    historyPage: 1,
    historyItemsPerPage: 10,
    historyFilterReady: false,
    historyFilterFavorites: false
};

export function toggleTopicCollapse(topicId) {
    if (state.collapsedTopicIds.has(topicId)) {
        state.collapsedTopicIds.delete(topicId);
    } else {
        state.collapsedTopicIds.add(topicId);
    }
    _saveTopicCollapseState(state.collapsedTopicIds);
}

export function isTopicCollapsed(topicId) {
    return state.collapsedTopicIds.has(topicId);
}
