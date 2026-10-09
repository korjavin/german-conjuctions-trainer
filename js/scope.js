// Global topic scope: one folder/leaf (or All topics, null) that Today, Topics, Listen, History
// and Practice follow. Ported from docs/design/claude-design/ui_kits/app/Scope.jsx + Data.jsx.
import { state, addRecentlyUsedTopic } from './state.js';
import { buildTopicTree } from './topics.js';
import { fetchTopicProgressAPI, saveUserSettingsAPI } from './api.js';
import { currentRoute, render as renderRoute } from './router.js';
import { resetForNewSession } from './session.js';

const SCOPE_KEY = 'gct-scope'; // '' = All topics
const LEGACY_KEY = 'selectedTopicId'; // the old header combobox pick
const NEW_DAYS = 14;
const SCOPED_ROUTES = ['today', 'topics', 'listen', 'history'];
const BAR_ROUTES = ['today', 'listen', 'history']; // mobile scope bar
const NOTE_WHAT = { listen: 'Episodes', history: 'Sentences' }; // desktop scope note
const MOBILE = '(max-width: 759px)';

// Scope tree: roots exclude the archive (kept separately for Topics' Archive link).
export let tree = { roots: [], archive: null, byId: new Map(), due: 0 };
let progress = {};

export function buildTree(topics = state.topics) {
    const { roots, nodesById } = buildTopicTree(topics, 'tree');
    for (const n of nodesById.values()) n.kind = n.children.length ? 'folder' : 'leaf';
    return { roots: roots.filter((n) => !n.is_archive), archive: roots.find((n) => n.is_archive) || null, byId: nodesById, due: 0 };
}

// Rolls the direct per-topic counts of /api/topics/progress up the tree:
// due/total(exercises)/mastered sum over the subtree, mastery = mastered/total, isNew = a leaf created in the last 14 days.
export function rollup(t, prog = {}, now = Date.now()) {
    const cutoff = now - NEW_DAYS * 864e5;
    const walk = (n) => {
        const own = prog[n.id] || {};
        n.due = own.due || 0;
        n.total = own.exercises || 0;
        n.mastered = own.mastered || 0;
        n.isNew = n.kind === 'leaf' && Date.parse(n.created_at) >= cutoff;
        for (const c of n.children) {
            walk(c);
            n.due += c.due;
            n.total += c.total;
            n.mastered += c.mastered;
            n.isNew ||= c.isNew;
        }
        n.mastery = n.total ? n.mastered / n.total : 0;
    };
    t.roots.forEach(walk);
    if (t.archive) walk(t.archive);
    t.due = t.roots.reduce((s, r) => s + r.due, 0);
    return t;
}

// Root-first ancestors of id, inclusive; [] when unknown.
export function path(id, t = tree) {
    const out = [];
    for (let n = id && t.byId.get(id); n && !out.includes(n); n = t.byId.get(n.parent_id)) out.unshift(n);
    return out;
}

export const short = (name) => String(name).split(' — ')[0].split(' (')[0].split(':')[0];
const leaves = (n) => (n.kind === 'leaf' ? [n] : n.children.flatMap(leaves));
const inPicker = (id) => { const p = path(id); return p.length > 0 && !p[0].is_archive; };
export const scopeNode = () => (state.scopeId && tree.byId.get(state.scopeId)) || null;

// --- persistence ---

function readSaved() {
    try { return localStorage.getItem(SCOPE_KEY); } catch { return null; }
}
function save(id) {
    try { localStorage.setItem(SCOPE_KEY, id || ''); } catch (error) { console.error('Failed to save topic scope:', error); }
}
export const hasSavedScope = () => readSaved() !== null;

export function loadScope() {
    let id = readSaved();
    if (id === null) {
        try { id = localStorage.getItem(LEGACY_KEY); } catch { id = null; }
        if (id) save(id);
    }
    state.scopeId = id || null;
    state.currentTopicId = state.scopeId || '';
}

export function setScope(id) {
    id = id || null;
    state.scopeId = id;
    state.currentTopicId = id || '';
    save(id);
    const n = id && tree.byId.get(id);
    if (n) addRecentlyUsedTopic(id, n.name);
    if (state.isLoggedIn) saveUserSettingsAPI(id || '').catch((error) => console.error('Error saving user settings:', error));
    render();
    window.dispatchEvent(new CustomEvent('scopechange', { detail: { scopeId: id } }));
    // Re-run the current screen's data load (History, Listen) for the new scope.
    if (SCOPED_ROUTES.includes(currentRoute())) renderRoute();
}

// Practice a topic (null = All topics; cached due items only) without changing the scope.
export function startPractice(topicId = state.scopeId) {
    state.currentTopicId = topicId || '';
    const crumbs = document.getElementById('practice-crumbs'); // practice bar breadcrumb (desktop)
    if (crumbs) crumbs.innerHTML = labelHtml(4, topicId);
    resetForNewSession();
}

export async function refreshProgress() {
    if (!state.isLoggedIn) {
        progress = {};
    } else {
        try {
            progress = (await fetchTopicProgressAPI()).topics || {};
        } catch (error) {
            console.error('Failed to load topic progress:', error); // offline: keep the last numbers
            return;
        }
    }
    rollup(tree, progress);
    render();
    window.dispatchEvent(new CustomEvent('progresschange'));
}

function onTopicsChange() {
    tree = rollup(buildTree(), progress);
    // A saved scope that no longer exists (deleted, archived) falls back to All topics.
    if (state.scopeId && !inPicker(state.scopeId)) setScope(null);
    else render();
}

// --- render ---

// Topic names/ids go into text and attribute values: escape quotes too.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const svg = (name, size = 16) => (typeof window.gctIconSvg === 'function' ? window.gctIconSvg(name, size) : '');

function labelHtml(max = 2, id = state.scopeId) {
    const c = path(id).map((n) => short(n.name));
    if (!c.length) return '<span class="gct-scope-label"><b>All topics</b></span>';
    const shown = c.length > max ? [c[0], '…', ...c.slice(-(max - 1))] : c;
    return '<span class="gct-scope-label">' + shown.map((x, i) => (i ? svg('chevron-right', 13) : '')
        + (i === shown.length - 1 ? `<b>${esc(x)}</b>` : `<span>${esc(x)}</span>`)).join('') + '</span>';
}

function render() {
    const n = scopeNode();
    const due = n ? n.due : tree.due;
    const icon = n?.kind === 'leaf' ? 'leaf' : 'folder';
    const slot = document.getElementById('scope-slot');
    if (slot) {
        slot.innerHTML = `<button type="button" class="gct-scope-btn" data-scope-open aria-haspopup="dialog" aria-expanded="false" title="Choose a topic">`
            + `${svg(icon)}${labelHtml()}<span class="gct-scope-btn__due">${due}</span>${svg('chevron-down')}</button>`;
    }
    for (const name of BAR_ROUTES) {
        const section = document.querySelector(`[data-screen="${name}"]`);
        if (!section) continue;
        let bar = section.querySelector(':scope > .gct-scopebar');
        if (!bar) {
            bar = Object.assign(document.createElement('button'), { type: 'button', className: 'gct-card gct-scopebar' });
            bar.dataset.scopeOpen = '';
            bar.setAttribute('aria-haspopup', 'dialog');
            section.prepend(bar);
        }
        bar.innerHTML = `${svg(icon, 18)}<span class="gct-scopebar__label">${labelHtml()}</span>`
            + `<span class="gct-badge gct-badge--info gct-badge--quiet"><span class="gct-badge__dot"></span>${due}</span>${svg('chevron-down', 18)}`;
        if (NOTE_WHAT[name]) {
            let note = section.querySelector(':scope > .gct-scope-note');
            if (!note) {
                note = Object.assign(document.createElement('div'), { className: 'gct-scope-note' });
                bar.after(note);
            }
            note.hidden = !n;
            const subs = n && n.kind === 'folder' ? leaves(n).length : 0;
            note.innerHTML = n ? `${svg('folder')}<span>${NOTE_WHAT[name]} in <b>${esc(short(n.name))}</b>${subs ? ` and its ${subs} topics` : ''}</span>`
                + '<button type="button" data-scope-open>Change</button><button type="button" data-scope-all>Show all</button>' : '';
        }
    }
    const badge = document.getElementById('tab-due-badge');
    if (badge) {
        badge.textContent = due;
        badge.hidden = !due;
    }
}

// --- picker: popover under the button (desktop) / bottom sheet (mobile) ---

let picker = null;
let query = '';
let expanded = new Set();

function rowHtml(x, depth, trail) {
    const on = x.id === state.scopeId;
    const folder = x.kind === 'folder';
    const toggle = folder && !trail
        ? `<button type="button" class="gct-scope-row__toggle" data-toggle="${esc(x.id)}" aria-expanded="${expanded.has(x.id)}" aria-label="${expanded.has(x.id) ? 'Collapse' : 'Expand'} ${esc(x.name)}">${svg(expanded.has(x.id) ? 'chevron-down' : 'chevron-right')}</button>`
        : '<span class="gct-scope-row__toggle"></span>';
    return `<div class="gct-tree-row gct-scope-row${on ? ' is-current' : ''}" style="padding-left:${10 + depth * 18}px">${toggle}`
        + `<button type="button" class="gct-scope-row__pick" data-pick="${esc(x.id)}"${on ? ' aria-current="true"' : ''}>`
        + `<span class="gct-scope-row__icon${folder ? ' is-folder' : ''}">${svg(folder ? 'folder' : 'leaf')}</span>`
        + `<span class="gct-scope-row__text"><span class="gct-scope-row__name${folder ? ' is-folder' : ''}">${esc(x.name)}</span>`
        + (trail?.length ? `<span class="gct-scope-row__trail">${trail.map((p) => esc(short(p.name))).join(' › ')}</span>` : '')
        + '</span>'
        + (x.isNew ? '<span class="gct-scope-row__new" title="New"></span>' : '')
        + (x.due > 0 ? `<span class="gct-scope-row__due">${x.due}</span>` : '')
        + (on ? svg('check') : '')
        + '</button></div>';
}

// Search hits (name contains the query) are flat with their trail; otherwise the expandable tree.
export function pickerRows(q = '', open = new Set(), t = tree) {
    const rows = [];
    const needle = q.trim().toLowerCase();
    const walk = (nodes, depth, trail) => nodes.forEach((x) => {
        if (needle) {
            if (x.name.toLowerCase().includes(needle)) rows.push({ x, depth: 0, trail });
            walk(x.children, 0, [...trail, x]);
        } else {
            rows.push({ x, depth });
            if (open.has(x.id)) walk(x.children, depth + 1);
        }
    });
    walk(t.roots, 0, []);
    return rows;
}

function renderList() {
    const list = picker.querySelector('.gct-scope-picker__list');
    let html = '';
    if (!query.trim()) {
        const all = !state.scopeId;
        html += `<div class="gct-tree-row gct-scope-row${all ? ' is-current' : ''}"><span class="gct-scope-row__toggle"></span>`
            + `<button type="button" class="gct-scope-row__pick" data-pick=""${all ? ' aria-current="true"' : ''}>`
            + `<span class="gct-scope-row__icon">${svg('topics')}</span><span class="gct-scope-row__text"><span class="gct-scope-row__name is-folder">All topics</span></span>`
            + `<span class="gct-scope-row__due">${tree.due}</span>${all ? svg('check') : ''}</button></div>`;
        const recent = state.recentlyUsedTopics.map((r) => r.id).filter((id) => id !== state.scopeId && inPicker(id)).slice(0, 4);
        if (recent.length) {
            html += '<div class="gct-scope-picker__caption">Recent</div><div class="gct-scope-picker__recent">'
                + recent.map((id) => `<button type="button" class="gct-pill" data-pick="${esc(id)}"><span>${esc(short(tree.byId.get(id).name))}</span></button>`).join('')
                + '</div>';
        }
        html += '<div class="gct-scope-picker__caption">All topics</div>';
    }
    const rows = pickerRows(query, expanded);
    html += rows.map((r) => rowHtml(r.x, r.depth, r.trail)).join('');
    if (query.trim() && !rows.length) html += `<p class="gct-scope-picker__empty">No topic matches “${esc(query.trim())}”.</p>`;
    list.innerHTML = html;
}

function createPicker() {
    picker = document.createElement('dialog');
    picker.className = 'gct-scope-picker';
    picker.setAttribute('aria-label', 'Choose a topic');
    picker.innerHTML = '<div class="gct-scope-picker__head">'
        + `<div class="gct-scope-picker__title"><span>Choose a topic</span><button type="button" class="gct-icon-btn" data-close aria-label="Close">${svg('x')}</button></div>`
        + `<div class="gct-scope-picker__search">${svg('search')}<input class="gct-input" type="search" placeholder="Search topics…" aria-label="Search topics" autocomplete="off"></div>`
        + '<p class="gct-scope-picker__hint">Today, Listen, History and Practice all follow this topic and everything inside it.</p>'
        + '</div><div class="gct-scope-picker__list"></div>';
    picker.addEventListener('click', (e) => {
        if (e.target === picker) return picker.close(); // backdrop / scrim
        const toggle = e.target.closest('[data-toggle]');
        if (toggle) {
            const id = toggle.dataset.toggle;
            if (!expanded.delete(id)) expanded.add(id);
            return renderList();
        }
        const pick = e.target.closest('[data-pick]');
        if (pick) {
            picker.close();
            return setScope(pick.dataset.pick);
        }
        if (e.target.closest('[data-close]')) picker.close();
    });
    picker.addEventListener('input', (e) => {
        query = e.target.value;
        renderList();
    });
    picker.addEventListener('keydown', (e) => e.stopPropagation()); // keep typing away from document shortcuts (Ctrl+F)
    picker.addEventListener('close', () => document.querySelectorAll('.gct-scope-btn').forEach((b) => b.setAttribute('aria-expanded', 'false')));
    document.body.append(picker);
}

export function openPicker() {
    if (!picker) createPicker();
    query = '';
    expanded = new Set(path(state.scopeId).map((n) => n.id));
    picker.querySelector('input').value = '';
    renderList();
    const mobile = window.matchMedia?.(MOBILE).matches;
    const btn = document.querySelector('.gct-scope-btn');
    const rect = !mobile && btn?.getBoundingClientRect();
    picker.style.top = rect ? `${rect.bottom + 8}px` : '';
    picker.style.left = rect ? `${Math.max(8, rect.left)}px` : '';
    btn?.setAttribute('aria-expanded', 'true');
    picker.showModal();
    if (!mobile) picker.querySelector('input').focus(); // no keyboard pop-up on phones
}

export function initScope() {
    loadScope();
    render();
    window.addEventListener('topicschange', onTopicsChange);
    window.addEventListener('sessionsaved', refreshProgress);
    // Outside practice, screens read the scope again (startPractice may have pointed currentTopicId elsewhere).
    window.addEventListener('routechange', ({ detail: { route } }) => {
        if (route !== 'practice' && route !== 'summary') state.currentTopicId = state.scopeId || '';
        if (picker?.open && !SCOPED_ROUTES.includes(route)) picker.close();
    });
    document.addEventListener('click', (e) => {
        if (picker?.contains(e.target)) return;
        if (e.target.closest('[data-scope-open]')) openPicker();
        else if (e.target.closest('[data-scope-all]')) setScope(null);
    });
}
