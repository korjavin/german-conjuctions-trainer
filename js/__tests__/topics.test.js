import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    loadTopics,
    TOPICS_CACHE_KEY,
    renderTopicsList,
    rowActions,
    runRowAction,
    buildTopicTree,
    getArchivedTopicIds,
    getPracticeTopics,
    validateTopicName,
    validateTopicPrompt,
    setExerciseCounts,
    fmtDate,
} from '../topics.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import * as api from '../api.js';
import { toast, confirm } from '../ui.js';

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
    saveUserSettingsAPI: vi.fn()
}));

const payload = { topics: [{ id: 't1', name: 'Weil', parent_id: null }] };

const item = (id) => dom.topicsList.querySelector(`[role="treeitem"][data-topic-id="${id}"]`);
const rows = () => [...dom.topicsList.querySelectorAll('[role="treeitem"]')].map(el => el.dataset.topicId);

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.matchMedia = vi.fn(() => ({ matches: false })); // desktop pointer: drag-drop on
    dom.topicsList = document.createElement('div');
    state.topicsSearchQuery = '';
    state.topicSortOrder = 'tree';
    state.collapsedTopicIds.clear();
});

describe('topics.js offline fallback', () => {
    beforeEach(() => {
        state.topics = [];
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
        expect(toast).not.toHaveBeenCalled();
    });

    it('toasts only when there is no cached payload', async () => {
        api.fetchTopicsAPI.mockRejectedValueOnce(new Error('Failed to fetch'));

        await loadTopics();

        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', text: expect.stringContaining('Failed to load topics') }));
    });
});

describe('topic validation', () => {
    beforeEach(() => {
        state.topics = [{ id: 'a', name: 'Weil', parent_id: null }, { id: 'b', name: 'Dass', parent_id: 'a' }];
        state.editingTopicId = null;
    });

    it('rejects empty, too long and duplicate-at-the-same-level names', () => {
        expect(validateTopicName('  ')).toMatch(/required/);
        expect(validateTopicName('x'.repeat(201))).toMatch(/less than 200/);
        expect(validateTopicName('weil')).toMatch(/already exists/);
        expect(validateTopicName('Dass')).toBeNull(); // other level
        expect(validateTopicName('Dass', 'a')).toMatch(/already exists/);
    });

    it('does not flag the edited topic as its own duplicate', () => {
        state.editingTopicId = 'a';
        expect(validateTopicName('Weil')).toBeNull();
        state.editingTopicId = null;
    });

    it('requires a prompt of 10..10000 characters', () => {
        expect(validateTopicPrompt('')).toMatch(/required/);
        expect(validateTopicPrompt('too short')).toMatch(/at least 10/);
        expect(validateTopicPrompt('x'.repeat(10001))).toMatch(/less than 10000/);
        expect(validateTopicPrompt('Generate B1 sentences with weil.')).toBeNull();
    });
});

describe('topic tree', () => {
    const tree = [
        { id: 'p', name: 'Parent', parent_id: null, sort_order: 0, created_at: '2026-01-02T00:00:00Z' },
        { id: 'c2', name: 'B child', parent_id: 'p', sort_order: 1 },
        { id: 'c1', name: 'Z child', parent_id: 'p', sort_order: 0 },
        { id: 'g', name: 'Grandchild', parent_id: 'c1', sort_order: 0 },
        { id: 'a', name: 'Another root', parent_id: null, sort_order: 1, created_at: '2026-01-01T00:00:00Z' },
    ];

    beforeEach(() => {
        state.topics = tree;
    });

    it('sorts roots by the chosen order and children always by sort_order', () => {
        expect(buildTopicTree(tree, 'tree').roots.map(n => n.id)).toEqual(['p', 'a']);
        const byName = buildTopicTree(tree, 'name-asc');
        expect(byName.roots.map(n => n.id)).toEqual(['a', 'p']);
        expect(byName.nodesById.get('p').children.map(n => n.id)).toEqual(['c1', 'c2']);
        expect(buildTopicTree(tree, 'date-oldest').roots.map(n => n.id)).toEqual(['a', 'p']);
    });

    it('hides descendants of a collapsed topic instead of leaking them as roots', () => {
        state.collapsedTopicIds.add('p');
        renderTopicsList();
        expect(rows()).toEqual(['p', 'a']);
    });

    it('renders folders with a child count and chevron, leaves without', () => {
        renderTopicsList();
        expect(rows()).toEqual(['p', 'c1', 'g', 'c2', 'a']);
        expect(item('p').getAttribute('aria-expanded')).toBe('true');
        expect(item('p').querySelector('.gct-manage__count').textContent).toBe('2');
        expect(item('g').hasAttribute('aria-expanded')).toBe(false);
        expect(item('g').querySelector('.gct-manage__count')).toBeNull();
        expect(item('g').getAttribute('aria-level')).toBe('3');
    });

    it('search shows matches with their ancestors, highlighted', () => {
        state.collapsedTopicIds.add('p');
        state.topicsSearchQuery = 'grand';
        renderTopicsList();
        expect(rows()).toEqual(['p', 'c1', 'g']);
        expect(item('g').querySelector('mark').textContent).toBe('Grand');
        state.topicsSearchQuery = '';
        renderTopicsList();
        expect(rows()).toEqual(['p', 'a']); // pre-search collapse state is back
    });

    it('search highlight never splits an escaped entity', () => {
        state.topics = tree.map(t => (t.id === 'g' ? { ...t, name: `Grand's 3 <b>` } : t));
        state.topicsSearchQuery = '3';
        renderTopicsList();
        const name = item('g').querySelector('.gct-manage__name');
        expect(name.textContent).toBe(`Grand's 3 <b>`);
        expect(name.querySelector('mark').textContent).toBe('3');
        state.topicsSearchQuery = '';
        renderTopicsList();
    });

    it('row click on a folder toggles it', () => {
        renderTopicsList();
        item('c1').click();
        expect(state.collapsedTopicIds.has('c1')).toBe(true);
        expect(rows()).toEqual(['p', 'c1', 'c2', 'a']);
    });

    it('keyboard: arrows move focus, Left collapses an expanded folder', () => {
        document.body.append(dom.topicsList);
        renderTopicsList();
        item('p').focus();
        item('p').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement).toBe(item('c1'));
        item('c1').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(state.collapsedTopicIds.has('c1')).toBe(true);
        expect(document.activeElement).toBe(item('c1'));
        dom.topicsList.remove();
    });
});

describe('topic archive and row actions', () => {
    const tree = [
        { id: 'archive', name: 'Archive', parent_id: null, sort_order: 0, is_archive: true },
        { id: 'p', name: 'Parent', parent_id: null, sort_order: 1 },
        { id: 'c', name: 'Child', parent_id: 'p', sort_order: 0 },
        { id: 'old', name: 'Old', parent_id: 'archive', sort_order: 0 },
        { id: 'old-leaf', name: 'Old leaf', parent_id: 'old', sort_order: 0 },
    ];

    beforeEach(() => {
        state.topics = tree;
        renderTopicsList();
    });

    it('collects the archive root and its whole subtree', () => {
        expect([...getArchivedTopicIds(tree)].sort()).toEqual(['archive', 'old', 'old-leaf']);
        expect(getPracticeTopics(tree).map(t => t.id)).toEqual(['p', 'c']);
    });

    it('lists the archive last, muted, without drag or menu', () => {
        expect(rows()).toEqual(['p', 'c', 'archive', 'old', 'old-leaf']);
        expect(item('archive').draggable).toBe(false);
        expect(item('archive').querySelector('.gct-row-more')).toBeNull();
        expect(item('old').classList.contains('is-archived')).toBe(true);
        expect(item('p').draggable).toBe(true);
    });

    it('offers Archive, Restore or neither depending on where the topic sits', () => {
        const names = (id) => rowActions(id).map(([action]) => action);
        expect(names('archive')).toEqual([]);
        expect(names('p')).toEqual(['add', 'rename', 'archive', 'delete']);
        expect(names('old')).toEqual(['add', 'rename', 'unarchive', 'delete']);
        expect(names('old-leaf')).toEqual(['add', 'rename', 'delete']);
    });

    it('archiving from the row menu reloads topics and announces topicschange', async () => {
        const changed = vi.fn();
        window.addEventListener('topicschange', changed);
        api.archiveTopicAPI.mockResolvedValueOnce({});
        api.fetchTopicsAPI.mockResolvedValueOnce({ topics: tree });

        item('p').querySelector('.gct-row-more').click();
        const menuItem = item('p').querySelector('[role="menu"] [data-action="archive"]');
        expect(menuItem).not.toBeNull();
        menuItem.click();
        await vi.waitFor(() => expect(changed).toHaveBeenCalled());
        window.removeEventListener('topicschange', changed);

        expect(api.archiveTopicAPI).toHaveBeenCalledWith('p');
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ text: 'Moved to Archive' }));
    });

    it('delete asks with Archive instead and the practice-record count', async () => {
        setExerciseCounts([{ topic_id: 'c', count: 12 }]);
        confirm.mockResolvedValueOnce('delete');
        api.deleteTopicAPI.mockResolvedValueOnce();
        api.fetchTopicsAPI.mockResolvedValueOnce({ topics: tree });

        runRowAction('delete', 'c');
        await vi.waitFor(() => expect(api.deleteTopicAPI).toHaveBeenCalledWith('c'));

        const opts = confirm.mock.calls[0][0];
        expect(opts.title).toBe('Delete this topic?');
        expect(opts.body).toContain('12 practice records');
        expect(opts.actions.map(a => a.label)).toEqual(['Delete topic', 'Archive instead', 'Cancel']);
        await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ text: 'Topic deleted' })));
    });

    it('"Archive instead" archives rather than deletes', async () => {
        confirm.mockResolvedValueOnce('archive');
        api.archiveTopicAPI.mockResolvedValueOnce({});
        api.fetchTopicsAPI.mockResolvedValueOnce({ topics: tree });

        runRowAction('delete', 'c');
        await vi.waitFor(() => expect(api.archiveTopicAPI).toHaveBeenCalledWith('c'));
        expect(api.deleteTopicAPI).not.toHaveBeenCalled();
    });

    it('a 409 (has sub-topics) explains what to do', async () => {
        confirm.mockResolvedValueOnce('delete');
        api.deleteTopicAPI.mockRejectedValueOnce(Object.assign(new Error('Topic has children'), { status: 409 }));

        runRowAction('delete', 'p');
        await vi.waitFor(() => expect(toast).toHaveBeenCalledWith({ tone: 'danger', text: 'Delete its sub-topics first, or archive it.' }));
    });

    it('cancel does nothing', async () => {
        confirm.mockResolvedValueOnce(null);
        runRowAction('delete', 'c');
        await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
        await Promise.resolve();
        expect(api.deleteTopicAPI).not.toHaveBeenCalled();
        expect(api.archiveTopicAPI).not.toHaveBeenCalled();
    });
});

describe('fmtDate', () => {
    it('formats DD.MM.YYYY and tolerates bad input', () => {
        expect(fmtDate(new Date(2026, 9, 9))).toBe('09.10.2026');
        expect(fmtDate('nope')).toBe('');
    });
});
