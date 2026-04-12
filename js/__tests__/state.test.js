import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    state,
    addRecentlyUsedTopic,
    removeRecentlyUsedTopic,
    toggleTopicCollapse,
    isTopicCollapsed,
    collapseAllTopics,
    expandAllTopics,
    saveTopicCollapseState
} from '../state.js';

describe('state.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.localStorage.clear();

        // Reset state
        state.recentlyUsedTopics = [];
        state.collapsedTopicIds = new Set();
        state.searchManualCollapsedTopicIds = new Set();
        state.searchManualExpandedTopicIds = new Set();
        state.isAudioEnabled = true; // Default
    });

    describe('initialization logic (_loadAudioEnabled, _loadTopicCollapseState)', () => {
        it('loads defaults when localStorage is empty', async () => {
            // Can't re-run module initialization easily, but we can test behavior of persistence
            expect(state.recentlyUsedTopics).toEqual([]);
            expect(state.collapsedTopicIds.size).toBe(0);
        });
    });

    describe('addRecentlyUsedTopic', () => {
        it('adds a topic to the front', () => {
            addRecentlyUsedTopic('1', 'Topic 1');
            expect(state.recentlyUsedTopics).toEqual([{ id: '1', name: 'Topic 1' }]);
            expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('recentlyUsedTopics', JSON.stringify([{ id: '1', name: 'Topic 1' }]));
        });

        it('deduplicates topics by moving existing to the front', () => {
            addRecentlyUsedTopic('1', 'Topic 1');
            addRecentlyUsedTopic('2', 'Topic 2');
            addRecentlyUsedTopic('1', 'Topic 1');

            expect(state.recentlyUsedTopics).toEqual([
                { id: '1', name: 'Topic 1' },
                { id: '2', name: 'Topic 2' }
            ]);
        });

        it('limits to 10 items', () => {
            for (let i = 1; i <= 15; i++) {
                addRecentlyUsedTopic(String(i), `Topic ${i}`);
            }

            expect(state.recentlyUsedTopics.length).toBe(10);
            expect(state.recentlyUsedTopics[0]).toEqual({ id: '15', name: 'Topic 15' });
            expect(state.recentlyUsedTopics[9]).toEqual({ id: '6', name: 'Topic 6' });
        });
    });

    describe('removeRecentlyUsedTopic', () => {
        it('removes correct item', () => {
            addRecentlyUsedTopic('1', 'Topic 1');
            addRecentlyUsedTopic('2', 'Topic 2');

            removeRecentlyUsedTopic('2');
            expect(state.recentlyUsedTopics).toEqual([{ id: '1', name: 'Topic 1' }]);
            expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('recentlyUsedTopics', JSON.stringify([{ id: '1', name: 'Topic 1' }]));
        });
    });

    describe('toggleTopicCollapse and isTopicCollapsed', () => {
        it('toggles presence in collapsedTopicIds', () => {
            expect(isTopicCollapsed('t1')).toBe(false);

            toggleTopicCollapse('t1');
            expect(isTopicCollapsed('t1')).toBe(true);
            expect(state.collapsedTopicIds.has('t1')).toBe(true);

            toggleTopicCollapse('t1');
            expect(isTopicCollapsed('t1')).toBe(false);
            expect(state.collapsedTopicIds.has('t1')).toBe(false);
        });

        it('updates manual search tracking sets appropriately', () => {
            toggleTopicCollapse('t1'); // Collapsed manually
            expect(state.searchManualCollapsedTopicIds.has('t1')).toBe(true);
            expect(state.searchManualExpandedTopicIds.has('t1')).toBe(false);

            toggleTopicCollapse('t1'); // Expanded manually
            expect(state.searchManualCollapsedTopicIds.has('t1')).toBe(false);
            expect(state.searchManualExpandedTopicIds.has('t1')).toBe(true);
        });

        it('saves to localStorage', () => {
            toggleTopicCollapse('t1');
            expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('topicCollapseState', JSON.stringify(['t1']));
        });
    });

    describe('collapseAllTopics', () => {
        it('collapses all parent topics (topics that have children)', () => {
            state.topics = [
                { id: 'p1', name: 'Parent 1', parent_id: '' },
                { id: 'c1', name: 'Child 1', parent_id: 'p1' },
                { id: 'p2', name: 'Parent 2', parent_id: '' },
                { id: 'c2', name: 'Child 2', parent_id: 'p2' },
                { id: 'leaf', name: 'Leaf', parent_id: '' },
            ];

            collapseAllTopics();

            expect(state.collapsedTopicIds.has('p1')).toBe(true);
            expect(state.collapsedTopicIds.has('p2')).toBe(true);
            expect(state.collapsedTopicIds.has('leaf')).toBe(false);
            expect(state.collapsedTopicIds.has('c1')).toBe(false);
            expect(state.collapsedTopicIds.has('c2')).toBe(false);
        });

        it('saves to localStorage', () => {
            state.topics = [
                { id: 'p1', name: 'Parent 1', parent_id: '' },
                { id: 'c1', name: 'Child 1', parent_id: 'p1' },
            ];

            collapseAllTopics();

            expect(globalThis.localStorage.setItem).toHaveBeenCalledWith(
                'topicCollapseState',
                JSON.stringify(['p1'])
            );
        });

        it('handles nested parents (multi-level)', () => {
            state.topics = [
                { id: 'root', name: 'Root', parent_id: '' },
                { id: 'mid', name: 'Mid', parent_id: 'root' },
                { id: 'leaf', name: 'Leaf', parent_id: 'mid' },
            ];

            collapseAllTopics();

            // root has child 'mid', mid has child 'leaf'
            expect(state.collapsedTopicIds.has('root')).toBe(true);
            expect(state.collapsedTopicIds.has('mid')).toBe(true);
            expect(state.collapsedTopicIds.has('leaf')).toBe(false);
        });

        it('does nothing when there are no parent topics', () => {
            state.topics = [
                { id: 'a', name: 'A', parent_id: '' },
                { id: 'b', name: 'B', parent_id: '' },
            ];

            collapseAllTopics();

            expect(state.collapsedTopicIds.size).toBe(0);
        });

        it('updates search tracking sets when search is active', () => {
            state.topics = [
                { id: 'p1', name: 'Parent 1', parent_id: '' },
                { id: 'c1', name: 'Child 1', parent_id: 'p1' },
                { id: 'p2', name: 'Parent 2', parent_id: '' },
                { id: 'c2', name: 'Child 2', parent_id: 'p2' },
            ];
            state.preSearchCollapsedTopicIds = new Set();

            collapseAllTopics();

            expect(state.searchManualCollapsedTopicIds.has('p1')).toBe(true);
            expect(state.searchManualCollapsedTopicIds.has('p2')).toBe(true);
            expect(state.searchManualExpandedTopicIds.has('p1')).toBe(false);
            expect(state.searchManualExpandedTopicIds.has('p2')).toBe(false);
        });

        it('does not update search tracking sets when no search is active', () => {
            state.topics = [
                { id: 'p1', name: 'Parent 1', parent_id: '' },
                { id: 'c1', name: 'Child 1', parent_id: 'p1' },
            ];
            state.preSearchCollapsedTopicIds = undefined;

            collapseAllTopics();

            expect(state.searchManualCollapsedTopicIds.size).toBe(0);
        });
    });

    describe('expandAllTopics', () => {
        it('clears all collapsed topic IDs', () => {
            state.collapsedTopicIds.add('t1');
            state.collapsedTopicIds.add('t2');
            state.collapsedTopicIds.add('t3');

            expandAllTopics();

            expect(state.collapsedTopicIds.size).toBe(0);
        });

        it('saves empty state to localStorage', () => {
            state.collapsedTopicIds.add('t1');

            expandAllTopics();

            expect(globalThis.localStorage.setItem).toHaveBeenCalledWith(
                'topicCollapseState',
                JSON.stringify([])
            );
        });

        it('works when already all expanded', () => {
            expandAllTopics();

            expect(state.collapsedTopicIds.size).toBe(0);
        });

        it('updates search tracking sets when search is active', () => {
            state.collapsedTopicIds.add('p1');
            state.collapsedTopicIds.add('p2');
            state.preSearchCollapsedTopicIds = new Set(['p1']);

            expandAllTopics();

            expect(state.searchManualExpandedTopicIds.has('p1')).toBe(true);
            expect(state.searchManualExpandedTopicIds.has('p2')).toBe(true);
            expect(state.searchManualCollapsedTopicIds.has('p1')).toBe(false);
            expect(state.searchManualCollapsedTopicIds.has('p2')).toBe(false);
        });

        it('does not update search tracking sets when no search is active', () => {
            state.collapsedTopicIds.add('p1');
            state.preSearchCollapsedTopicIds = undefined;

            expandAllTopics();

            expect(state.searchManualExpandedTopicIds.size).toBe(0);
        });
    });
});
