import { describe, it, expect, vi } from 'vitest';
import { buildTree } from '../scope.js';
import { searchNodes, isArchived, createdDate, recentRows } from '../topics-browser.js';

vi.mock('../api.js', () => ({
    fetchTopicProgressAPI: vi.fn(),
    saveUserSettingsAPI: vi.fn(async () => {}),
    loadExerciseHistoryAPI: vi.fn(),
}));
vi.mock('../session.js', () => ({ resetForNewSession: vi.fn() }));

const OLD = '2026-08-01T00:00:00Z';
const topics = [
    { id: 'archive', name: 'Archive', parent_id: null, sort_order: 0, is_archive: true, created_at: OLD },
    { id: 'telc', name: 'telc B1 (Berlin) — Prüfung', parent_id: null, sort_order: 2, created_at: OLD },
    { id: 'g', name: 'G. Mündliche Prüfung', parent_id: 'telc', sort_order: 0, created_at: OLD },
    { id: 'g1', name: 'G1. Teil 1 — Kontaktaufnahme', parent_id: 'g', sort_order: 0, created_at: OLD },
    { id: 'g1b', name: 'G1b. Fokus 02.10: Haus', parent_id: 'g', sort_order: 1, created_at: '2026-10-02T09:00:00Z' },
    { id: 'old', name: 'Old Fokus Teil', parent_id: 'archive', sort_order: 0, created_at: OLD },
];

describe('topics browser helpers', () => {
    const t = buildTree(topics);

    it('search filters names case-insensitively, skips the archive and carries the trail', () => {
        const hits = searchNodes('teil', t);
        expect(hits.map((h) => h.node.id)).toEqual(['g1']);
        expect(hits[0].trail.map((n) => n.id)).toEqual(['telc', 'g']);
        expect(searchNodes('fokus', t).map((h) => h.node.id)).toEqual(['g1b']);
        expect(searchNodes('  ', t)).toEqual([]);
    });

    it('search caps the hit count', () => {
        expect(searchNodes('g', t, 2)).toHaveLength(2);
    });

    it('archive guard: the archive root and everything under it is read-only', () => {
        expect(isArchived('archive', t)).toBe(true);
        expect(isArchived('old', t)).toBe(true);
        expect(isArchived('g1', t)).toBe(false);
        expect(isArchived('missing', t)).toBe(false);
    });

    it('createdDate is DD.MM.YYYY', () => {
        expect(createdDate('2026-10-02T09:00:00Z')).toBe('02.10.2026');
        expect(createdDate('')).toBe('');
    });

    it('recentRows keeps the newest 5 by last_viewed', () => {
        const rows = Array.from({ length: 7 }, (_, i) => ({ id: i, last_viewed: `2026-10-0${i + 1}T00:00:00Z` }));
        expect(recentRows(rows).map((r) => r.id)).toEqual([6, 5, 4, 3, 2]);
    });
});
