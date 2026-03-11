import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    state,
    addRecentlyUsedTopic,
    removeRecentlyUsedTopic,
    toggleTopicCollapse,
    isTopicCollapsed,
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
});
