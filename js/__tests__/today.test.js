import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state } from '../state.js';
import { dom } from '../dom.js';
import { buildTree, rollup, initScope } from '../scope.js';
import { aboutMinutes, newestLeaf, heroHtml, weekHtml, upcomingHtml, renderToday } from '../today.js';

vi.mock('../api.js', () => ({
    fetchTopicProgressAPI: vi.fn(),
    saveUserSettingsAPI: vi.fn(async () => {}),
}));
vi.mock('../session.js', () => ({ resetForNewSession: vi.fn() }));

const NOW = Date.parse('2026-10-09T12:00:00Z');
const OLD = '2026-08-01T00:00:00Z';
const topics = [
    { id: 'telc', name: 'telc B1 (Berlin) — Prüfung', parent_id: null, sort_order: 1, created_at: OLD },
    { id: 'amt', name: 'Amt', parent_id: null, sort_order: 0, created_at: OLD },
    { id: 'g', name: 'G. Mündliche Prüfung', parent_id: 'telc', sort_order: 0, created_at: OLD },
    { id: 'g1', name: 'G1. Teil 1 — Kontaktaufnahme', parent_id: 'g', sort_order: 0, created_at: OLD },
    { id: 'g1b', name: 'G1b. Fokus 02.10: Haus', parent_id: 'g', sort_order: 1, created_at: '2026-10-02T09:00:00Z' },
    { id: 'e', name: 'E. Schreiben', parent_id: 'telc', sort_order: 1, created_at: OLD },
];

describe('today helpers', () => {
    it('aboutMinutes is a quarter minute per sentence, at least 1', () => {
        expect(aboutMinutes(0)).toBe(1);
        expect(aboutMinutes(1)).toBe(1);
        expect(aboutMinutes(10)).toBe(3);
        expect(aboutMinutes(40)).toBe(10);
    });

    it('newestLeaf picks the newest leaf in the subtree, or itself for a leaf', () => {
        const t = buildTree(topics);
        expect(newestLeaf(null, t.roots).id).toBe('g1b');
        expect(newestLeaf(t.byId.get('telc')).id).toBe('g1b');
        expect(newestLeaf(t.byId.get('e')).id).toBe('e');
    });

    it('hero shows due, minutes and at most 4 narrowing pills for children with due', () => {
        const t = rollup(buildTree(topics), { g1: { exercises: 5, due: 3, mastered: 1 }, e: { exercises: 2, due: 1, mastered: 0 } }, NOW);
        const node = t.byId.get('telc');
        const html = heroHtml({ node, due: node.due, kids: node.children, loggedIn: true });
        expect(html).toContain('Due now · telc B1');
        expect(html).toContain('>4<');
        expect(html).toContain('about 1 min');
        expect(html.match(/data-scope-id/g)).toHaveLength(2);
        const none = heroHtml({ node: null, due: 0, kids: t.byId.get('amt').children, loggedIn: true });
        expect(none).toContain('nothing due here right now');
        expect(none).not.toContain('data-scope-id');
    });

    it('anonymous hero nudges to log in and shows no due number', () => {
        const t = buildTree(topics);
        const html = heroHtml({ node: null, due: 0, kids: t.roots, loggedIn: false });
        expect(html).toContain('Log in to track your reviews');
        expect(html).not.toContain('gct-today__num');
    });

    it('week card counts active days and sentences; today is the last bar', () => {
        const days = [0, 3, 0, 0, 2, 0, 0].map((count, i) => ({ date: `2026-10-0${i + 3}`, count }));
        const html = weekHtml(days, null);
        expect(html).toContain('2 of 7 days</b> · 5 sentences');
        expect(html.match(/is-today/g)).toHaveLength(2); // bar + label
    });

    it('upcoming uses the History buckets (ready now, hidden excluded)', () => {
        const history = [
            { ready_to_repeat: true },
            { ready_to_repeat: true, is_hidden: true },
            { ready_to_repeat: false, last_viewed: new Date(NOW).toISOString(), next_review_hours: 2 },
        ];
        const html = upcomingHtml(history, NOW);
        expect(html).toMatch(/is-now"><span>1<\/span>/);
        expect(html).toContain('href="#/history"');
    });
});

describe('renderToday', () => {
    initScope();

    beforeEach(() => {
        localStorage.clear();
        state.isLoggedIn = false;
        state.recentlyUsedTopics = [];
        state.topics = topics;
        document.body.innerHTML = '<section id="screen-today"><div id="today-date"></div><div id="today-hero"></div><a id="today-browse"></a>'
            + '<div id="today-lesson" hidden></div><div id="today-sections" hidden></div>'
            + '<div id="today-episode" hidden></div><div id="today-week" hidden></div><div id="today-upcoming" hidden></div></section>';
        window.dispatchEvent(new Event('topicschange'));
    });

    it('anonymous: login nudge, Practice anyway, roots listed, personal cards hidden', () => {
        renderToday();
        expect(document.getElementById('today-hero').innerHTML).toContain('Log in to track your reviews');
        expect(dom.generateBtn.innerHTML).toContain('Practice anyway');
        const sections = document.getElementById('today-sections');
        expect(sections.hidden).toBe(false);
        expect([...sections.querySelectorAll('[data-scope-id]')].map((b) => b.dataset.scopeId)).toEqual(['amt', 'telc']);
        expect(document.getElementById('today-lesson').hidden).toBe(false);
        for (const id of ['today-episode', 'today-week', 'today-upcoming']) expect(document.getElementById(id).hidden).toBe(true);
    });
});
