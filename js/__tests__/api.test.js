import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    fetchTopicsAPI,
    fetchExercisesFromAPI,
    moveTopicAPI,
    fetchExplainAPI,
    loadExerciseHistoryAPI
} from '../api.js';

describe('api.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('apiFetch (indirectly via fetchExercisesFromAPI)', () => {
        it('throws JSON error with message, details, code, and retryable flag', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({
                    error: {
                        message: 'Custom Error',
                        details: 'Extra Info',
                        code: 'ERR_1',
                        retryable: true
                    }
                })
            });

            try {
                await fetchExercisesFromAPI('topic1');
                expect.unreachable('Should have thrown');
            } catch (err) {
                expect(err.message).toContain('Custom Error');
                expect(err.message).toContain('Details: Extra Info');
                expect(err.code).toBe('ERR_1');
                expect(err.retryable).toBe(true);
                expect(err.status).toBe(400);
            }
        });

        it('throws plain text error if not JSON', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                headers: new Headers({ 'content-type': 'text/plain' }),
                text: async () => 'Plain text error'
            });

            try {
                await fetchExercisesFromAPI('topic1');
                expect.unreachable('Should have thrown');
            } catch (err) {
                expect(err.message).toBe('Plain text error');
                expect(err.status).toBe(500);
            }
        });

        it('falls back to status text if no content', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                status: 502,
                statusText: 'Bad Gateway',
                headers: new Headers(),
                text: async () => ''
            });

            try {
                await fetchExercisesFromAPI('topic1');
                expect.unreachable('Should have thrown');
            } catch (err) {
                expect(err.message).toBe('502 Bad Gateway');
            }
        });
    });

    describe('fetchTopicsAPI', () => {
        it('returns JSON on success', async () => {
            const mockData = [{ id: '1', name: 'Topic 1' }];
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockData
            });

            const result = await fetchTopicsAPI();
            expect(result).toEqual(mockData);
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/topics');
        });

        it('throws text error on failure', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                text: async () => 'Failed to fetch topics error'
            });

            await expect(fetchTopicsAPI()).rejects.toThrow('Failed to fetch topics error');
        });
    });

    describe('fetchExercisesFromAPI', () => {
        it('returns JSON on success', async () => {
            const mockData = { exercises: [] };
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockData
            });

            const result = await fetchExercisesFromAPI('topic_123');
            expect(result).toEqual(mockData);
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/exercises', expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ topic_id: 'topic_123' })
            }));
        });
    });

    describe('moveTopicAPI', () => {
        it('throws Invalid position for negative position', async () => {
            await expect(moveTopicAPI('t1', 'p1', -1)).rejects.toThrow('Invalid position: must be non-negative');
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('sends valid payload and returns json on success', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true })
            });

            const result = await moveTopicAPI('t1', 'p1', 5);
            expect(result).toEqual({ success: true });
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/topics/t1/move', expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ parent_id: 'p1', position: 5 })
            }));
        });
    });

    describe('fetchExplainAPI', () => {
        it('returns JSON on success', async () => {
            const mockData = { explanation: 'This is why' };
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockData
            });

            const result = await fetchExplainAPI('grammar', 'Correct sentence', ['mistake']);
            expect(result).toEqual(mockData);
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/explain', expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    topic: 'grammar',
                    correct_sentence: 'Correct sentence',
                    mistakes: ['mistake']
                })
            }));
        });

        it('throws "Failed to load explanation" on failure', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false
            });

            await expect(fetchExplainAPI('topic', 'correct', [])).rejects.toThrow('Failed to load explanation');
        });
    });

    describe('loadExerciseHistoryAPI', () => {
        it('appends topic_id query parameter when provided', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ history: [] })
            });

            const result = await loadExerciseHistoryAPI('t123');
            expect(result).toEqual({ history: [] });
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/exercises/history?topic_id=t123');
        });

        it('does not append query parameter when no topic_id provided', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ history: [] })
            });

            await loadExerciseHistoryAPI();
            expect(globalThis.fetch).toHaveBeenCalledWith('/api/exercises/history');
        });
    });
});
