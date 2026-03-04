document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const settingsCloseBtn = document.getElementById('settings-close-btn');
    const topicSearch = document.getElementById('topic-search');
    const topicDropdown = document.getElementById('topic-dropdown');

    const generateBtn = document.getElementById('generate-btn');
    const audioToggleBtn = document.getElementById('audio-toggle-btn');
    const audioToggleIcon = document.getElementById('audio-toggle-icon');
    const hintBtn = document.getElementById('hint-btn');
    const loadingSpinner = document.getElementById('loading-spinner');
    const timer = document.getElementById('timer');
    const exerciseContent = document.getElementById('exercise-content');

    const englishHintEl = document.getElementById('english-hint');
    const answerArea = document.getElementById('answer-area');
    const answerPrompt = document.getElementById('answer-prompt');
    const constructedSentenceEl = document.getElementById('constructed-sentence');
    const scrambledWordsContainer = document.getElementById('scrambled-words-container');
    const feedbackArea = document.getElementById('feedback-area');
    const correctSentenceDisplay = document.getElementById('correct-sentence-display');
    const exerciseCounter = document.getElementById('exercise-counter');
    const progressBar = document.getElementById('progress-bar');
    const progressPercentage = document.getElementById('progress-percentage');
    const emptyStateContainer = document.getElementById('empty-state-container');

    // Topics management elements
    const topicsList = document.getElementById('topics-list');
    const topicSort = document.getElementById('topic-sort');
    const addTopicBtn = document.getElementById('add-topic-btn');
    const addTopicForm = document.getElementById('add-topic-form');
    const newTopicName = document.getElementById('new-topic-name');
    const newTopicPrompt = document.getElementById('new-topic-prompt');
    const saveTopicBtn = document.getElementById('save-topic-btn');
    const cancelAddBtn = document.getElementById('cancel-add-btn');

    // Prompt editor elements
    const promptEditor = document.getElementById('prompt-editor');
    const currentTopicName = document.getElementById('current-topic-name');
    const promptTextarea = document.getElementById('prompt-textarea');
    const savePromptBtn = document.getElementById('save-prompt-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    
    // Version history elements
    const viewVersionsBtn = document.getElementById('view-versions-btn');
    const versionHistory = document.getElementById('version-history');
    const versionTopicName = document.getElementById('version-topic-name');
    const versionsList = document.getElementById('versions-list');
    const closeVersionsBtn = document.getElementById('close-versions-btn');

    // Observability elements
    const viewLastRefinedPromptBtn = document.getElementById('view-last-refined-prompt-btn');
    const lastRefinedPromptModal = document.getElementById('last-refined-prompt-modal');
    const lastRefinedPromptContent = document.getElementById('last-refined-prompt-content');
    const lastRefinedPromptCloseBtn = document.getElementById('last-refined-prompt-close-btn');

    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const statsBtn = document.getElementById('stats-btn');
    const historyBtn = document.getElementById('history-btn');
    const replayAudioBtn = document.getElementById('replay-audio-btn');
    const nextExerciseBtn = document.getElementById('next-exercise-btn');
    const toggleFavoriteBtn = document.getElementById('toggle-favorite-btn');
    const favoriteBtnText = document.getElementById('favorite-btn-text');
    const skipExerciseBtn = document.getElementById('skip-exercise-btn');
    const hideExerciseBtn = document.getElementById('hide-exercise-btn');
    const exerciseControls = document.getElementById('exercise-controls');

    // Stats Modal Elements
    const statsModal = document.getElementById('stats-modal');
    const statsCloseBtn = document.getElementById('stats-close-btn');
    const statsReadyToRepeatEl = document.getElementById('stats-ready-to-repeat');
    const statsTrainedEl = document.getElementById('stats-trained');

    // History Modal Elements
    const historyModal = document.getElementById('history-modal');
    const historyCloseBtn = document.getElementById('history-close-btn');
    const historyTopicName = document.getElementById('history-topic-name');
    const historySummary = document.getElementById('history-summary');
    const historyTotalCount = document.getElementById('history-total-count');
    const historyReadyCount = document.getElementById('history-ready-count');
    const historySuccessRate = document.getElementById('history-success-rate');
    const historyTotalAttempts = document.getElementById('history-total-attempts');
    const historyLoading = document.getElementById('history-loading');
    const historyEmpty = document.getElementById('history-empty');
    const historyContent = document.getElementById('history-content');
    const historyPagination = document.getElementById('history-pagination');
    const historyPrevBtn = document.getElementById('history-prev-btn');
    const historyNextBtn = document.getElementById('history-next-btn');
    const historyPageInfo = document.getElementById('history-page-info');
    const historyFilterReady = document.getElementById('history-filter-ready');
    const historyFilterFavorites = document.getElementById('history-filter-favorites');

    const WORD_AUDIO_CACHE_STORAGE_KEY = 'wordAudioCacheV1';
    const AUDIO_ENABLED_STORAGE_KEY = 'audioEnabled';
    const MAX_WORD_AUDIO_CACHE_ENTRIES = 2000;
    const WORD_AUDIO_PRELOAD_CONCURRENCY = 3;

    // --- Application State ---
    let state = {
        lastAudioUrl: '',
        lastAudioText: '',
        isAudioEnabled: loadAudioEnabled(),
        wordAudioCache: loadWordAudioCache(),
        wordAudioInflight: new Map(),
        activeAudio: null,
        currentTopicId: '',
        topics: [],
        topicSortOrder: localStorage.getItem('topicSortOrder') || 'name-asc', // Default to name ascending
        exercises: [],
        exerciseIds: [], // Store exercise IDs corresponding to exercises
        currentExerciseIndex: 0,
        userSentence: [],
        isLocked: false,
        mistakes: 0,
        hintsUsed: 0,
        exercisesWithMistakes: new Set(), // Track exercises with mistakes (by index)
        exercisesWithHints: new Set(), // Track exercises with hints (by index)
        exercisePerformance: new Map(), // Track per-exercise performance: exerciseId -> {hints, mistakes}
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

    // --- Sample Data ---
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

    // --- Helper Functions ---
    function getHotkey(index) {
        if (index < 9) {
            return (index + 1).toString(); // 1-9
        } else {
            return String.fromCharCode(97 + index - 9); // a, b, c, etc.
        }
    }

    function normalizeWordForCache(word) {
        if (typeof word !== 'string') return '';
        return word.trim();
    }

    function loadAudioEnabled() {
        const savedValue = localStorage.getItem(AUDIO_ENABLED_STORAGE_KEY);
        if (savedValue === null) return true;
        return savedValue === 'true';
    }

    function updateAudioToggleUI() {
        if (!audioToggleBtn || !audioToggleIcon) return;

        const isEnabled = state.isAudioEnabled;
        audioToggleIcon.textContent = isEnabled ? '🔊' : '🔇';
        audioToggleBtn.setAttribute('title', isEnabled ? 'Sound: on' : 'Sound: off');
        audioToggleBtn.setAttribute('aria-label', isEnabled ? 'Disable sound' : 'Enable sound');

        audioToggleBtn.classList.toggle('opacity-70', !isEnabled);
        audioToggleBtn.classList.toggle('border-red-400', !isEnabled);
        audioToggleBtn.classList.toggle('text-red-500', !isEnabled);
        audioToggleBtn.classList.toggle('hover:text-red-600', !isEnabled);

        replayAudioBtn.disabled = !isEnabled;
        replayAudioBtn.classList.toggle('opacity-60', !isEnabled);
        replayAudioBtn.classList.toggle('cursor-not-allowed', !isEnabled);
    }

    function setAudioEnabled(isEnabled) {
        state.isAudioEnabled = Boolean(isEnabled);
        localStorage.setItem(AUDIO_ENABLED_STORAGE_KEY, String(state.isAudioEnabled));

        if (!state.isAudioEnabled && state.activeAudio) {
            state.activeAudio.pause();
            state.activeAudio.currentTime = 0;
            state.activeAudio = null;
        }

        updateAudioToggleUI();
    }

    function loadWordAudioCache() {
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

    async function playAudioFile(filePath) {
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

        try {
            const response = await fetch('/api/tts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text })
            });

            if (!response.ok) {
                console.error('Failed to fetch audio:', response.statusText);
                return '';
            }

            const data = await response.json();
            return data.filePath || '';
        } catch (error) {
            console.error('Error generating audio:', error);
            return '';
        }
    }

    async function playSentenceAudio(audioPath, text) {
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

    async function playWordAudio(word) {
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

    function preloadExerciseWordAudio(exercise) {
        if (!state.isAudioEnabled) return;
        if (!exercise || !exercise.correct_german_sentence) return;

        const allTokens = exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];
        const uniqueWords = [...new Set(allTokens.filter(token => !isPunctuation(token)).map(normalizeWordForCache))].filter(Boolean);
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

    function isPunctuation(token) {
        return /^[^\p{L}\p{N}]+$/u.test(token);
    }

    function addPunctuationIfNeeded(exercise, userSentence) {
        const correctWordArray = exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];

        while (userSentence.length < correctWordArray.length) {
            const nextToken = correctWordArray[userSentence.length];
            if (isPunctuation(nextToken)) {
                userSentence.push(nextToken);
            } else {
                break;
            }
        }
    }

    // --- Exercise Rendering and Logic ---
    function renderExercise() {
        state.isLocked = false;
        state.userSentence = [];

        // Hide control buttons by default and show hint/skip buttons
        exerciseControls.classList.add('hidden');
        hintBtn.classList.remove('hidden');
        skipExerciseBtn.classList.remove('hidden');

        if (state.exercises.length === 0) {
            exerciseContent.classList.add('hidden');
            emptyStateContainer.classList.remove('hidden');
            exerciseCounter.classList.add('hidden');
            hintBtn.classList.add('hidden');
            return;
        }

        exerciseContent.classList.remove('hidden');
        emptyStateContainer.classList.add('hidden');
        exerciseCounter.classList.remove('hidden');

        const exercise = state.exercises[state.currentExerciseIndex];

        addPunctuationIfNeeded(exercise, state.userSentence);

        exerciseCounter.textContent = `${state.currentExerciseIndex + 1} / ${state.exercises.length}`;
        
        // Update favorite button state
        updateFavoriteButtonState(exercise.is_favorite);

        // Update progress bar
        const progress = ((state.currentExerciseIndex + 1) / state.exercises.length) * 100;
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }
        if (progressPercentage) {
            progressPercentage.textContent = `${Math.round(progress)}%`;
        }

        // Reset UI
        englishHintEl.textContent = exercise.english_hint;
        scrambledWordsContainer.innerHTML = '';
        constructedSentenceEl.innerHTML = '';
        correctSentenceDisplay.textContent = '';

        // Display initial punctuation if any
        if (state.userSentence.length > 0) {
            answerPrompt.classList.add('hidden');
            state.userSentence.forEach(w => {
                const span = document.createElement('span');
                span.textContent = w;
                span.className = 'px-3 py-2 bg-white/80 backdrop-blur-sm rounded-lg mr-2 font-medium text-gray-700 shadow-sm';
                constructedSentenceEl.appendChild(span);
            });
        } else {
            answerPrompt.classList.remove('hidden');
        }

        // Tokenize the correct sentence to create word buttons, then shuffle them.
        const allTokens = exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];
        const wordsToDisplay = allTokens.filter(token => !isPunctuation(token));
        for (let i = wordsToDisplay.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [wordsToDisplay[i], wordsToDisplay[j]] = [wordsToDisplay[j], wordsToDisplay[i]];
        }

        // Create and display word buttons with hotkeys
        wordsToDisplay.forEach((word, index) => {
            const button = document.createElement('button');
            const hotkey = getHotkey(index);
            
            const hotkeySpan = document.createElement('span');
            hotkeySpan.textContent = hotkey;
            hotkeySpan.className = 'hotkey-indicator';
            
            const wordSpan = document.createElement('span');
            wordSpan.textContent = word;
            
            button.appendChild(hotkeySpan);
            button.appendChild(wordSpan);
            
            button.className = 'btn-word px-4 py-2 rounded-md font-medium';
            button.dataset.hotkey = hotkey;
            button.dataset.word = word;
            
            button.addEventListener('click', () => handleWordClick(word, button));
            
            scrambledWordsContainer.appendChild(button);
        });

        preloadExerciseWordAudio(exercise);
    }

    function handleWordClick(word, button) {
        if (state.isLocked) return;

        const exercise = state.exercises[state.currentExerciseIndex];
        const correctWordArray = exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];
        const nonPunctuationWords = correctWordArray.filter(token => !isPunctuation(token));
        
        const userWords = state.userSentence.filter(token => !isPunctuation(token));
        const nextCorrectWord = nonPunctuationWords[userWords.length];

        if (word === nextCorrectWord) {
            // Correct word
            state.userSentence.push(word);
            addPunctuationIfNeeded(exercise, state.userSentence);

            // Hide the clicked button without changing layout
            button.classList.add('word-collected');

            // Update constructed sentence display
            constructedSentenceEl.innerHTML = '';
            answerPrompt.classList.add('hidden');

            state.userSentence.forEach(w => {
                const span = document.createElement('span');
                span.textContent = w;
                span.className = 'px-3 py-2 bg-white/80 backdrop-blur-sm rounded-lg mr-2 font-medium text-gray-700 shadow-sm';
                constructedSentenceEl.appendChild(span);
            });

            // Check if sentence is complete
            if (state.userSentence.length === correctWordArray.length) {
                handleSentenceCompletion(exercise, correctWordArray, word);
            } else {
                playWordAudio(word);
            }
        } else {
            // Incorrect word
            state.mistakes++;
            state.exercisesWithMistakes.add(state.currentExerciseIndex);

            // Track per-exercise mistake
            const exerciseId = state.exerciseIds[state.currentExerciseIndex];
            if (exerciseId && state.exercisePerformance.has(exerciseId)) {
                const perf = state.exercisePerformance.get(exerciseId);
                perf.mistakes++;
            }

            button.classList.add('incorrect-answer-feedback');
            setTimeout(() => {
                button.classList.remove('incorrect-answer-feedback');
            }, 500);
        }
    }

    async function handleSentenceCompletion(exercise, correctWordArray, lastWord = '') {
        state.isLocked = true;
        const isCorrect = state.userSentence.join(' ') === correctWordArray.join(' ');

        if (isCorrect) {
            correctSentenceDisplay.textContent = `Correct! "${exercise.correct_german_sentence}"`;
            state.lastAudioUrl = exercise.audio_file_path;
            state.lastAudioText = exercise.correct_german_sentence;

            const exerciseId = state.exerciseIds[state.currentExerciseIndex];
            if (exerciseId) {
                state.completedExerciseIds.add(exerciseId);
            }

            if (lastWord) {
                await playWordAudio(lastWord);
            }
            playSentenceAudio(state.lastAudioUrl, state.lastAudioText);

            // Show exercise controls and hide hint/skip buttons
            exerciseControls.classList.remove('hidden');
            hintBtn.classList.add('hidden');
            skipExerciseBtn.classList.add('hidden');
        } else {
            state.mistakes++;

            // Show incorrect feedback
            const wrongWords = scrambledWordsContainer.querySelectorAll('.btn-word.word-collected');
            wrongWords.forEach(btn => {
                btn.classList.add('incorrect-answer-feedback');
                setTimeout(() => {
                    btn.classList.remove('incorrect-answer-feedback');
                }, 500);
            });
            
            // Reset for another try
            setTimeout(() => {
                state.userSentence = [];
                renderExercise();
            }, 1500);
        }
    }

    function handleHintClick() {
        if (state.isLocked || state.exercises.length === 0) return;

        const exercise = state.exercises[state.currentExerciseIndex];
        const correctWordArray = exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];
        const nonPunctuationWords = correctWordArray.filter(token => !isPunctuation(token));

        // Use the same logic as word selection - filter user sentence for non-punctuation words
        const userWords = state.userSentence.filter(token => !isPunctuation(token));

        if (userWords.length < nonPunctuationWords.length) {
            const nextCorrectWord = nonPunctuationWords[userWords.length];
            const availableButtons = scrambledWordsContainer.querySelectorAll('.btn-word:not(.word-collected)');

            for (const button of availableButtons) {
                if (button.dataset.word === nextCorrectWord) {
                    button.classList.add('hint-word');
                    state.hintsUsed++;
                    state.exercisesWithHints.add(state.currentExerciseIndex);

                    // Track per-exercise hint
                    const exerciseId = state.exerciseIds[state.currentExerciseIndex];
                    if (exerciseId && state.exercisePerformance.has(exerciseId)) {
                        const perf = state.exercisePerformance.get(exerciseId);
                        perf.hints++;
                    }

                    setTimeout(() => {
                        button.classList.remove('hint-word');
                    }, 2000);
                    break;
                }
            }
        }
    }

    function showStatisticsPage() {
        state.isSessionComplete = true;
        const endTime = Date.now();
        state.sessionTime = Math.floor((endTime - state.startTime) / 1000);

        if (state.isLoggedIn) {
            saveUserStats();
        }

        // Calculate session statistics
        const mistakesCount = state.exercisesWithMistakes.size;
        let solvedWithHintsOnlyCount = 0;
        let solvedAloneCount = 0;

        for (let i = 0; i < state.exercises.length; i++) {
            const hadMistake = state.exercisesWithMistakes.has(i);
            const hadHint = state.exercisesWithHints.has(i);

            if (!hadMistake && !hadHint) {
                solvedAloneCount++;
            } else if (!hadMistake && hadHint) {
                solvedWithHintsOnlyCount++;
            }
        }

        const avgTimePerExercise = state.exercises.length > 0 ?
            (state.sessionTime / state.exercises.length).toFixed(1) : 0;

        // Create statistics display
        const statsContainer = document.createElement('div');
        statsContainer.id = 'statistics-container';
        statsContainer.className = 'card rounded-lg p-8 text-center';

        statsContainer.innerHTML = `
            <h2 class="text-3xl font-bold text-gray-800 mb-6">Session Complete! 🎉</h2>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
                <div class="text-center">
                    <div class="text-2xl font-bold text-[#22C55E]">${solvedAloneCount}</div>
                    <div class="text-gray-600">Perfect</div>
                </div>
                <div class="text-center">
                    <div class="text-2xl font-bold text-[#3B82F6]">${solvedWithHintsOnlyCount}</div>
                    <div class="text-gray-600">With Hints</div>
                </div>
                <div class="text-center">
                    <div class="text-2xl font-bold text-[#EF4444]">${mistakesCount}</div>
                    <div class="text-gray-600">With Mistakes</div>
                </div>
                <div class="text-center">
                    <div class="text-2xl font-bold text-[#A58D78]">${state.sessionTime}s</div>
                    <div class="text-gray-600">Total Time</div>
                </div>
            </div>
            <div class="mb-8">
                <h3 class="text-xl font-bold text-gray-800 mb-4">Session Analysis</h3>
                <div class="max-w-xs mx-auto">
                    <canvas id="session-chart"></canvas>
                </div>
            </div>
            <div class="flex flex-col sm:flex-row gap-4 justify-center">
                <button id="new-session-btn" class="btn-primary px-6 py-3 rounded-lg font-semibold text-lg">
                    New Practice Session
                </button>
                <button id="same-exercises-btn" class="btn-primary px-6 py-3 rounded-lg font-semibold text-lg">
                    Retry These Exercises
                </button>
                ${state.isLoggedIn ? '<button id="view-progress-btn" class="btn-primary px-6 py-3 rounded-lg font-semibold text-lg">View Your Progress</button>' : ''}
            </div>
        `;

        // Replace exercise content with statistics
        document.getElementById('exercise-container').classList.add('hidden');
        document.querySelector('main .max-w-3xl').appendChild(statsContainer);

        // Add event listeners for the buttons
        document.getElementById('new-session-btn').addEventListener('click', resetForNewSession);
        document.getElementById('same-exercises-btn').addEventListener('click', resetForSameExercises);

        if (state.isLoggedIn) {
            const viewProgressBtn = document.getElementById('view-progress-btn');
            if (viewProgressBtn) {
                viewProgressBtn.addEventListener('click', showUserExerciseStats);
            }
        }

        // --- Chart.js Implementation ---
        const ctx = document.getElementById('session-chart').getContext('2d');
        new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Perfect', 'With Hints', 'With Mistakes'],
                datasets: [{
                    data: [solvedAloneCount, solvedWithHintsOnlyCount, mistakesCount],
                    backgroundColor: [
                        '#22C55E',  // Green for perfect
                        '#3B82F6',  // Blue for hints
                        '#EF4444'   // Red for mistakes
                    ],
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: false,
                        text: 'Session Performance'
                    }
                }
            }
        });
    }

    function resetForNewSession() {
        const statsContainer = document.getElementById('statistics-container');
        if (statsContainer) {
            statsContainer.remove();
        }

        document.getElementById('exercise-container').classList.remove('hidden');

        state.currentExerciseIndex = 0;
        state.mistakes = 0;
        state.hintsUsed = 0;
        state.sessionTime = 0;
        state.isSessionComplete = false;
        state.startTime = null;
        state.exercises = [];
        state.exercisesWithMistakes.clear();
        state.exercisesWithHints.clear();
        state.completedExerciseIds.clear();

        // Clean up loading state and timers
        loadingSpinner.classList.add('hidden');
        if (state.timerInterval) {
            clearInterval(state.timerInterval);
        }

        // Re-enable the generate button
        generateBtn.disabled = false;

        // Automatically fetch new exercises
        fetchExercises();
    }

    function resetForSameExercises() {
        const statsContainer = document.getElementById('statistics-container');
        if (statsContainer) {
            statsContainer.remove();
        }

        document.getElementById('exercise-container').classList.remove('hidden');

        state.currentExerciseIndex = 0;
        state.mistakes = 0;
        state.hintsUsed = 0;
        state.sessionTime = 0;
        state.isSessionComplete = false;
        state.startTime = Date.now();
        state.exercisesWithMistakes.clear();
        state.exercisesWithHints.clear();
        state.completedExerciseIds.clear();

        // Clean up loading state and timers
        loadingSpinner.classList.add('hidden');
        if (state.timerInterval) {
            clearInterval(state.timerInterval);
        }

        // Re-enable the generate button
        generateBtn.disabled = false;

        renderExercise();
    }

    function handleKeyPress(event) {
        if (state.isLocked) return;

        const key = event.key.toLowerCase();
        const wordButtons = scrambledWordsContainer.querySelectorAll('.btn-word:not(.word-collected)');
        
        for (const button of wordButtons) {
            if (button.dataset.hotkey === key) {
                button.click();
                break;
            }
        }
    }

    function handleReplayAudio() {
        if (!state.isAudioEnabled) return;
        playSentenceAudio(state.lastAudioUrl, state.lastAudioText);
    }

    function handleAudioToggle() {
        setAudioEnabled(!state.isAudioEnabled);
    }

    async function handleToggleFavorite() {
        if (!state.isLoggedIn) return;

        const exercise = state.exercises[state.currentExerciseIndex];
        const exerciseId = state.exerciseIds[state.currentExerciseIndex];

        // Optimistic UI update
        const newStatus = !exercise.is_favorite;
        exercise.is_favorite = newStatus;
        updateFavoriteButtonState(newStatus);

        try {
            const response = await fetch('/api/exercises/favorite', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    exercise_id: exerciseId
                })
            });

            if (!response.ok) {
                throw new Error('Failed to toggle favorite');
            }

            const data = await response.json();
            // Ensure state matches server response
            exercise.is_favorite = data.is_favorite;
            updateFavoriteButtonState(exercise.is_favorite);

        } catch (error) {
            console.error('Error toggling favorite:', error);
            // Revert on error
            exercise.is_favorite = !newStatus;
            updateFavoriteButtonState(exercise.is_favorite);
            alert('Failed to update favorite status.');
        }
    }

    function updateFavoriteButtonState(isFavorite) {
        const svg = toggleFavoriteBtn.querySelector('svg');
        if (isFavorite) {
            favoriteBtnText.textContent = 'Remove from Favorites';
            toggleFavoriteBtn.classList.remove('btn-secondary');
            toggleFavoriteBtn.classList.add('btn-primary', 'bg-yellow-500', 'hover:bg-yellow-600', 'border-yellow-600');
            svg.setAttribute('fill', 'currentColor');
        } else {
            favoriteBtnText.textContent = 'Add to Favorites';
            toggleFavoriteBtn.classList.remove('btn-primary', 'bg-yellow-500', 'hover:bg-yellow-600', 'border-yellow-600');
            toggleFavoriteBtn.classList.add('btn-secondary');
            svg.setAttribute('fill', 'none');
        }
    }

    function handleSkipExercise() {
        const wasLastExercise = state.currentExerciseIndex === state.exercises.length - 1;
        const skippedExerciseId = state.exerciseIds[state.currentExerciseIndex];
        if (skippedExerciseId) {
            state.exercisePerformance.delete(skippedExerciseId);
            state.completedExerciseIds.delete(skippedExerciseId);
        }

        // Remove the current exercise from the session queue (client-side only)
        state.exercises.splice(state.currentExerciseIndex, 1);
        state.exerciseIds.splice(state.currentExerciseIndex, 1);

        // If the last queue item was skipped, session should finish immediately.
        if (state.exercises.length === 0 || wasLastExercise) {
            showStatisticsPage();
            return;
        }

        // Stay at the same index (which now points to the next exercise), or go back if at end
        if (state.currentExerciseIndex >= state.exercises.length) {
            state.currentExerciseIndex = state.exercises.length - 1;
        }

        renderExercise();
    }

    async function handleHideExercise() {
        if (!state.isLoggedIn) return;

        const wasLastExercise = state.currentExerciseIndex === state.exercises.length - 1;
        const exerciseId = state.exerciseIds[state.currentExerciseIndex];

        try {
            const response = await fetch('/api/exercises/hide', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exercise_id: exerciseId })
            });

            if (!response.ok) {
                throw new Error('Failed to hide exercise');
            }
        } catch (error) {
            console.error('Error hiding exercise:', error);
            alert('Failed to remove exercise. Please try again.');
            return;
        }

        // Remove from session queue
        if (exerciseId) {
            state.exercisePerformance.delete(exerciseId);
            state.completedExerciseIds.delete(exerciseId);
        }
        state.exercises.splice(state.currentExerciseIndex, 1);
        state.exerciseIds.splice(state.currentExerciseIndex, 1);

        if (state.exercises.length === 0 || wasLastExercise) {
            showStatisticsPage();
            return;
        }

        if (state.currentExerciseIndex >= state.exercises.length) {
            state.currentExerciseIndex = state.exercises.length - 1;
        }

        renderExercise();
    }

    function handleNextExercise() {
        if (state.currentExerciseIndex < state.exercises.length - 1) {
            state.currentExerciseIndex++;
            renderExercise();
        } else {
            showStatisticsPage();
        }
    }

    // --- Topics API Functions ---
    async function loadTopics() {
        try {
            const response = await fetch('/api/topics');
            if (!response.ok) throw new Error('Failed to load topics');
            
            const data = await response.json();
            state.topics = data.topics || [];
            
            renderTopicsList();
            
            // Load selected topic from localStorage or use first available
            const savedTopicId = localStorage.getItem('selectedTopicId');
            if (savedTopicId && state.topics.find(t => t.id === savedTopicId)) {
                state.currentTopicId = savedTopicId;
            } else if (state.topics.length > 0) {
                state.currentTopicId = state.topics[0].id;
            }
            
            const currentTopic = state.topics.find(t => t.id === state.currentTopicId);
            if (currentTopic) {
                topicSearch.value = currentTopic.name;
            }
            
        } catch (error) {
            console.error('Error loading topics:', error);
            alert('Failed to load topics. Please refresh the page.');
        }
    }

    function sortTopics(topics, sortOrder) {
        const sorted = [...topics]; // Create a copy to avoid mutating original

        switch (sortOrder) {
            case 'name-asc':
                sorted.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'name-desc':
                sorted.sort((a, b) => b.name.localeCompare(a.name));
                break;
            case 'date-newest':
                sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                break;
            case 'date-oldest':
                sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                break;
        }

        return sorted;
    }

    function renderTopicsList() {
        topicsList.innerHTML = '';

        // Apply sorting
        const sortedTopics = sortTopics(state.topics, state.topicSortOrder);

        sortedTopics.forEach(topic => {
            const topicDiv = document.createElement('div');
            topicDiv.className = 'flex justify-between items-center p-3 border rounded-md bg-gray-50';
            
            topicDiv.innerHTML = `
                <div>
                    <div class="font-medium">${topic.name}</div>
                    <div class="text-sm text-gray-500">Created: ${new Date(topic.created_at).toLocaleDateString()}</div>
                </div>
                <div class="flex space-x-2">
                    <button class="edit-topic-btn text-blue-600 hover:text-blue-800 text-sm" data-topic-id="${topic.id}">Edit</button>
                    <button class="delete-topic-btn text-red-600 hover:text-red-800 text-sm" data-topic-id="${topic.id}">Delete</button>
                </div>
            `;
            
            topicsList.appendChild(topicDiv);
        });
        
        // Add event listeners for edit and delete buttons
        topicsList.querySelectorAll('.edit-topic-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const topicId = e.target.dataset.topicId;
                showPromptEditor(topicId);
            });
        });
        
        topicsList.querySelectorAll('.delete-topic-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const topicId = e.target.dataset.topicId;
                deleteTopic(topicId);
            });
        });
    }

    async function createTopic(name, prompt) {
        try {
            const response = await fetch('/api/topics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, prompt })
            });
            
            if (!response.ok) throw new Error('Failed to create topic');
            
            await loadTopics(); // Refresh the topics list
            hideAddTopicForm();
            
        } catch (error) {
            console.error('Error creating topic:', error);
            alert('Failed to create topic. Please try again.');
        }
    }

    async function deleteTopic(topicId) {
        if (!confirm('Are you sure you want to delete this topic? This action cannot be undone.')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/topics/${topicId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Failed to delete topic');
            
            // If this was the selected topic, clear selection
            if (state.currentTopicId === topicId) {
                state.currentTopicId = '';
                localStorage.removeItem('selectedTopicId');
            }
            
            await loadTopics(); // Refresh the topics list
            
        } catch (error) {
            console.error('Error deleting topic:', error);
            alert('Failed to delete topic. Please try again.');
        }
    }

    async function updateTopicPrompt(topicId, name, prompt) {
        try {
            const response = await fetch(`/api/topics/${topicId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, prompt })
            });
            
            if (!response.ok) throw new Error('Failed to update prompt');
            
            await loadTopics(); // Refresh the topics list
            hidePromptEditor();
            
        } catch (error) {
            console.error('Error updating prompt:', error);
            alert('Failed to update prompt. Please try again.');
        }
    }

    async function fetchExercises() {
        if (!state.currentTopicId) {
            alert('Please select a topic first.');
            return;
        }

        loadingSpinner.classList.remove('hidden');
        exerciseContent.classList.add('hidden');
        generateBtn.disabled = true;
        state.timer = 60;
        timer.textContent = state.timer;
        state.timerInterval = setInterval(() => {
            state.timer--;
            timer.textContent = state.timer;
            if (state.timer === 0) {
                clearInterval(state.timerInterval);
            }
        }, 1000);

        try {
            const response = await fetch('/api/exercises', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    topic_id: state.currentTopicId
                })
            });

            if (!response.ok) {
                let errorMessage = `${response.status} ${response.statusText}`;
                let errorCode = '';
                let retryable = false;

                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const errorData = await response.json().catch(() => ({}));
                    if (errorData?.error?.message) {
                        errorMessage = errorData.error.message;
                    }
                    if (errorData?.error?.details) {
                        errorMessage = `${errorMessage}\nDetails: ${errorData.error.details}`;
                    }
                    errorCode = errorData?.error?.code || '';
                    retryable = Boolean(errorData?.error?.retryable);
                } else {
                    const errorText = await response.text().catch(() => '');
                    if (errorText) {
                        errorMessage = errorText;
                    }
                }

                const error = new Error(errorMessage);
                error.status = response.status;
                error.code = errorCode;
                error.retryable = retryable;
                throw error;
            }

            const data = await response.json();

            if (data.exercises && data.exercises.length > 0) {
                state.exercises = data.exercises.map(ex => ({
                    ...ex.exercise_json,
                    id: ex.id,
                    audio_file_path: ex.audio_file_path,
                    is_favorite: ex.is_favorite || false
                }));
                state.exerciseIds = data.exercises.map(ex => ex.id);
                state.currentExerciseIndex = 0;
                state.mistakes = 0;
                state.hintsUsed = 0;
                state.sessionTime = 0;
                state.isSessionComplete = false;
                state.exercisesWithMistakes = new Set();
                state.exercisesWithHints = new Set();
                state.exercisePerformance = new Map();
                state.completedExerciseIds = new Set();

                // Initialize performance tracking for each exercise
                state.exerciseIds.forEach(id => {
                    state.exercisePerformance.set(id, { hints: 0, mistakes: 0 });
                });

                state.startTime = Date.now();
                renderExercise();
            } else {
                // This can happen if generation fails or cache is empty and generation is disabled
                alert('No exercises could be retrieved for this topic. Please try another topic or contact support.');
                renderExercise(); // Render empty state
            }

        } catch (error) {
            console.error('Error fetching exercises:', error);
            if (error.status === 429) {
                alert(`Rate Limit Exceeded: ${error.message}`);
            } else if (error.status === 504 || error.code === 'UPSTREAM_TIMEOUT') {
                alert(`The AI provider took too long to respond. Please try again in a moment.\nError: ${error.message}`);
            } else {
                const retryHint = error.retryable ? '\nYou can retry this request.' : '';
                alert(`Failed to fetch new exercises.\nError: ${error.message}${retryHint}`);
            }
            renderExercise();
        } finally {
            loadingSpinner.classList.add('hidden');
            clearInterval(state.timerInterval);
            // Keep button disabled and re-enable after 5 seconds
            setTimeout(() => {
                generateBtn.disabled = false;
            }, 5000);
        }
    }

    // --- UI Helper Functions ---
    function showAddTopicForm() {
        addTopicForm.classList.remove('hidden');
        newTopicName.value = '';
        newTopicPrompt.value = '';
        newTopicName.focus();
    }

    function hideAddTopicForm() {
        addTopicForm.classList.add('hidden');
    }

    function showPromptEditor(topicId) {
        const topic = state.topics.find(t => t.id === topicId);
        if (!topic) return;
        
        state.editingTopicId = topicId;
        currentTopicName.textContent = topic.name;
        promptTextarea.value = topic.prompt;
        promptEditor.classList.remove('hidden');
        versionHistory.classList.add('hidden');
    }

    function hidePromptEditor() {
        promptEditor.classList.add('hidden');
        state.editingTopicId = null;
    }

    async function showVersionHistory(topicId) {
        try {
            const response = await fetch(`/api/versions/${topicId}`);
            if (!response.ok) throw new Error('Failed to load versions');
            
            const data = await response.json();
            const versions = data.versions || [];
            
            const topic = state.topics.find(t => t.id === topicId);
            versionTopicName.textContent = topic ? topic.name : 'Unknown Topic';
            
            versionsList.innerHTML = '';
            
            versions.reverse().forEach(version => {
                const versionDiv = document.createElement('div');
                versionDiv.className = 'flex justify-between items-center p-2 border rounded text-sm';
                
                versionDiv.innerHTML = `
                    <div>
                        <div class="font-medium">Version ${version.version}</div>
                        <div class="text-gray-500">${new Date(version.created_at).toLocaleString()}</div>
                    </div>
                    <button class="restore-version-btn text-blue-600 hover:text-blue-800" 
                            data-topic-id="${topicId}" data-version-id="${version.id}">
                        Restore
                    </button>
                `;
                
                versionsList.appendChild(versionDiv);
            });
            
            // Add event listeners for restore buttons
            versionsList.querySelectorAll('.restore-version-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const topicId = e.target.dataset.topicId;
                    const versionId = e.target.dataset.versionId;
                    await restoreVersion(topicId, versionId);
                });
            });
            
            promptEditor.classList.add('hidden');
            versionHistory.classList.remove('hidden');
            
        } catch (error) {
            console.error('Error loading version history:', error);
            alert('Failed to load version history.');
        }
    }

    async function restoreVersion(topicId, versionId) {
        if (!confirm('Are you sure you want to restore this version? This will create a new version with this content.')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/versions/${topicId}/restore/${versionId}`, {
                method: 'POST'
            });
            
            if (!response.ok) throw new Error('Failed to restore version');
            
            await loadTopics(); // Refresh topics
            versionHistory.classList.add('hidden');
            alert('Version restored successfully!');
            
        } catch (error) {
            console.error('Error restoring version:', error);
            alert('Failed to restore version.');
        }
    }

    // --- Observability Functions ---
    async function showLastRefinedPrompt() {
        try {
            let promptText = 'No generation prompt has been recorded yet.';

            const debugResponse = await fetch('/api/last-generation-debug');
            if (debugResponse.ok) {
                const debugData = await debugResponse.json();
                const conjunctions = (debugData.profile?.conjunction_set || []).join(', ') || 'none';
                const qualityFailures = (debugData.quality_gate_failures || []).length;
                const debugSummary = [
                    `Batch: ${debugData.batch_id || 'n/a'}`,
                    `Model: ${debugData.model_name || 'n/a'}`,
                    `Refinement: ${debugData.refinement_used ? 'used' : 'fallback/base prompt'}`,
                    `Provider retries: ${debugData.provider_retry_count || 0}`,
                    `Quality retries: ${debugData.quality_gate_retry_count || 0}`,
                    `Conjunction targets: ${conjunctions}`,
                    `Quality issues: ${qualityFailures}`
                ].join('\n');

                promptText = (debugData.prompt || promptText) + `\n\n---\n${debugSummary}`;
            } else {
                const legacyResponse = await fetch('/api/last-refined-prompt');
                if (!legacyResponse.ok) throw new Error('Failed to fetch generation prompt details.');
                const legacyData = await legacyResponse.json();
                promptText = legacyData.last_refined_prompt || promptText;
            }

            lastRefinedPromptContent.textContent = promptText;
            lastRefinedPromptModal.classList.remove('hidden');

        } catch (error) {
            console.error('Error fetching last refined prompt:', error);
            alert('Could not fetch the last refined prompt. Please try generating some exercises first.');
        }
    }

    // --- Event Listeners ---
    settingsBtn.addEventListener('click', () => {
        loadTopics(); // Refresh topics when opening settings
        settingsModal.classList.remove('hidden');
    });

    settingsCloseBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
        hideAddTopicForm();
        hidePromptEditor();
        versionHistory.classList.add('hidden');
    });

    // Topic sorting
    topicSort.value = state.topicSortOrder; // Set initial value
    topicSort.addEventListener('change', (e) => {
        state.topicSortOrder = e.target.value;
        localStorage.setItem('topicSortOrder', state.topicSortOrder);
        renderTopicsList();
    });

    addTopicBtn.addEventListener('click', showAddTopicForm);
    cancelAddBtn.addEventListener('click', hideAddTopicForm);

    saveTopicBtn.addEventListener('click', () => {
        const name = newTopicName.value.trim();
        const prompt = newTopicPrompt.value.trim();
        
        if (!name || !prompt) {
            alert('Please provide both a name and a prompt.');
            return;
        }
        
        createTopic(name, prompt);
    });

    cancelEditBtn.addEventListener('click', hidePromptEditor);

    savePromptBtn.addEventListener('click', () => {
        const prompt = promptTextarea.value.trim();
        const name = currentTopicName.textContent.trim();
        
        if (!prompt) {
            alert('Prompt cannot be empty.');
            return;
        }
        
        updateTopicPrompt(state.editingTopicId, name, prompt);
    });

    viewVersionsBtn.addEventListener('click', () => {
        if (state.editingTopicId) {
            showVersionHistory(state.editingTopicId);
        }
    });

    closeVersionsBtn.addEventListener('click', () => {
        versionHistory.classList.add('hidden');
        promptEditor.classList.remove('hidden');
    });

    generateBtn.addEventListener('click', () => {
        fetchExercises();
    });
    audioToggleBtn.addEventListener('click', handleAudioToggle);
    hintBtn.addEventListener('click', handleHintClick);
    replayAudioBtn.addEventListener('click', handleReplayAudio);
    toggleFavoriteBtn.addEventListener('click', handleToggleFavorite);
    skipExerciseBtn.addEventListener('click', handleSkipExercise);
    hideExerciseBtn.addEventListener('click', handleHideExercise);
    nextExerciseBtn.addEventListener('click', handleNextExercise);
    document.addEventListener('keydown', handleKeyPress);

    viewLastRefinedPromptBtn.addEventListener('click', showLastRefinedPrompt);
    lastRefinedPromptCloseBtn.addEventListener('click', () => {
        lastRefinedPromptModal.classList.add('hidden');
    });

    // --- Combobox Functions ---
    function renderTopicDropdown(topics) {
        topicDropdown.innerHTML = '';
        if (topics.length === 0) {
            topicDropdown.innerHTML = `<div class="p-2 text-gray-500">No topics found.</div>`;
            return;
        }
        topics.forEach(topic => {
            const item = document.createElement('div');
            item.className = 'topic-item';
            item.textContent = topic.name;
            item.dataset.topicId = topic.id;
            item.addEventListener('click', () => {
                selectTopic(topic.id, topic.name);
            });
            topicDropdown.appendChild(item);
        });
    }

    function selectTopic(topicId, topicName) {
        state.currentTopicId = topicId;
        localStorage.setItem('selectedTopicId', topicId);
        topicSearch.value = topicName;
        topicDropdown.classList.add('hidden');
        if (state.isLoggedIn) {
            saveUserSettings();
        }
    }

    // Position dropdown function
    function positionDropdown() {
        const searchRect = topicSearch.getBoundingClientRect();
        topicDropdown.style.left = searchRect.left + 'px';
        topicDropdown.style.top = (searchRect.bottom + 4) + 'px';
        topicDropdown.style.width = searchRect.width + 'px';
    }

    // --- Event Listeners ---
    topicSearch.addEventListener('focus', () => {
        renderTopicDropdown(state.topics);
        positionDropdown();
        topicDropdown.classList.remove('hidden');
    });

    topicSearch.addEventListener('blur', () => {
        // Delay hiding so that a click on a dropdown item can be registered
        setTimeout(() => {
            topicDropdown.classList.add('hidden');
            // If the search input doesn't match a topic name, reset it
            const currentTopic = state.topics.find(t => t.id === state.currentTopicId);
            if (currentTopic) {
                topicSearch.value = currentTopic.name;
            } else {
                topicSearch.value = '';
            }
        }, 200);
    });

    // Reposition dropdown on window resize and scroll
    window.addEventListener('resize', () => {
        if (!topicDropdown.classList.contains('hidden')) {
            positionDropdown();
        }
    });
    
    window.addEventListener('scroll', () => {
        if (!topicDropdown.classList.contains('hidden')) {
            positionDropdown();
        }
    });
    
    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!topicSearch.contains(e.target) && !topicDropdown.contains(e.target)) {
            topicDropdown.classList.add('hidden');
        }
    });

    topicSearch.addEventListener('input', () => {
        const searchTerm = topicSearch.value.toLowerCase();
        const filteredTopics = state.topics.filter(topic =>
            topic.name.toLowerCase().includes(searchTerm)
        );
        renderTopicDropdown(filteredTopics);
        if (!topicDropdown.classList.contains('hidden')) {
            positionDropdown();
        }
    });

    loginBtn.addEventListener('click', () => {
        window.location.href = '/auth/google/login';
    });

    statsBtn.addEventListener('click', showUserExerciseStats);

    statsCloseBtn.addEventListener('click', () => {
        statsModal.classList.add('hidden');
    });

    historyBtn.addEventListener('click', showExerciseHistory);

    historyCloseBtn.addEventListener('click', () => {
        historyModal.classList.add('hidden');
    });

    historyFilterReady.addEventListener('click', () => {
        state.historyFilterReady = !state.historyFilterReady;
        state.historyPage = 1; // Reset to first page
        updateHistoryFilterUI();
        renderHistoryPage();
    });

    historyFilterFavorites.addEventListener('click', () => {
        state.historyFilterFavorites = !state.historyFilterFavorites;
        state.historyPage = 1; // Reset to first page
        updateHistoryFilterUI();
        renderHistoryPage();
    });

    function updateHistoryFilterUI() {
        // Update Ready to Practice filter UI
        if (state.historyFilterReady) {
            historyFilterReady.classList.add('ring-2', 'ring-green-400', 'bg-green-200');
            historyFilterReady.classList.remove('bg-green-100');
        } else {
            historyFilterReady.classList.remove('ring-2', 'ring-green-400', 'bg-green-200');
            historyFilterReady.classList.add('bg-green-100');
        }

        // Update Favorites filter UI
        const favoritesSvg = historyFilterFavorites.querySelector('svg');
        if (state.historyFilterFavorites) {
            historyFilterFavorites.classList.add('bg-yellow-50', 'border-yellow-400', 'text-yellow-700');
            historyFilterFavorites.classList.remove('hover:bg-gray-100', 'border-gray-300');
            favoritesSvg.setAttribute('fill', 'currentColor');
        } else {
            historyFilterFavorites.classList.remove('bg-yellow-50', 'border-yellow-400', 'text-yellow-700');
            historyFilterFavorites.classList.add('hover:bg-gray-100', 'border-gray-300');
            favoritesSvg.setAttribute('fill', 'none');
        }
    }

    historyPrevBtn.addEventListener('click', () => {
        if (state.historyPage > 1) {
            state.historyPage--;
            renderHistoryPage();
        }
    });

    historyNextBtn.addEventListener('click', () => {
        const filteredData = getFilteredHistoryData();
        const totalPages = Math.ceil(filteredData.length / state.historyItemsPerPage);
        if (state.historyPage < totalPages) {
            state.historyPage++;
            renderHistoryPage();
        }
    });

    logoutBtn.addEventListener('click', () => {
        window.location.href = '/auth/logout';
    });

    async function checkAuthStatus() {
        try {
            const response = await fetch('/api/auth/status');
            const data = await response.json();
            state.isLoggedIn = data.logged_in;
            state.userId = data.user_id;

            if (state.isLoggedIn) {
                const adminResponse = await fetch('/api/auth/is_admin');
                const adminData = await adminResponse.json();
                state.isAdmin = adminData.is_admin;
                loadUserStats();
            } else {
                state.isAdmin = false;
            }
            updateAuthUI();
        } catch (error) {
            console.error('Error checking auth status:', error);
            state.isAdmin = false;
            updateAuthUI();
        }
    }

    async function loadUserStats() {
        try {
            const response = await fetch('/api/user/stats');
            const stats = await response.json();
            if (stats.last_topic_id) {
                state.currentTopicId = stats.last_topic_id;
                localStorage.setItem('selectedTopicId', stats.last_topic_id);
                const currentTopic = state.topics.find(t => t.id === state.currentTopicId);
                if (currentTopic) {
                    topicSearch.value = currentTopic.name;
                }
            }
        } catch (error) {
            console.error('Error loading user stats:', error);
        }
    }

    function updateAuthUI() {
        if (state.isLoggedIn) {
            loginBtn.classList.add('hidden');
            logoutBtn.classList.remove('hidden');
            statsBtn.classList.remove('hidden');
            historyBtn.classList.remove('hidden');
            hideExerciseBtn.classList.remove('hidden');
        } else {
            loginBtn.classList.remove('hidden');
            logoutBtn.classList.add('hidden');
            statsBtn.classList.add('hidden');
            historyBtn.classList.add('hidden');
            hideExerciseBtn.classList.add('hidden');
        }

        if (state.isAdmin) {
            settingsBtn.classList.remove('hidden');
        } else {
            settingsBtn.classList.add('hidden');
        }
    }

    async function showUserExerciseStats() {
        if (!state.isLoggedIn) {
            alert("Please log in to see your stats.");
            return;
        }

        try {
            const response = await fetch('/api/user/exercisestats');
            if (!response.ok) {
                if (response.status === 401) {
                    alert("Your session has expired. Please log in again.");
                    return;
                }
                throw new Error('Failed to fetch exercise stats');
            }

            const stats = await response.json();
            statsReadyToRepeatEl.textContent = stats.ready_to_repeat;
            statsTrainedEl.textContent = stats.trained;
            statsModal.classList.remove('hidden');

        } catch (error) {
            console.error('Error fetching exercise stats:', error);
            alert('Could not load your progress stats. Please try again later.');
        }
    }

    async function showExerciseHistory() {
        if (!state.isLoggedIn) {
            alert("Please log in to view your exercise history.");
            return;
        }

        // Show modal and loading state
        historyModal.classList.remove('hidden');
        historyLoading.classList.remove('hidden');
        historyEmpty.classList.add('hidden');
        historyContent.classList.add('hidden');
        historyPagination.classList.add('hidden');

        try {
            // Build URL with optional topic filter
            let url = '/api/exercises/history';
            if (state.currentTopicId) {
                url += `?topic_id=${state.currentTopicId}`;
                const topic = state.topics.find(t => t.id === state.currentTopicId);
                historyTopicName.textContent = topic ? topic.name : 'Selected Topic';
            } else {
                historyTopicName.textContent = 'All Topics';
            }

            const response = await fetch(url);
            if (!response.ok) {
                if (response.status === 401) {
                    alert("Your session has expired. Please log in again.");
                    historyModal.classList.add('hidden');
                    return;
                }
                throw new Error('Failed to fetch exercise history');
            }

            const data = await response.json();
            state.historyData = data.history || [];
            state.historyPage = 1;

            // Reset filters when opening fresh history
            state.historyFilterReady = false;
            state.historyFilterFavorites = false;
            updateHistoryFilterUI();

            historyLoading.classList.add('hidden');

            if (state.historyData.length === 0) {
                historyEmpty.classList.remove('hidden');
                historySummary.classList.add('hidden');
            } else {
                // Calculate summary statistics
                const readyCount = state.historyData.filter(item => item.ready_to_repeat).length;
                const totalAttempts = state.historyData.reduce((sum, item) => sum + item.total_attempts, 0);
                const totalSuccessful = state.historyData.reduce((sum, item) => sum + item.successful_attempts, 0);
                const successRate = totalAttempts > 0 ? Math.round((totalSuccessful / totalAttempts) * 100) : 0;

                // Update summary display
                historyTotalCount.textContent = state.historyData.length;
                historyReadyCount.textContent = readyCount;
                historySuccessRate.textContent = successRate + '%';
                historyTotalAttempts.textContent = totalAttempts;

                historySummary.classList.remove('hidden');
                historyContent.classList.remove('hidden');
                renderHistoryPage();
            }

        } catch (error) {
            console.error('Error fetching exercise history:', error);
            historyLoading.classList.add('hidden');
            historySummary.classList.add('hidden');
            alert('Could not load exercise history. Please try again later.');
        }
    }

    function getFilteredHistoryData() {
        return state.historyData.filter(item => {
            let matches = true;
            if (state.historyFilterReady) {
                matches = matches && item.ready_to_repeat;
            }
            if (state.historyFilterFavorites) {
                matches = matches && item.is_favorite;
            }
            return matches;
        });
    }

    function renderHistoryPage() {
        const filteredData = getFilteredHistoryData();
        const start = (state.historyPage - 1) * state.historyItemsPerPage;
        const end = start + state.historyItemsPerPage;
        const pageData = filteredData.slice(start, end);
        const totalPages = Math.ceil(filteredData.length / state.historyItemsPerPage);

        // Render items
        historyContent.innerHTML = '';

        if (filteredData.length === 0) {
             if (state.historyData.length > 0) {
                 historyContent.innerHTML = '<div class="text-center py-4 text-gray-500">No exercises match the selected filters.</div>';
             }
             historyPagination.classList.add('hidden');
             return;
        }

        pageData.forEach(item => {
            const itemEl = createHistoryItem(item);
            historyContent.appendChild(itemEl);
        });

        // Update pagination
        if (totalPages > 1) {
            historyPagination.classList.remove('hidden');
            historyPageInfo.textContent = `Page ${state.historyPage} of ${totalPages}`;
            historyPrevBtn.disabled = state.historyPage === 1;
            historyNextBtn.disabled = state.historyPage === totalPages;
        } else {
            historyPagination.classList.add('hidden');
        }
    }

    function createHistoryItem(item) {
        const div = document.createElement('div');
        div.className = 'border rounded-lg p-4 bg-white hover:shadow-md transition-shadow';

        // Calculate time info
        const lastViewed = new Date(item.last_viewed);
        const daysAgo = Math.floor((Date.now() - lastViewed.getTime()) / (1000 * 60 * 60 * 24));
        const timeText = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;

        // Determine status badge
        let statusBadge = '';
        if (item.ready_to_repeat) {
            statusBadge = '<span class="inline-block px-3 py-1 text-sm font-semibold text-white bg-green-500 rounded-full">Ready to Practice</span>';
        } else {
            const daysUntilReady = Math.ceil(item.next_review_days - ((Date.now() - lastViewed.getTime()) / (1000 * 60 * 60 * 24)));
            if (daysUntilReady > 0) {
                statusBadge = `<span class="inline-block px-3 py-1 text-sm font-semibold text-white bg-blue-500 rounded-full">Ready in ${daysUntilReady}d</span>`;
            }
        }

        // Success rate calculation
        const successRate = item.total_attempts > 0
            ? Math.round((item.successful_attempts / item.total_attempts) * 100)
            : 0;

        // Favorite icon
        const favoriteIcon = item.is_favorite ?
            `<span class="text-yellow-500 mr-2" title="Favorite">
                <svg class="w-5 h-5 inline" fill="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path>
                </svg>
            </span>` : '';

        div.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <div class="flex-1">
                    <h3 class="text-lg font-semibold text-gray-800 flex items-center">
                        ${favoriteIcon}
                        ${escapeHtml(item.german_sentence)}
                    </h3>
                    <p class="text-sm text-gray-600 mt-1">${escapeHtml(item.english_hint)}</p>
                </div>
                <div class="ml-4">
                    ${statusBadge}
                </div>
            </div>
            <div class="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
                <div class="flex space-x-4 text-sm text-gray-600">
                    <span class="font-medium">${item.topic_name}</span>
                    <span>•</span>
                    <span>${timeText}</span>
                </div>
                <div class="flex space-x-4 text-sm">
                    <span class="text-green-600" title="Successful attempts">✓ ${item.successful_attempts}</span>
                    <span class="text-red-600" title="Failed attempts">✗ ${item.failed_attempts}</span>
                    <span class="text-blue-600" title="Hints used">💡 ${item.hints_used}</span>
                    <span class="text-gray-600" title="Total attempts">Σ ${item.total_attempts}</span>
                    <span class="font-semibold ${successRate >= 75 ? 'text-green-600' : successRate >= 50 ? 'text-yellow-600' : 'text-red-600'}" title="Success rate">${successRate}%</span>
                </div>
            </div>
        `;

        return div;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async function saveUserStats() {
        try {
            // Save aggregate stats
            await fetch('/api/user/stats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    total_exercises: state.exercises.length,
                    total_mistakes: state.mistakes,
                    total_hints: state.hintsUsed,
                    total_time: state.sessionTime,
                })
            });

            // Save per-exercise completion data
            await saveExerciseCompletions();
        } catch (error) {
            console.error('Error saving user stats:', error);
        }
    }

    async function saveExerciseCompletions() {
        try {
            // Build completions only from exercises that were actually finished by the user.
            const completions = [];
            state.completedExerciseIds.forEach((exerciseId) => {
                const perf = state.exercisePerformance.get(exerciseId) || { hints: 0, mistakes: 0 };
                completions.push({
                    exercise_id: exerciseId,
                    hints_used: perf.hints,
                    mistakes: perf.mistakes
                });
            });

            if (completions.length > 0) {
                await fetch('/api/exercises/complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ completions })
                });
                console.log('Saved completion data for', completions.length, 'exercises');
            }
        } catch (error) {
            console.error('Error saving exercise completions:', error);
        }
    }

    async function saveUserSettings() {
        try {
            await fetch('/api/user/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    last_topic_id: state.currentTopicId,
                })
            });
        } catch (error) {
            console.error('Error saving user settings:', error);
        }
    }

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
    }

    init();
});
