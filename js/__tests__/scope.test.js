import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state } from '../state.js';
import * as api from '../api.js';
import { buildTree, rollup, path, short, pickerRows, loadScope, setScope, hasSavedScope, refreshProgress, initScope, startPractice } from '../scope.js';
import * as scope from '../scope.js';
import { resetForNewSession } from '../session.js';

vi.mock('../api.js', () => ({
    fetchTopicProgressAPI: vi.fn(),
    saveUserSettingsAPI: vi.fn(async () => {}),
}));
vi.mock('../session.js', () => ({ resetForNewSession: vi.fn() }));

const NOW = Date.parse('2026-10-09T12:00:00Z');
const OLD = '2026-08-01T00:00:00Z';
const topics = [
    { id: 'archive', name: 'Archive', parent_id: null, sort_order: 0, is_archive: true, created_at: OLD },
    { id: 'telc', name: 'telc B1 (Berlin) — Prüfung', parent_id: null, sort_order: 2, created_at: OLD },
    { id: 'amt', name: 'Amt', parent_id: null, sort_order: 1, created_at: OLD },
    { id: 'g', name: 'G. Mündliche Prüfung (Teil 1–3)', parent_id: 'telc', sort_order: 0, created_at: OLD },
    { id: 'g1', name: 'G1. Teil 1 — Kontaktaufnahme', parent_id: 'g', sort_order: 0, created_at: OLD },
    { id: 'g1b', name: 'G1b. Fokus 02.10: Haus oder Wohnung', parent_id: 'g', sort_order: 1, created_at: '2026-10-02T09:00:00Z' },
    { id: 'e', name: 'E. Schreiben', parent_id: 'telc', sort_order: 1, created_at: OLD },
    { id: 'old', name: 'Old Fokus', parent_id: 'archive', sort_order: 0, created_at: OLD },
];
const progress = {
    g1: { exercises: 10, seen: 8, due: 3, mastered: 5 },
    g1b: { exercises: 6, seen: 6, due: 4, mastered: 1 },
    e: { exercises: 4, seen: 0, due: 0, mastered: 0 },
    old: { exercises: 2, seen: 2, due: 2, mastered: 0 },
};

describe('scope tree', () => {
    it('builds roots in sort order without the archive, with folder/leaf kinds', () => {
        const t = buildTree(topics);
        expect(t.roots.map((n) => n.id)).toEqual(['amt', 'telc']);
        expect(t.archive.id).toBe('archive');
        expect(t.byId.get('telc').kind).toBe('folder');
        expect(t.byId.get('g1').kind).toBe('leaf');
        expect(t.byId.get('g').children.map((n) => n.id)).toEqual(['g1', 'g1b']);
    });

    it('rolls due/total/mastery up to every ancestor; All = sum over the non-archive roots', () => {
        const t = rollup(buildTree(topics), progress, NOW);
        const telc = t.byId.get('telc');
        expect(t.byId.get('g').due).toBe(7);
        expect(telc.due).toBe(7);
        expect(telc.total).toBe(20);
        expect(telc.mastery).toBeCloseTo(6 / 20);
        expect(t.byId.get('amt')).toMatchObject({ due: 0, total: 0, mastery: 0 });
        expect(t.due).toBe(7); // archive's 2 due not included
    });

    it('marks leaves created in the last 14 days and their ancestors as new', () => {
        const t = rollup(buildTree(topics), progress, NOW);
        expect(t.byId.get('g1b').isNew).toBe(true);
        expect(t.byId.get('g').isNew).toBe(true);
        expect(t.byId.get('telc').isNew).toBe(true);
        expect(t.byId.get('g1').isNew).toBe(false);
        expect(t.byId.get('amt').isNew).toBe(false);
    });

    it('anonymous (no progress) is all zeros', () => {
        const t = rollup(buildTree(topics), {}, NOW);
        expect(t.due).toBe(0);
        expect(t.byId.get('telc')).toMatchObject({ due: 0, total: 0, mastery: 0 });
    });

    it('short() trims the name at " — ", " (" and ":"', () => {
        expect(short('telc B1 (Berlin) — Prüfung')).toBe('telc B1');
        expect(short('G1. Teil 1 — Kontaktaufnahme')).toBe('G1. Teil 1');
        expect(short('G1b. Fokus 02.10: Haus oder Wohnung')).toBe('G1b. Fokus 02.10');
        expect(short('Amt')).toBe('Amt');
    });

    it('path() lists the ancestors root-first', () => {
        const t = buildTree(topics);
        expect(path('g1b', t).map((n) => n.id)).toEqual(['telc', 'g', 'g1b']);
        expect(path('nope', t)).toEqual([]);
        expect(path(null, t)).toEqual([]);
    });

    it('picker search finds a deep leaf with its trail and never the archive', () => {
        const t = buildTree(topics);
        const rows = pickerRows('haus', new Set(), t);
        expect(rows.map((r) => r.x.id)).toEqual(['g1b']);
        expect(rows[0].trail.map((n) => n.id)).toEqual(['telc', 'g']);
        expect(pickerRows('fokus', new Set(), t).map((r) => r.x.id)).toEqual(['g1b']);
    });

    it('picker tree shows only expanded folders', () => {
        const t = buildTree(topics);
        expect(pickerRows('', new Set(), t).map((r) => r.x.id)).toEqual(['amt', 'telc']);
        expect(pickerRows('', new Set(['telc']), t).map((r) => [r.x.id, r.depth])).toEqual([['amt', 0], ['telc', 0], ['g', 1], ['e', 1]]);
    });
});

describe('scope state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        state.isLoggedIn = false;
        state.recentlyUsedTopics = [];
        state.topics = topics;
        document.body.innerHTML = '<div id="scope-slot"></div><section data-screen="history"></section><span id="tab-due-badge" hidden></span>';
        window.dispatchEvent(new Event('topicschange')); // rebuild the module tree (listener added once below)
    });

    initScope();

    it('first run is All topics and nothing is saved', () => {
        loadScope();
        expect(state.scopeId).toBe(null);
        expect(hasSavedScope()).toBe(false);
    });

    it('migrates the old combobox pick', () => {
        localStorage.setItem('selectedTopicId', 'g1');
        loadScope();
        expect(state.scopeId).toBe('g1');
        expect(localStorage.getItem('gct-scope')).toBe('g1');
    });

    it('setScope persists, follows currentTopicId, records a recent topic and dispatches scopechange', () => {
        const changed = vi.fn();
        window.addEventListener('scopechange', changed);
        setScope('g1b');
        window.removeEventListener('scopechange', changed);

        expect(state.scopeId).toBe('g1b');
        expect(state.currentTopicId).toBe('g1b');
        expect(localStorage.setItem).toHaveBeenCalledWith('gct-scope', 'g1b');
        expect(state.recentlyUsedTopics[0]).toEqual({ id: 'g1b', name: topics[5].name });
        expect(changed).toHaveBeenCalled();
        loadScope();
        expect(state.scopeId).toBe('g1b'); // survives a reload

        setScope(null);
        expect(localStorage.setItem).toHaveBeenLastCalledWith('gct-scope', '');
        expect(state.currentTopicId).toBe('');
    });

    it('a saved scope that no longer exists or was archived falls back to All', () => {
        setScope('old');
        window.dispatchEvent(new Event('topicschange'));
        expect(state.scopeId).toBe(null);

        setScope('gone');
        window.dispatchEvent(new Event('topicschange'));
        expect(state.scopeId).toBe(null);
    });

    it('the due pill equals the rolled-up subtree due, and the button shows a short breadcrumb', async () => {
        state.isLoggedIn = true;
        api.fetchTopicProgressAPI.mockResolvedValueOnce({ topics: progress });
        await refreshProgress();
        setScope('g');

        const btn = document.querySelector('#scope-slot .gct-scope-btn');
        expect(btn.querySelector('.gct-scope-btn__due').textContent).toBe('7');
        expect(btn.textContent).toContain('telc B1');
        expect(btn.textContent).toContain('G. Mündliche Prüfung');
        expect(document.getElementById('tab-due-badge').textContent).toBe('7');
        expect(document.querySelector('[data-screen="history"] .gct-scope-note').textContent).toContain('Sentences in G. Mündliche Prüfung and its 2 topics');

        setScope(null);
        expect(document.querySelector('.gct-scope-btn').textContent).toContain('All topics');
        expect(scope.tree.due).toBe(7);
    });

    it('anonymous users never fetch progress', async () => {
        await refreshProgress();
        expect(api.fetchTopicProgressAPI).not.toHaveBeenCalled();
        expect(scope.tree.due).toBe(0);
    });

    it('startPractice(null) practises All topics without changing the scope', () => {
        setScope('g1');
        startPractice(null);
        expect(state.currentTopicId).toBe('');
        expect(state.scopeId).toBe('g1');
        expect(resetForNewSession).toHaveBeenCalled();
    });
});
