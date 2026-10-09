import { describe, it, expect, beforeEach, vi } from 'vitest';
import { selectTab, loadDatabaseStats, loadObservability } from '../manage.js';
import { dom } from '../dom.js';
import * as api from '../api.js';
import { setExerciseCounts } from '../topics.js';

vi.mock('../api.js', () => ({
    fetchDatabaseStatsAPI: vi.fn(),
    createCLITokenAPI: vi.fn(),
    fetchLastGenerationDebugAPI: vi.fn(),
    fetchLastRefinedPromptAPI: vi.fn(),
}));
vi.mock('../topics.js', () => ({
    loadTopics: vi.fn(),
    initTopicsManager: vi.fn(),
    setExerciseCounts: vi.fn(),
    focusTopicsSearch: vi.fn(),
    fmtDateTime: vi.fn(() => '09.10.2026 07:48'),
}));
vi.mock('../router.js', () => ({ currentRoute: vi.fn(() => 'manage') }));

const ids = ['obsCaption', 'obsPrompt', 'dbStatsError', 'dbStatExercises', 'dbStatTopics', 'dbStatDbSize', 'dbStatAudioCache',
    'dbStatAudioFiles', 'dbStatsPerTopic', 'cliTokenResult', 'cliTokenError'];

beforeEach(() => {
    vi.clearAllMocks();
    for (const id of ids) dom[id] = document.createElement('div');
    dom.cliTokenValue = document.createElement('input');
});

describe('Manage tabs', () => {
    it('drops the one-time CLI token when leaving the CLI tab', () => {
        api.fetchDatabaseStatsAPI.mockResolvedValue({ exercises_per_topic: [] });
        dom.cliTokenResult.hidden = false;
        dom.cliTokenValue.value = 'secret-token';

        selectTab('db');

        expect(dom.cliTokenValue.value).toBe('');
        expect(dom.cliTokenResult.hidden).toBe(true);
    });
});

describe('Database tab', () => {
    it('renders the stat cards and feeds per-topic counts to the editor', async () => {
        const perTopic = [{ topic_id: 't1', topic_name: '<b>Weil</b>', count: 1234 }];
        api.fetchDatabaseStatsAPI.mockResolvedValueOnce({
            total_topics: 162, total_exercises: 4812, database_size_mb: 12.345,
            audio_cache_size_mb: 80, audio_cache_file_count: 2140, exercises_per_topic: perTopic,
        });

        await loadDatabaseStats();

        expect(dom.dbStatDbSize.textContent).toBe('12.3 MB');
        expect(dom.dbStatAudioCache.textContent).toBe('80.0 MB');
        expect(dom.dbStatsPerTopic.textContent).toContain('<b>Weil</b>'); // names are text, never HTML
        expect(setExerciseCounts).toHaveBeenCalledWith(perTopic);
    });

    it('shows an error when the stats request fails', async () => {
        api.fetchDatabaseStatsAPI.mockRejectedValueOnce(new Error('boom'));
        await loadDatabaseStats();
        expect(dom.dbStatsError.hidden).toBe(false);
    });
});

describe('Observability tab', () => {
    it('shows the last prompt with its time and a debug summary', async () => {
        api.fetchLastGenerationDebugAPI.mockResolvedValueOnce({ prompt: 'system: write B1', model_name: 'm1', generated_at: '2026-10-09T07:48:00Z' });
        await loadObservability();
        expect(dom.obsCaption.textContent).toBe('Last refined prompt · 09.10.2026 07:48');
        expect(dom.obsPrompt.textContent).toContain('system: write B1');
        expect(dom.obsPrompt.textContent).toContain('Model: m1');
    });

    it('falls back to the legacy endpoint', async () => {
        api.fetchLastGenerationDebugAPI.mockResolvedValueOnce(null);
        api.fetchLastRefinedPromptAPI.mockResolvedValueOnce({ last_refined_prompt: 'legacy prompt' });
        await loadObservability();
        expect(dom.obsPrompt.textContent).toBe('legacy prompt');
    });
});
