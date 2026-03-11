import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fetchExercises, saveUserStats } from '../session.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
    fetchExercisesFromAPI: vi.fn(),
    saveUserStatsAPI: vi.fn(),
    saveExerciseCompletionsAPI: vi.fn()
}));

// Mock exercise methods called by fetchExercises
vi.mock('../exercise.js', () => ({
    renderExercise: vi.fn(),
    initExercise: vi.fn()
}));

describe('session.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset state
        state.currentTopicId = 't1';
        state.exercises = [];
        state.exerciseIds = [];
        state.currentExerciseIndex = 0;
        state.mistakes = 0;
        state.hintsUsed = 0;
        state.sessionTime = 0;
        state.isSessionComplete = false;
        state.exercisesWithMistakes = new Set();
        state.exerciseMistakes = {};
        state.exercisesWithHints = new Set();
        state.exercisePerformance = new Map();
        state.completedExerciseIds = new Set();
        state.timerInterval = null;

        // Setup mock DOM elements that fetchExercises touches
        dom.loadingSpinner.classList.remove = vi.fn();
        dom.loadingSpinner.classList.add = vi.fn();
        dom.exerciseContent.classList.add = vi.fn();
        dom.generateBtn.disabled = false;
        dom.timer.textContent = '';

        globalThis.alert.mockClear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('fetchExercises', () => {
        it('maps API response to state.exercises correctly and initializes state', async () => {
            const mockData = {
                exercises: [
                    {
                        id: 'ex1',
                        audio_file_path: '/audio1.mp3',
                        is_favorite: true,
                        exercise_json: { correct_german_sentence: 'S1' }
                    },
                    {
                        id: 'ex2',
                        audio_file_path: '/audio2.mp3',
                        is_favorite: false,
                        exercise_json: { correct_german_sentence: 'S2' }
                    }
                ]
            };

            api.fetchExercisesFromAPI.mockResolvedValueOnce(mockData);

            await fetchExercises();

            expect(state.exercises.length).toBe(2);
            expect(state.exercises[0]).toEqual({
                id: 'ex1',
                correct_german_sentence: 'S1',
                audio_file_path: '/audio1.mp3',
                is_favorite: true
            });
            expect(state.exerciseIds).toEqual(['ex1', 'ex2']);
            expect(state.exercisePerformance.get('ex1')).toEqual({ hints: 0, mistakes: 0 });
            expect(dom.loadingSpinner.classList.remove).toHaveBeenCalledWith('hidden');
        });

        it('handles empty exercises array safely', async () => {
            api.fetchExercisesFromAPI.mockResolvedValueOnce({ exercises: [] });

            await fetchExercises();

            expect(state.exercises.length).toBe(0);
            expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('No exercises could be retrieved'));
        });

        it('handles 429 error appropriately', async () => {
            const error = new Error('Rate limit');
            error.status = 429;
            error.message = 'Rate limit';
            api.fetchExercisesFromAPI.mockRejectedValueOnce(error);

            await fetchExercises();

            expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('Rate Limit Exceeded'));
            expect(dom.loadingSpinner.classList.add).toHaveBeenCalledWith('hidden');
        });

        it('handles 504 / UPSTREAM_TIMEOUT error appropriately', async () => {
            const error = new Error('Timeout');
            error.status = 504;
            api.fetchExercisesFromAPI.mockRejectedValueOnce(error);

            await fetchExercises();

            expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('The AI provider took too long'));
        });

        it('handles generic errors', async () => {
            const error = new Error('Generic error');
            error.retryable = true;
            api.fetchExercisesFromAPI.mockRejectedValueOnce(error);

            await fetchExercises();

            expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch new exercises'));
            expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('You can retry this request'));
        });
    });

    describe('saveUserStats', () => {
        it('saves general stats and individual completion stats', async () => {
            state.exercises = [{}, {}];
            state.mistakes = 2;
            state.hintsUsed = 1;
            state.sessionTime = 45;

            state.completedExerciseIds.add('ex1');
            state.completedExerciseIds.add('ex2');

            state.exercisePerformance.set('ex1', { hints: 1, mistakes: 0 });
            state.exercisePerformance.set('ex2', { hints: 0, mistakes: 2 });

            await saveUserStats();

            expect(api.saveUserStatsAPI).toHaveBeenCalledWith({
                total_exercises: 2,
                total_mistakes: 2,
                total_hints: 1,
                total_time: 45
            });

            expect(api.saveExerciseCompletionsAPI).toHaveBeenCalledWith([
                { exercise_id: 'ex1', hints_used: 1, mistakes: 0 },
                { exercise_id: 'ex2', hints_used: 0, mistakes: 2 }
            ]);
        });
    });
});
