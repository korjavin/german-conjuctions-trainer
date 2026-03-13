import { state } from './state.js';
import { dom } from './dom.js';
import { isPunctuation, playWordAudio, playSentenceAudio, preloadExerciseWordAudio } from './audio.js';
import { toggleFavoriteAPI, hideExerciseAPI, fetchExplainAPI } from './api.js';

let _onSessionComplete = () => {};

export function initExercise({ onSessionComplete }) {
    _onSessionComplete = onSessionComplete;
}

export function getHotkey(index) {
    if (index < 9) {
        return (index + 1).toString(); // 1-9
    } else {
        return String.fromCharCode(97 + index - 9); // a, b, c, etc.
    }
}

export function addPunctuationIfNeeded(exercise, userSentence) {
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

export function renderExercise() {
    state.isLocked = false;
    state.userSentence = [];

    // Hide control buttons by default and show hint/skip buttons
    dom.exerciseControls.classList.add('hidden');
    dom.hintBtn.classList.remove('hidden');
    dom.skipExerciseBtn.classList.remove('hidden');
    dom.scrambledWordsContainer.classList.remove('hidden');
    if (dom.scrambledWordsHeader) dom.scrambledWordsHeader.classList.remove('hidden');

    if (state.exercises.length === 0) {
        dom.exerciseContent.classList.add('hidden');
        dom.emptyStateContainer.classList.remove('hidden');
        dom.exerciseCounter.classList.add('hidden');
        dom.hintBtn.classList.add('hidden');
        return;
    }

    dom.exerciseContent.classList.remove('hidden');
    dom.emptyStateContainer.classList.add('hidden');
    dom.exerciseCounter.classList.remove('hidden');

    const exercise = state.exercises[state.currentExerciseIndex];

    addPunctuationIfNeeded(exercise, state.userSentence);

    dom.exerciseCounter.textContent = `${state.currentExerciseIndex + 1} / ${state.exercises.length}`;

    // Update favorite button state
    updateFavoriteButtonState(exercise.is_favorite);

    // Update progress bar
    const progress = ((state.currentExerciseIndex + 1) / state.exercises.length) * 100;
    if (dom.progressBar) {
        dom.progressBar.value = progress;
    }
    if (dom.progressPercentage) {
        dom.progressPercentage.textContent = `${Math.round(progress)}%`;
    }

    // Reset UI
    dom.englishHintEl.textContent = exercise.english_hint;
    dom.scrambledWordsContainer.innerHTML = '';
    dom.constructedSentenceEl.innerHTML = '';
    dom.correctSentenceDisplay.textContent = '';

    // Reset explanation state
    dom.explanationContainer.classList.add('hidden');
    dom.explainBtn.classList.add('hidden');
    state.explanationText = '';

    // Handle exercise topic label
    if (exercise.topic_id && exercise.topic_id !== state.currentTopicId) {
        const topic = state.topics.find(t => t.id === exercise.topic_id);
        if (topic && dom.exerciseTopicLabel) {
            dom.exerciseTopicLabel.textContent = topic.name;
            dom.exerciseTopicLabel.classList.remove('invisible');
        } else if (dom.exerciseTopicLabel) {
            dom.exerciseTopicLabel.textContent = '';
            dom.exerciseTopicLabel.classList.add('invisible');
        }
    } else if (dom.exerciseTopicLabel) {
        dom.exerciseTopicLabel.textContent = '';
        dom.exerciseTopicLabel.classList.add('invisible');
    }

    // Display initial punctuation if any
    if (state.userSentence.length > 0) {
        dom.answerPrompt.classList.add('hidden');
        state.userSentence.forEach(w => {
            const span = document.createElement('span');
            span.textContent = w;
            dom.constructedSentenceEl.appendChild(span);
        });
    } else {
        dom.answerPrompt.classList.remove('hidden');
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

        button.className = 'btn-word';
        button.dataset.hotkey = hotkey;
        button.dataset.word = word;

        button.addEventListener('click', () => handleWordClick(word, button));

        dom.scrambledWordsContainer.appendChild(button);
    });

    preloadExerciseWordAudio(exercise);
}

export function handleWordClick(word, button) {
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
        dom.constructedSentenceEl.innerHTML = '';
        dom.answerPrompt.classList.add('hidden');

        state.userSentence.forEach(w => {
            const span = document.createElement('span');
            span.textContent = w;
            dom.constructedSentenceEl.appendChild(span);
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

        // Track per-exercise mistake using actual ID instead of index
        const exerciseId = state.exerciseIds[state.currentExerciseIndex];

        // Track specific wrong words along with their context for better explanations
        if (!state.exerciseMistakes[exerciseId]) {
            state.exerciseMistakes[exerciseId] = new Set();
        }
        
        let contextStr = state.userSentence.join(' ').trim();
        let mistakeDesc = contextStr 
            ? `Tried to use "${word}" as the next word after successfully building: "${contextStr} "`
            : `Tried to use "${word}" as the very first word of the sentence`;
            
        state.exerciseMistakes[exerciseId].add(mistakeDesc);

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
        dom.correctSentenceDisplay.textContent = ''; // Hide the green text
        
        const exerciseId = state.exerciseIds[state.currentExerciseIndex];
        const perf = state.exercisePerformance.get(exerciseId) || { mistakes: 0, hints: 0 };
        
        let iconHtml = '';
        if (perf.mistakes > 0) {
            iconHtml = '<span title="Completed with mistakes" style="display: inline-flex; align-items: center; justify-content: center; color: #eab308;"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg></span>';
        } else if (perf.hints > 0) {
            iconHtml = '<span title="Completed with hints" style="display: inline-flex; align-items: center; justify-content: center; color: #3b82f6;"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg></span>';
        } else {
            iconHtml = '<span title="Perfectly completed" style="display: inline-flex; align-items: center; justify-content: center; color: #22c55e;"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></span>';
        }
        dom.completionStatusIndicator.innerHTML = iconHtml;

        state.lastAudioUrl = exercise.audio_file_path;
        state.lastAudioText = exercise.correct_german_sentence;

        if (exerciseId) {
            state.completedExerciseIds.add(exerciseId);
        }

        if (lastWord) {
            await playWordAudio(lastWord);
        }
        playSentenceAudio(state.lastAudioUrl, state.lastAudioText);

        // Show exercise controls and hide hint/skip buttons
        dom.exerciseControls.classList.remove('hidden');
        dom.hintBtn.classList.add('hidden');
        dom.skipExerciseBtn.classList.add('hidden');
        dom.scrambledWordsContainer.classList.add('hidden');
        if (dom.scrambledWordsHeader) dom.scrambledWordsHeader.classList.add('hidden');

        // Show explain button if mistakes were made on this exercise using actual ID
        if (state.exerciseMistakes[exerciseId] && state.exerciseMistakes[exerciseId].size > 0) {
            dom.explainBtn.classList.remove('hidden');
        }
    } else {
        state.mistakes++;

        // Show incorrect feedback
        const wrongWords = dom.scrambledWordsContainer.querySelectorAll('.btn-word.word-collected');
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

export function handleHintClick() {
    if (state.isLocked || state.exercises.length === 0) return;

    const exercise = state.exercises[state.currentExerciseIndex];
    const correctWordArray = exercise.correct_german_sentence.match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) || [];
    const nonPunctuationWords = correctWordArray.filter(token => !isPunctuation(token));

    const userWords = state.userSentence.filter(token => !isPunctuation(token));

    if (userWords.length < nonPunctuationWords.length) {
        const nextCorrectWord = nonPunctuationWords[userWords.length];
        const availableButtons = dom.scrambledWordsContainer.querySelectorAll('.btn-word:not(.word-collected)');

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

export function handleKeyPress(event) {
    if (state.isLocked) return;

    const key = event.key.toLowerCase();
    const wordButtons = dom.scrambledWordsContainer.querySelectorAll('.btn-word:not(.word-collected)');

    for (const button of wordButtons) {
        if (button.dataset.hotkey === key) {
            button.click();
            break;
        }
    }
}

export async function handleExplainClick() {
    if (state.isExplaining) return;

    const exercise = state.exercises[state.currentExerciseIndex];
    const exerciseId = state.exerciseIds[state.currentExerciseIndex];
    const correctSentence = exercise.correct_german_sentence;
    const topic = exercise.conjunction_topic || "Grammar Rule";

    // Capture the exact exercise ID to avoid race conditions when navigating away
    const requestingExerciseId = exerciseId;

    let mistakesArray = [];
    if (state.exerciseMistakes[requestingExerciseId]) {
        mistakesArray = Array.from(state.exerciseMistakes[requestingExerciseId]);
    }

    state.isExplaining = true;

    // UI Loading state
    dom.explainBtn.disabled = true;
    const btnText = dom.explainBtn.querySelector('span:first-child');
    const spinner = dom.explainBtn.querySelector('.loading-spinner');

    if (btnText && spinner) {
        btnText.textContent = 'Explaining...';
        spinner.classList.remove('hidden');
    }

    try {
        const data = await fetchExplainAPI(topic, correctSentence, mistakesArray);

        // Only update UI and state if the user hasn't navigated to the next exercise
        const currentExerciseId = state.exerciseIds[state.currentExerciseIndex];
        if (currentExerciseId === requestingExerciseId) {
            state.explanationText = data.explanation;
            dom.explanationText.textContent = state.explanationText;
            dom.explanationContainer.classList.remove('hidden');
            
            // Limit abuse: remove the button once explanation is successfully loaded
            dom.explainBtn.classList.add('hidden');
        }
    } catch (error) {
        console.error('Error fetching explanation:', error);
        alert('Failed to load explanation. Please try again.');
    } finally {
        state.isExplaining = false;
        dom.explainBtn.disabled = false;

        if (btnText && spinner) {
            btnText.textContent = '💡 Explain Mistakes';
            spinner.classList.add('hidden');
        }
    }
}

export function handleNextExercise() {
    if (state.currentExerciseIndex < state.exercises.length - 1) {
        state.currentExerciseIndex++;
        renderExercise();
    } else {
        _onSessionComplete();
    }
}

export function handleSkipExercise() {
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
        _onSessionComplete();
        return;
    }

    // Stay at the same index (which now points to the next exercise), or go back if at end
    if (state.currentExerciseIndex >= state.exercises.length) {
        state.currentExerciseIndex = state.exercises.length - 1;
    }

    renderExercise();
}

export async function handleHideExercise() {
    if (!state.isLoggedIn) return;

    const wasLastExercise = state.currentExerciseIndex === state.exercises.length - 1;
    const exerciseId = state.exerciseIds[state.currentExerciseIndex];

    try {
        await hideExerciseAPI(exerciseId);
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
        _onSessionComplete();
        return;
    }

    if (state.currentExerciseIndex >= state.exercises.length) {
        state.currentExerciseIndex = state.exercises.length - 1;
    }

    renderExercise();
}

export async function handleToggleFavorite() {
    if (!state.isLoggedIn) return;

    const exercise = state.exercises[state.currentExerciseIndex];
    const exerciseId = state.exerciseIds[state.currentExerciseIndex];

    // Optimistic UI update
    const newStatus = !exercise.is_favorite;
    exercise.is_favorite = newStatus;
    updateFavoriteButtonState(newStatus);

    try {
        const data = await toggleFavoriteAPI(exerciseId);
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

export function updateFavoriteButtonState(isFavorite) {
    const svg = dom.toggleFavoriteBtn.querySelector('svg');
    if (isFavorite) {
        dom.favoriteBtnText.textContent = 'Remove from Favorites';
        dom.toggleFavoriteBtn.classList.remove('btn-secondary');
        dom.toggleFavoriteBtn.classList.add('btn-primary');
        dom.toggleFavoriteBtn.classList.add('filter-active-yellow');
        svg.setAttribute('fill', 'currentColor');
    } else {
        dom.favoriteBtnText.textContent = 'Add to Favorites';
        dom.toggleFavoriteBtn.classList.remove('filter-active-yellow');
        dom.toggleFavoriteBtn.classList.remove('btn-primary');
        dom.toggleFavoriteBtn.classList.add('btn-secondary');
        svg.setAttribute('fill', 'none');
    }
}
