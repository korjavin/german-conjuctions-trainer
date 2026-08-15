import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fetchExercises, saveUserStats } from '../session.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import * as api from '../api.js';
import { OFFLINE_STASH_KEY, readQueue } from '../offline.js';

vi.mock('../api.js', () => ({
    fetchExercisesFromAPI: vi.fn(),
    saveUserStatsAPI: vi.fn(),
    saveExerciseCompletionsAPI: vi.fn(),
    // session.js -> offline.js -> audio.js needs this export to exist
    fetchTTSFilePathAPI: vi.fn()
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
        localStorage.clear();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
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
                        topic_id: 'child-topic-123',
                        exercise_json: { correct_german_sentence: 'S1' }
                    },
                    {
                        id: 'ex2',
                        audio_file_path: '/audio2.mp3',
                        is_favorite: false,
                        topic_id: 'parent-topic-456',
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
                is_favorite: true,
                topic_id: 'child-topic-123',
                repetition_counter: 0
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

    describe('offline fallback', () => {
        const stashOne = () => localStorage.setItem(OFFLINE_STASH_KEY, JSON.stringify({
            updatedAt: 1,
            exercises: [{ id: 'stashed1', topic_id: 't1', correct_german_sentence: 'Hallo Welt' }]
        }));

        it('serves stashed exercises when the network fetch fails', async () => {
            stashOne();
            api.fetchExercisesFromAPI.mockRejectedValueOnce(new Error('Failed to fetch'));

            await fetchExercises();

            expect(state.exercises.map(e => e.id)).toEqual(['stashed1']);
            expect(globalThis.alert).not.toHaveBeenCalled();
            // Served exercises are consumed from the stash
            expect(JSON.parse(localStorage.getItem(OFFLINE_STASH_KEY)).exercises).toEqual([]);
        });

        it('skips the network entirely when navigator reports offline', async () => {
            stashOne();
            Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

            await fetchExercises();

            expect(api.fetchExercisesFromAPI).not.toHaveBeenCalled();
            expect(state.exercises.map(e => e.id)).toEqual(['stashed1']);
        });

        it('alerts with an offline-specific message when the stash is empty', async () => {
            Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

            await fetchExercises();

            expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('no exercises are cached'));
        });

        it('still reports the original error when online and the stash is empty', async () => {
            const error = new Error('Generic error');
            api.fetchExercisesFromAPI.mockRejectedValueOnce(error);

            await fetchExercises();

            expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch new exercises'));
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
            ], expect.any(String));
        });

        it('queues the session results instead of dropping them when the POST fails', async () => {
            state.exercises = [{}];
            state.completedExerciseIds.add('ex1');
            state.exercisePerformance.set('ex1', { hints: 0, mistakes: 1 });
            api.saveUserStatsAPI.mockRejectedValueOnce(new Error('offline'));

            await saveUserStats();

            const queue = readQueue();
            expect(queue).toHaveLength(1);
            expect(queue[0].id).toBeTruthy();
            expect(queue[0].stats.total_exercises).toBe(1);
            expect(queue[0].completions).toEqual([{ exercise_id: 'ex1', hints_used: 0, mistakes: 1 }]);
        });
    });
});
