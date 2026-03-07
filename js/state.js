const AUDIO_ENABLED_STORAGE_KEY = 'audioEnabled';
const WORD_AUDIO_CACHE_STORAGE_KEY = 'wordAudioCacheV1';
const TOPIC_COLLAPSE_STATE_STORAGE_KEY = 'topicCollapseState';
const RECENTLY_USED_TOPICS_STORAGE_KEY = 'recentlyUsedTopics';

let localStorageErrorShown = false; // Prevent multiple notifications for localStorage errors

function _showLocalStorageError(context) {
    if (!localStorageErrorShown) {
        localStorageErrorShown = true;
        alert(`Warning: Unable to save your preferences to local storage. Your changes may not persist after closing the browser.\n\nContext: ${context}`);
    }
}

function _loadAudioEnabled() {
    try {
        const savedValue = localStorage.getItem(AUDIO_ENABLED_STORAGE_KEY);
        if (savedValue === null) return true;
        return savedValue === 'true';
    } catch (error) {
        console.error('Failed to load audio enabled state:', error);
        return true;
    }
}

function _loadTopicCollapseState() {
    try {
        const savedValue = localStorage.getItem(TOPIC_COLLAPSE_STATE_STORAGE_KEY);
        if (!savedValue) return new Set();
        const parsed = JSON.parse(savedValue);
        if (Array.isArray(parsed)) {
            // Validate and sanitize - only accept strings
            const sanitized = parsed.filter(item => typeof item === 'string');
            return new Set(sanitized);
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
        _showLocalStorageError('topic collapse state');
    }
}

function _loadRecentlyUsedTopics() {
    try {
        const savedValue = localStorage.getItem(RECENTLY_USED_TOPICS_STORAGE_KEY);
        if (!savedValue) return [];
        const parsed = JSON.parse(savedValue);
        if (Array.isArray(parsed)) {
            // Validate and sanitize - only accept objects with string id and name
            const sanitized = parsed.filter(item =>
                typeof item === 'object' &&
                item !== null &&
                typeof item.id === 'string' &&
                typeof item.name === 'string'
            );
            return sanitized.slice(0, 10); // Limit to 10 most recent
        }
        return [];
    } catch (error) {
        console.error('Failed to load recently used topics:', error);
        return [];
    }
}

function _saveRecentlyUsedTopics(topics) {
    try {
        localStorage.setItem(RECENTLY_USED_TOPICS_STORAGE_KEY, JSON.stringify(topics.slice(0, 10)));
    } catch (error) {
        console.error('Failed to save recently used topics:', error);
        _showLocalStorageError('recently used topics');
    }
}

export function addRecentlyUsedTopic(topicId, topicName) {
    // Remove if already exists
    const filtered = state.recentlyUsedTopics.filter(t => t.id !== topicId);
    // Add to front
    filtered.unshift({ id: topicId, name: topicName });
    // Limit to 10
    state.recentlyUsedTopics = filtered.slice(0, 10);
    _saveRecentlyUsedTopics(state.recentlyUsedTopics);
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
    topicSortOrder: (() => {
        try {
            return localStorage.getItem('topicSortOrder') || 'tree';
        } catch (error) {
            console.error('Failed to load topic sort order:', error);
            return 'tree';
        }
    })(),
    collapsedTopicIds: _loadTopicCollapseState(),
    topicsSearchQuery: '',
    topicsMatchingIds: new Set(),
    searchExpandedTopicIds: new Set(), // Track topics auto-expanded by search
    recentlyUsedTopics: _loadRecentlyUsedTopics(),
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
    isCreatingTopic: false,
    isUpdatingTopic: false,
    timer: 60,
    timerInterval: null,
    isLoggedIn: false,
    userId: null,
    isAdmin: false,
    historyData: [],
    historyPage: 1,
    historyItemsPerPage: 10,
    historyFilterReady: false,
    historyFilterFavorites: false,
    // Virtual scrolling state
    virtualScrollEnabled: false,
    virtualScrollStartIndex: 0,
    virtualScrollEndIndex: 0,
    flattenedTopicNodes: [], // Cached flattened nodes for virtual scrolling
    nodesById: new Map(), // Cached nodes by ID for tree operations
    preSearchCollapsedTopicIds: undefined, // Saved collapse state before search began
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
