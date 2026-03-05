import { state } from './state.js';
import { dom } from './dom.js';
import { fetchExercisesFromAPI, saveUserStatsAPI, saveExerciseCompletionsAPI } from './api.js';
import { showUserExerciseStats } from './auth.js';

let _renderExercise = () => {};

export function initSession({ renderExercise }) {
    _renderExercise = renderExercise;
}

export async function fetchExercises() {
    if (!state.currentTopicId) {
        alert('Please select a topic first.');
        return;
    }

    dom.loadingSpinner.classList.remove('hidden');
    dom.exerciseContent.classList.add('hidden');
    dom.generateBtn.disabled = true;
    state.timer = 60;
    dom.timer.textContent = state.timer;
    state.timerInterval = setInterval(() => {
        state.timer--;
        dom.timer.textContent = state.timer;
        if (state.timer === 0) {
            clearInterval(state.timerInterval);
        }
    }, 1000);

    try {
        const data = await fetchExercisesFromAPI(state.currentTopicId);

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
            _renderExercise();
        } else {
            // This can happen if generation fails or cache is empty and generation is disabled
            alert('No exercises could be retrieved for this topic. Please try another topic or contact support.');
            _renderExercise(); // Render empty state
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
        _renderExercise();
    } finally {
        dom.loadingSpinner.classList.add('hidden');
        clearInterval(state.timerInterval);
        // Keep button disabled and re-enable after 5 seconds
        setTimeout(() => {
            dom.generateBtn.disabled = false;
        }, 5000);
    }
}

export function showStatisticsPage() {
    state.isSessionComplete = true;
    const endTime = Date.now();
    state.sessionTime = Math.floor((endTime - state.startTime) / 1000);

    if (state.isLoggedIn) {
        saveUserStats();
    }

    // Calculate session statistics
    const withMistakesCount = state.exercisesWithMistakes.size;
    const withHintsCount = state.exercisesWithHints.size;
    let perfectCount = 0;

    for (let i = 0; i < state.exercises.length; i++) {
        const hadMistake = state.exercisesWithMistakes.has(i);
        const hadHint = state.exercisesWithHints.has(i);

        if (!hadMistake && !hadHint) {
            perfectCount++;
        }
    }

    const avgTimePerExercise = state.exercises.length > 0 ?
        (state.sessionTime / state.exercises.length).toFixed(1) : 0;

    // Create statistics display
    const statsContainer = document.createElement('div');
    statsContainer.id = 'statistics-container';
    statsContainer.className = 'card p-8 text-center';

    statsContainer.innerHTML = `
        <h2 class="page-title mb-6">Session Complete! 🎉</h2>
        <div class="history-summary mb-8">
            <div class="summary-box">
                <div class="summary-value" style="color: #22C55E;">${perfectCount}</div>
                <div class="summary-label">Perfect</div>
            </div>
            <div class="summary-box">
                <div class="summary-value" style="color: #3B82F6;">${withHintsCount}</div>
                <div class="summary-label">With Hints</div>
            </div>
            <div class="summary-box">
                <div class="summary-value" style="color: #EF4444;">${withMistakesCount}</div>
                <div class="summary-label">With Mistakes</div>
            </div>
            <div class="summary-box">
                <div class="summary-value" style="color: #A58D78;">${state.sessionTime}s</div>
                <div class="summary-label">Total Time</div>
            </div>
        </div>
        <div class="mb-8">
            <h3 class="section-title mb-4">Session Analysis</h3>
            <div class="mx-auto" style="position: relative; height: 250px; width: 100%; max-width: 400px;">
                <canvas id="session-chart"></canvas>
            </div>
        </div>
        <div class="flex flex-wrap gap-4 justify-center">
            <button id="new-session-btn" class="btn-primary">
                New Practice Session
            </button>
            <button id="same-exercises-btn" class="btn-primary">
                Retry These Exercises
            </button>
            ${state.isLoggedIn ? '<button id="view-progress-btn" class="btn-primary">View Your Progress</button>' : ''}
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
        type: 'bar',
        data: {
            labels: ['Perfect', 'With Hints', 'With Mistakes'],
            datasets: [{
                data: [perfectCount, withHintsCount, withMistakesCount],
                backgroundColor: [
                    '#22C55E',  // Green for perfect
                    '#3B82F6',  // Blue for hints
                    '#EF4444'   // Red for mistakes
                ],
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: false,
                    text: 'Session Performance'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

export function resetForNewSession() {
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
    dom.loadingSpinner.classList.add('hidden');
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
    }

    // Re-enable the generate button
    dom.generateBtn.disabled = false;

    // Automatically fetch new exercises
    fetchExercises();
}

export function resetForSameExercises() {
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
    dom.loadingSpinner.classList.add('hidden');
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
    }

    // Re-enable the generate button
    dom.generateBtn.disabled = false;

    _renderExercise();
}

export async function saveUserStats() {
    try {
        await saveUserStatsAPI({
            total_exercises: state.exercises.length,
            total_mistakes: state.mistakes,
            total_hints: state.hintsUsed,
            total_time: state.sessionTime,
        });

        // Save per-exercise completion data — only exercises actually finished by the user
        const completions = [];
        state.completedExerciseIds.forEach((exerciseId) => {
            const perf = state.exercisePerformance.get(exerciseId) || { hints: 0, mistakes: 0 };
            completions.push({
                exercise_id: exerciseId,
                hints_used: perf.hints,
                mistakes: perf.mistakes
            });
        });
        await saveExerciseCompletionsAPI(completions);
    } catch (error) {
        console.error('Error saving user stats:', error);
    }
}
