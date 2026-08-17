import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadTopics, TOPICS_CACHE_KEY } from '../topics.js';
import { state } from '../state.js';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
    fetchTopicsAPI: vi.fn(),
    createTopicAPI: vi.fn(),
    deleteTopicAPI: vi.fn(),
    updateTopicAPI: vi.fn(),
    moveTopicAPI: vi.fn(),
    fetchVersionsAPI: vi.fn(),
    restoreVersionAPI: vi.fn(),
    fetchLastGenerationDebugAPI: vi.fn(),
    fetchLastRefinedPromptAPI: vi.fn(),
    saveUserSettingsAPI: vi.fn()
}));

const payload = { topics: [{ id: 't1', name: 'Weil', parent_id: null }] };

describe('topics.js offline fallback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        state.topics = [];
        globalThis.alert.mockClear();
    });

    it('caches the topics payload after a successful load', async () => {
        api.fetchTopicsAPI.mockResolvedValueOnce(payload);

        await loadTopics();

        expect(state.topics).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem(TOPICS_CACHE_KEY))).toEqual(payload);
    });

    it('falls back to the cached payload when the request fails', async () => {
        localStorage.setItem(TOPICS_CACHE_KEY, JSON.stringify(payload));
        api.fetchTopicsAPI.mockRejectedValueOnce(new Error('Failed to fetch'));

        await loadTopics();

        expect(state.topics.map(t => t.id)).toEqual(['t1']);
        expect(globalThis.alert).not.toHaveBeenCalled();
    });

    it('alerts only when there is no cached payload', async () => {
        api.fetchTopicsAPI.mockRejectedValueOnce(new Error('Failed to fetch'));

        await loadTopics();

        expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to load topics'));
    });
});
