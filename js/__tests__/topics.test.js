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
    archiveTopicAPI: vi.fn(),
    unarchiveTopicAPI: vi.fn(),
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

describe('topic tree collapse', () => {
    const tree = [
        { id: 'p', name: 'Parent', parent_id: null, sort_order: 0 },
        { id: 'c', name: 'Child', parent_id: 'p', sort_order: 0 },
        { id: 'g', name: 'Grandchild', parent_id: 'c', sort_order: 0 },
    ];

    beforeEach(async () => {
        localStorage.clear();
        const dom = (await import('../dom.js')).dom;
        dom.topicsList = document.createElement('div');
        dom.topicDropdown = document.createElement('div');
        dom.topicSearch = document.createElement('input');
        state.topics = tree;
        state.topicsSearchQuery = '';
        state.collapsedTopicIds.clear();
        const { resetDropdownCollapseState } = await import('../topics.js');
        resetDropdownCollapseState();
    });

    it('settings tree hides descendants of a collapsed topic instead of leaking them as roots', async () => {
        const { renderTopicsList } = await import('../topics.js');
        const dom = (await import('../dom.js')).dom;
        state.collapsedTopicIds.add('p');

        renderTopicsList();

        expect(dom.topicsList.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    });

    it('dropdown collapse keeps the tree when the input holds the canonical path', async () => {
        const { renderTopicDropdown } = await import('../topics.js');
        const dom = (await import('../dom.js')).dom;
        dom.topicSearch.value = 'Parent > Child > Grandchild';

        renderTopicDropdown('');
        dom.topicDropdown.querySelector('.topic-dropdown-collapse-btn').click();

        const items = dom.topicDropdown.querySelectorAll('.topic-dropdown-tree-item');
        expect(items).toHaveLength(1);
        expect(dom.topicDropdown.textContent).not.toContain('No topics found');
        expect(JSON.parse(localStorage.getItem('dropdownTopicCollapseState'))).toHaveLength(1);
    });
});

describe('topic archive', () => {
    const tree = [
        { id: 'archive', name: 'Archive', parent_id: null, sort_order: 0, is_archive: true },
        { id: 'p', name: 'Parent', parent_id: null, sort_order: 1 },
        { id: 'c', name: 'Child', parent_id: 'p', sort_order: 0 },
        { id: 'old', name: 'Old', parent_id: 'archive', sort_order: 0 },
        { id: 'old-leaf', name: 'Old leaf', parent_id: 'old', sort_order: 0 },
    ];

    beforeEach(async () => {
        vi.clearAllMocks();
        localStorage.clear();
        const dom = (await import('../dom.js')).dom;
        dom.topicsList = document.createElement('div');
        dom.topicDropdown = document.createElement('div');
        dom.topicSearch = document.createElement('input');
        state.topics = tree;
        state.topicsSearchQuery = '';
        state.collapsedTopicIds.clear();
        const { resetDropdownCollapseState } = await import('../topics.js');
        resetDropdownCollapseState();
    });

    it('collects the archive root and its whole subtree', async () => {
        const { getArchivedTopicIds, getPracticeTopics } = await import('../topics.js');
        expect([...getArchivedTopicIds(tree)].sort()).toEqual(['archive', 'old', 'old-leaf']);
        expect(getPracticeTopics(tree).map(t => t.id)).toEqual(['p', 'c']);
    });

    it('keeps archived topics out of the practice dropdown', async () => {
        const { renderTopicDropdown } = await import('../topics.js');
        const dom = (await import('../dom.js')).dom;

        renderTopicDropdown('');
        expect(dom.topicDropdown.textContent).toContain('Parent');
        expect(dom.topicDropdown.textContent).not.toContain('Archive');
        expect(dom.topicDropdown.textContent).not.toContain('Old');

        renderTopicDropdown('old');
        expect(dom.topicDropdown.textContent).toContain('No topics found');
    });

    it('shows the archive last in the settings tree with Archive/Restore buttons', async () => {
        const { renderTopicsList } = await import('../topics.js');
        const dom = (await import('../dom.js')).dom;

        renderTopicsList();
        const ids = [...dom.topicsList.querySelectorAll('[role="treeitem"]')].map(el => el.dataset.topicId);
        expect(ids).toEqual(['p', 'c', 'archive', 'old', 'old-leaf']);

        const item = id => dom.topicsList.querySelector(`[role="treeitem"][data-topic-id="${id}"]`);
        expect(item('archive').draggable).toBe(false);
        expect(item('archive').querySelector('button.delete-topic-btn')).toBeNull();
        expect(item('p').querySelector('.archive-topic-btn')).not.toBeNull();
        expect(item('old').querySelector('.unarchive-topic-btn')).not.toBeNull();
        expect(item('old-leaf').querySelector('.archive-topic-btn, .unarchive-topic-btn')).toBeNull();
    });

    it('archiving moves the current selection off the archived subtree', async () => {
        const { renderTopicsList } = await import('../topics.js');
        const dom = (await import('../dom.js')).dom;
        state.topics = tree.map(t => (t.id === 'old' ? { ...t, parent_id: null } : t));
        state.currentTopicId = 'old';
        localStorage.setItem('selectedTopicId', 'old');
        renderTopicsList();

        api.archiveTopicAPI.mockResolvedValueOnce({});
        api.fetchTopicsAPI.mockResolvedValueOnce({ topics: tree });
        item(dom, 'old').querySelector('.archive-topic-btn').click();
        await vi.waitFor(() => expect(state.currentTopicId).toBe('p'));

        expect(api.archiveTopicAPI).toHaveBeenCalledWith('old');
        expect(dom.topicSearch.value).toBe('Parent');
    });
});

function item(dom, id) {
    return dom.topicsList.querySelector(`[role="treeitem"][data-topic-id="${id}"]`);
}
