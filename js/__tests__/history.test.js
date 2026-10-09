import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    showExerciseHistory, renderHistory, initHistory, getFilteredHistoryData, filterCounts,
    relativeTopic, statusBadge, bucketReviewItems, REVIEW_BUCKETS,
} from '../history.js';
import { state } from '../state.js';
import { initScope } from '../scope.js';
import * as api from '../api.js';
import { toast } from '../ui.js';

vi.mock('../api.js', () => ({
    loadExerciseHistoryAPI: vi.fn(),
    toggleHideExerciseAPI: vi.fn(),
    toggleFavoriteAPI: vi.fn(),
    fetchTopicProgressAPI: vi.fn(),
    saveUserSettingsAPI: vi.fn(async () => {}),
}));
vi.mock('../session.js', () => ({ resetForNewSession: vi.fn() }));

const NOW = Date.parse('2026-10-09T12:00:00Z');
const OLD = '2026-08-01T00:00:00Z';
const topics = [
    { id: 'telc', name: 'telc B1 (Berlin) — Prüfung', parent_id: null, sort_order: 0, created_at: OLD },
    { id: 'g', name: 'G. Mündliche Prüfung', parent_id: 'telc', sort_order: 0, created_at: OLD },
    { id: 'g1', name: 'G1. Teil 1 — Kontaktaufnahme', parent_id: 'g', sort_order: 0, created_at: OLD },
];

const row = (o = {}) => ({
    exercise_id: 'x', german_sentence: 'Ich gehe, weil es regnet.', english_hint: 'I go because it rains.',
    topic_id: 'g1', topic_name: 'G1', last_viewed: new Date(NOW - 36e5).toISOString(), next_review_hours: 5,
    ready_to_repeat: false, is_hidden: false, is_favorite: false,
    total_attempts: 4, successful_attempts: 3, failed_attempts: 1, hints_used: 0, ...o,
});

const PAGE_HTML = '<section id="screen-history"><div id="history-sub"></div><div id="history-loading" hidden></div><div id="history-body" hidden>'
    + '<div id="history-review-chart-bars"></div><div id="history-filters">'
    + ['due', 'training', 'fav', 'ignored'].map((f) => `<button data-filter="${f}"><span class="gct-pill__count"></span></button>`).join('')
    + '</div><div id="history-sort">'
    + ['timing', 'errors', 'date'].map((k) => `<button data-sort="${k}"><span class="gct-history__dir"></span></button>`).join('')
    + '</div><div id="history-content"></div><button id="history-more-btn" hidden></button></div></section>';

initScope();
let inited = false;

describe('history.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        state.isLoggedIn = true;
        state.scopeId = null;
        state.recentlyUsedTopics = [];
        state.topics = topics;
        window.dispatchEvent(new Event('topicschange'));
        state.historyData = [];
        state.historyPage = 1;
        state.historyFilter = 'due';
        state.historySort = { key: 'timing', dir: 1 };
        document.body.innerHTML = PAGE_HTML;
        if (!inited) { initHistory(); inited = true; }
    });

    describe('filters', () => {
        const rows = [
            row({ ready_to_repeat: true, is_favorite: true }),
            row({ ready_to_repeat: true }),
            row(),
            row({ is_hidden: true, ready_to_repeat: true, is_favorite: true }),
        ];

        it('are single-select and never show ignored rows outside Ignored', () => {
            expect(getFilteredHistoryData(rows, 'due', { key: 'timing', dir: 1 })).toHaveLength(2);
            expect(getFilteredHistoryData(rows, 'training', { key: 'timing', dir: 1 })).toHaveLength(1);
            expect(getFilteredHistoryData(rows, 'fav', { key: 'timing', dir: 1 })).toHaveLength(1);
            expect(getFilteredHistoryData(rows, 'ignored', { key: 'timing', dir: 1 })).toHaveLength(1);
        });

        it('counts equal the rows each pill shows', () => {
            const c = filterCounts(rows);
            expect(c).toEqual({ due: 2, training: 1, fav: 1, ignored: 1 });
            for (const k of Object.keys(c)) expect(getFilteredHistoryData(rows, k, { key: 'date', dir: -1 })).toHaveLength(c[k]);
        });
    });

    it('sorts by errors and flips on a repeat click', () => {
        state.historyFilter = 'training';
        state.historyData = [
            row({ exercise_id: 'good', german_sentence: 'good', successful_attempts: 4 }),
            row({ exercise_id: 'bad', german_sentence: 'bad', successful_attempts: 0 }),
        ];
        renderHistory(NOW);
        const first = () => document.querySelector('.gct-history__de').textContent;
        const errors = document.querySelector('[data-sort="errors"]');
        errors.click();
        expect(first()).toBe('bad');
        expect(errors.textContent).toBe('↓');
        errors.click();
        expect(first()).toBe('good');
        expect(errors.textContent).toBe('↑');
    });

    it('relative topic label drops the scope prefix; the leaf alone when the row is the scope', () => {
        expect(relativeTopic(row(), null)).toBe('telc B1 › G. Mündliche Prüfung › G1. Teil 1');
        expect(relativeTopic(row(), 'telc')).toBe('G. Mündliche Prüfung › G1. Teil 1');
        expect(relativeTopic(row(), 'g1')).toBe('G1. Teil 1');
        expect(relativeTopic(row({ topic_id: 'gone', topic_name: 'Old' }), 'telc')).toBe('Old');
    });

    it('status badge: Due now (info), in N h / N d, Ignored', () => {
        expect(statusBadge(row({ ready_to_repeat: true }), NOW)).toContain('gct-badge--info');
        expect(statusBadge(row({ ready_to_repeat: true }), NOW)).toContain('Due now');
        expect(statusBadge(row(), NOW)).toContain('in 4 h');
        expect(statusBadge(row({ next_review_hours: 49 }), NOW)).toContain('in 2 d');
        expect(statusBadge(row({ is_hidden: true }), NOW)).toContain('Ignored');
    });

    describe('showExerciseHistory', () => {
        it('does not load when logged out', async () => {
            state.isLoggedIn = false;
            await showExerciseHistory();
            expect(api.loadExerciseHistoryAPI).not.toHaveBeenCalled();
        });

        it('loads the scope, shows counts, sub line and the Due rows', async () => {
            state.scopeId = 'telc';
            api.loadExerciseHistoryAPI.mockResolvedValueOnce({ history: [
                row({ ready_to_repeat: true, successful_attempts: 1, total_attempts: 4 }),
                row({ successful_attempts: 3, total_attempts: 4 }),
                row({ is_hidden: true, successful_attempts: 0, total_attempts: 10 }),
            ] });
            await showExerciseHistory();
            expect(api.loadExerciseHistoryAPI).toHaveBeenCalledWith('telc');
            expect(document.getElementById('history-body').hidden).toBe(false);
            expect(document.getElementById('history-sub').textContent).toBe('2 practiced · 50% right first time');
            const count = (f) => document.querySelector(`[data-filter="${f}"] .gct-pill__count`).textContent;
            expect([count('due'), count('training'), count('fav'), count('ignored')]).toEqual(['1', '1', '0', '1']);
            expect(document.querySelectorAll('.gct-history__row')).toHaveLength(1);
            expect(document.querySelector('.gct-history__where').textContent).toMatch(/^G\. Mündliche Prüfung › G1\. Teil 1 · /);
        });

        it('shows the empty line and a toast on failure', async () => {
            api.loadExerciseHistoryAPI.mockResolvedValueOnce({ history: [] });
            await showExerciseHistory();
            expect(document.getElementById('history-content').textContent).toBe('Nothing here yet.');
            api.loadExerciseHistoryAPI.mockRejectedValueOnce(new Error('x'));
            await showExerciseHistory();
            expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
        });
    });

    it('Show more reveals the next 10 rows', () => {
        state.historyData = Array.from({ length: 15 }, (_, i) => row({ ready_to_repeat: true, exercise_id: String(i) }));
        renderHistory(NOW);
        expect(document.querySelectorAll('.gct-history__row')).toHaveLength(10);
        const more = document.getElementById('history-more-btn');
        expect(more.hidden).toBe(false);
        more.click();
        expect(document.querySelectorAll('.gct-history__row')).toHaveLength(15);
        expect(more.hidden).toBe(true);
    });

    it('ignore moves the row to Ignored and Undo brings it back', async () => {
        const item = row({ ready_to_repeat: true });
        state.historyData = [item];
        renderHistory(NOW);
        api.toggleHideExerciseAPI.mockResolvedValueOnce({ is_hidden: true }).mockResolvedValueOnce({ is_hidden: false });
        document.querySelector('[data-act="ignore"]').click();
        await vi.waitFor(() => expect(toast).toHaveBeenCalled());
        expect(item.is_hidden).toBe(true);
        expect(document.querySelectorAll('.gct-history__row')).toHaveLength(0);
        const { text, action } = toast.mock.calls[0][0];
        expect(text).toBe('Hidden from future sessions');
        await action.run();
        expect(item.is_hidden).toBe(false);
        expect(document.querySelectorAll('.gct-history__row')).toHaveLength(1);
        expect(api.toggleHideExerciseAPI).toHaveBeenCalledTimes(2);
    });

    it('star toggles favorite', async () => {
        const item = row({ ready_to_repeat: true });
        state.historyData = [item];
        renderHistory(NOW);
        api.toggleFavoriteAPI.mockResolvedValueOnce({ is_favorite: true });
        document.querySelector('[data-act="fav"]').click();
        await vi.waitFor(() => expect(item.is_favorite).toBe(true));
        expect(document.querySelector('[data-act="fav"]').getAttribute('aria-pressed')).toBe('true');
    });

    describe('bucketReviewItems', () => {
        const NOW = new Date('2026-04-13T12:00:00Z').getTime();
        const msPerHour = 1000 * 60 * 60;

        function makeItem({ readyToRepeat = false, lastViewedHoursAgo = 1, nextReviewHours = 1, isHidden = false } = {}) {
            return {
                ready_to_repeat: readyToRepeat,
                last_viewed: new Date(NOW - lastViewedHoursAgo * msPerHour).toISOString(),
                next_review_hours: nextReviewHours,
                is_hidden: isHidden,
            };
        }

        it('has 8 buckets', () => {
            expect(REVIEW_BUCKETS).toHaveLength(8);
            expect(REVIEW_BUCKETS[0].label).toBe('Now');
            expect(REVIEW_BUCKETS[7].label).toBe('Later');
        });

        it('returns all zeros for empty items', () => {
            const buckets = bucketReviewItems([], NOW);
            expect(buckets).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        });

        it('puts ready_to_repeat items in the Now bucket', () => {
            const items = [makeItem({ readyToRepeat: true }), makeItem({ readyToRepeat: true })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[0]).toBe(2); // Now
            expect(buckets.slice(1).every(c => c === 0)).toBe(true);
        });

        it('excludes hidden items', () => {
            const items = [makeItem({ readyToRepeat: true, isHidden: true })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets.every(c => c === 0)).toBe(true);
        });

        it('puts non-ready items due in <1h in <4h bucket, not Now', () => {
            // lastViewed 2h ago, next_review_hours = 2.5 => due in 0.5h, but not ready
            const items = [makeItem({ lastViewedHoursAgo: 2, nextReviewHours: 2.5 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[0]).toBe(0); // Not in Now
            expect(buckets[1]).toBe(1); // <4h
        });

        it('puts items due in 1-4h in the <4h bucket', () => {
            // lastViewed 1h ago, next_review_hours = 3 => due in 2h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 3 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[1]).toBe(1); // <4h
        });

        it('puts items due in 4-12h in the 4-12h bucket', () => {
            // lastViewed 1h ago, next_review_hours = 10 => due in 9h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 10 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[2]).toBe(1); // 4-12h
        });

        it('puts items due in 12-24h in the 12-24h bucket', () => {
            // lastViewed 1h ago, next_review_hours = 16 => due in 15h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 16 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[3]).toBe(1); // 12-24h
        });

        it('puts items due in 1-2d in the 1-2d bucket', () => {
            // lastViewed 1h ago, next_review_hours = 30 => due in 29h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 30 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[4]).toBe(1); // 1-2d
        });

        it('puts items due in 2-4d in the 2-4d bucket', () => {
            // lastViewed 1h ago, next_review_hours = 60 => due in 59h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 60 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[5]).toBe(1); // 2-4d
        });

        it('puts items due in 4-7d in the 4-7d bucket', () => {
            // lastViewed 1h ago, next_review_hours = 120 => due in 119h
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 120 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[6]).toBe(1); // 4-7d
        });

        it('puts items due beyond 7d in the Later bucket', () => {
            // lastViewed 1h ago, next_review_hours = 200 => due in 199h (~8.3 days)
            const items = [makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 200 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[7]).toBe(1); // Later
        });

        it('distributes a mix of items across buckets correctly', () => {
            const items = [
                makeItem({ readyToRepeat: true }),                              // Now
                makeItem({ lastViewedHoursAgo: 2, nextReviewHours: 2.5 }),      // <4h (0.5h, not ready)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 3 }),        // <4h (2h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 10 }),       // 4-12h (9h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 16 }),       // 12-24h (15h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 30 }),       // 1-2d (29h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 60 }),       // 2-4d (59h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 120 }),      // 4-7d (119h)
                makeItem({ lastViewedHoursAgo: 1, nextReviewHours: 200 }),      // Later (199h)
                makeItem({ readyToRepeat: true, isHidden: true }),              // excluded
            ];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets).toEqual([1, 2, 1, 1, 1, 1, 1, 1]);
        });

        it('places items at exact bucket boundaries in the next bucket', () => {
            // Exactly at maxHours threshold should go to the NEXT bucket (strict <)
            // e.g., exactly 1h => "<4h" (not "Now"), exactly 4h => "4-12h" (not "<4h")
            const items = [
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 1 }),   // exactly 1h => <4h
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 4 }),   // exactly 4h => 4-12h
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 12 }),  // exactly 12h => 12-24h
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 24 }),  // exactly 24h => 1-2d
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 48 }),  // exactly 48h => 2-4d
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 96 }),  // exactly 96h => 4-7d
                makeItem({ lastViewedHoursAgo: 0, nextReviewHours: 168 }), // exactly 168h => Later
            ];
            const buckets = bucketReviewItems(items, NOW);
            //                    Now  <4h   4-12h 12-24h 1-2d  2-4d  4-7d  Later
            expect(buckets).toEqual([0,  1,    1,    1,     1,    1,    1,    1]);
        });

        it('treats overdue non-ready items as <4h, not Now', () => {
            // lastViewed 10h ago, next_review_hours = 2 => due 8h ago, but not ready
            const items = [makeItem({ lastViewedHoursAgo: 10, nextReviewHours: 2 })];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[0]).toBe(0); // Not in Now
            expect(buckets[1]).toBe(1); // <4h
        });

        it('non-ready items due in <1h go to <4h bucket, not Now', () => {
            // Two non-ready items due very soon - both should skip Now bucket
            const items = [
                makeItem({ lastViewedHoursAgo: 2, nextReviewHours: 2.1 }),  // due in 0.1h
                makeItem({ lastViewedHoursAgo: 5, nextReviewHours: 5.5 }),  // due in 0.5h
            ];
            const buckets = bucketReviewItems(items, NOW);
            expect(buckets[0]).toBe(0); // Now: empty
            expect(buckets[1]).toBe(2); // <4h: both items
        });
    });
});
