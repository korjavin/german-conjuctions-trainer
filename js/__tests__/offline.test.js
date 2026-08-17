import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    OFFLINE_STASH_KEY,
    OFFLINE_QUEUE_KEY,
    flattenExercise,
    readStash,
    writeStash,
    takeStashedExercises,
    readQueue,
    enqueueBatch,
    makeBatch,
    sendBatch,
    flushOfflineQueue,
    updateOfflineCache,
} from '../offline.js';
import { state } from '../state.js';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
    fetchExercisesFromAPI: vi.fn(),
    saveUserStatsAPI: vi.fn(),
    saveExerciseCompletionsAPI: vi.fn(),
    fetchTTSFilePathAPI: vi.fn(async () => '')
}));

function setOnline(isOnline) {
    Object.defineProperty(navigator, 'onLine', { value: isOnline, configurable: true });
}

function stashRow(id, topicId = 't1') {
    return { id, topic_id: topicId, correct_german_sentence: `Satz ${id}` };
}

describe('offline.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        setOnline(true);
        state.currentTopicId = 't1';
        state.recentlyUsedTopics = [];
        state.isAudioEnabled = false; // keeps preloadExerciseWordAudio a no-op
        globalThis.fetch = vi.fn(async () => ({ ok: true }));
    });

    afterEach(() => {
        setOnline(true);
    });

    describe('flattenExercise', () => {
        it('merges exercise_json with the row metadata', () => {
            const flat = flattenExercise({
                id: 'ex1',
                topic_id: 't1',
                audio_file_path: '/audio_cache/a.mp3',
                exercise_json: { correct_german_sentence: 'Hallo', scrambled_words: ['Hallo'] }
            });

            expect(flat).toEqual({
                correct_german_sentence: 'Hallo',
                scrambled_words: ['Hallo'],
                id: 'ex1',
                audio_file_path: '/audio_cache/a.mp3',
                is_favorite: false,
                topic_id: 't1',
                repetition_counter: 0
            });
        });
    });

    describe('stash', () => {
        it('round-trips exercises through localStorage', () => {
            writeStash([stashRow('a'), stashRow('b')], 1234);
            const stash = readStash();
            expect(stash.updatedAt).toBe(1234);
            expect(stash.exercises.map(e => e.id)).toEqual(['a', 'b']);
        });

        it('returns an empty stash for corrupt storage', () => {
            localStorage.setItem(OFFLINE_STASH_KEY, 'not json');
            expect(readStash()).toEqual({ updatedAt: 0, exercises: [] });
        });

        it('takes exercises for the requested topic and removes them from the stash', () => {
            writeStash([stashRow('a', 't1'), stashRow('b', 't2'), stashRow('c', 't1')]);

            const taken = takeStashedExercises(10, 't1');

            expect(taken.map(e => e.id)).toEqual(['a', 'c']);
            expect(readStash().exercises.map(e => e.id)).toEqual(['b']);
        });

        it('falls back to any topic when the requested topic has nothing stashed', () => {
            writeStash([stashRow('a', 't2'), stashRow('b', 't3')]);

            const taken = takeStashedExercises(1, 't1');

            expect(taken.map(e => e.id)).toEqual(['a']);
            expect(readStash().exercises.map(e => e.id)).toEqual(['b']);
        });

        it('returns nothing when the stash is empty', () => {
            expect(takeStashedExercises(10, 't1')).toEqual([]);
        });
    });

    describe('sendBatch', () => {
        it('sends stats and completions with the batch id as idempotency key', async () => {
            const batch = makeBatch({ total_exercises: 2 }, [{ exercise_id: 'ex1', hints_used: 0, mistakes: 0 }]);

            await expect(sendBatch(batch)).resolves.toBe(true);

            expect(api.saveUserStatsAPI).toHaveBeenCalledWith({ total_exercises: 2 });
            expect(api.saveExerciseCompletionsAPI).toHaveBeenCalledWith(batch.completions, batch.id);
            expect(batch.id).toBeTruthy();
        });

        it('keeps the stats payload when the stats POST fails', async () => {
            api.saveUserStatsAPI.mockRejectedValueOnce(new Error('offline'));
            const batch = makeBatch({ total_exercises: 1 }, []);

            await expect(sendBatch(batch)).resolves.toBe(false);

            expect(batch.stats).toEqual({ total_exercises: 1 });
            expect(api.saveExerciseCompletionsAPI).not.toHaveBeenCalled();
        });

        it('clears the already-delivered stats so a retry cannot double-count them', async () => {
            api.saveExerciseCompletionsAPI.mockRejectedValueOnce(new Error('offline'));
            const batch = makeBatch({ total_exercises: 1 }, [{ exercise_id: 'ex1', hints_used: 0, mistakes: 0 }]);

            await expect(sendBatch(batch)).resolves.toBe(false);

            expect(batch.stats).toBeNull();
            expect(batch.completions).toHaveLength(1);
        });
    });

    describe('queue', () => {
        it('appends batches and drains them on flush', async () => {
            const batch = makeBatch({ total_exercises: 1 }, [{ exercise_id: 'ex1', hints_used: 0, mistakes: 0 }]);
            enqueueBatch(batch);
            expect(readQueue()).toHaveLength(1);

            await flushOfflineQueue();

            expect(api.saveUserStatsAPI).toHaveBeenCalledTimes(1);
            expect(api.saveExerciseCompletionsAPI).toHaveBeenCalledWith(batch.completions, batch.id);
            expect(readQueue()).toHaveLength(0);
        });

        it('keeps batches queued when the send fails', async () => {
            api.saveUserStatsAPI.mockRejectedValueOnce(new Error('offline'));
            enqueueBatch(makeBatch({ total_exercises: 1 }, []));

            await flushOfflineQueue();

            expect(readQueue()).toHaveLength(1);
        });

        it('reuses the same client_batch_id across retries', async () => {
            api.saveExerciseCompletionsAPI.mockRejectedValueOnce(new Error('offline'));
            const batch = makeBatch(null, [{ exercise_id: 'ex1', hints_used: 0, mistakes: 0 }]);
            enqueueBatch(batch);

            await flushOfflineQueue();
            expect(readQueue()).toHaveLength(1);

            await flushOfflineQueue();

            expect(readQueue()).toHaveLength(0);
            const ids = api.saveExerciseCompletionsAPI.mock.calls.map(call => call[1]);
            expect(ids).toEqual([batch.id, batch.id]);
        });

        it('does nothing while offline', async () => {
            setOnline(false);
            enqueueBatch(makeBatch({ total_exercises: 1 }, []));

            await flushOfflineQueue();

            expect(api.saveUserStatsAPI).not.toHaveBeenCalled();
            expect(readQueue()).toHaveLength(1);
        });

        it('ignores corrupt queue storage', () => {
            localStorage.setItem(OFFLINE_QUEUE_KEY, '{oops');
            expect(readQueue()).toEqual([]);
        });
    });

    describe('updateOfflineCache', () => {
        const row = (id, topicId) => ({ id, topic_id: topicId, audio_file_path: '', exercise_json: {} });

        it('stashes the selected topic plus recent topics, deduped by id', async () => {
            state.recentlyUsedTopics = [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }];
            api.fetchExercisesFromAPI
                .mockResolvedValueOnce({ exercises: [row('a', 't1'), row('b', 't1')] })
                .mockResolvedValueOnce({ exercises: [row('b', 't1'), row('c', 't2')] });

            await updateOfflineCache();

            expect(api.fetchExercisesFromAPI).toHaveBeenNthCalledWith(1, 't1', { limit: 200 });
            expect(api.fetchExercisesFromAPI).toHaveBeenNthCalledWith(2, 't2', { limit: 50, skip_generation: true });
            expect(readStash().exercises.map(e => e.id)).toEqual(['a', 'b', 'c']);
        });

        it('replaces the stash on a second run and survives a failing topic', async () => {
            api.fetchExercisesFromAPI.mockResolvedValueOnce({ exercises: [row('a', 't1')] });
            await updateOfflineCache();
            expect(readStash().exercises.map(e => e.id)).toEqual(['a']);

            api.fetchExercisesFromAPI.mockResolvedValueOnce({ exercises: [row('z', 't1')] });
            await updateOfflineCache();
            expect(readStash().exercises.map(e => e.id)).toEqual(['z']);

            api.fetchExercisesFromAPI.mockRejectedValueOnce(new Error('boom'));
            await expect(updateOfflineCache()).resolves.toBeUndefined();
            expect(readStash().exercises).toEqual([]);
        });

        it('flushes queued results before fetching', async () => {
            enqueueBatch(makeBatch({ total_exercises: 1 }, []));
            api.fetchExercisesFromAPI.mockResolvedValueOnce({ exercises: [] });

            await updateOfflineCache();

            expect(api.saveUserStatsAPI).toHaveBeenCalledTimes(1);
            expect(readQueue()).toHaveLength(0);
        });
    });
});
