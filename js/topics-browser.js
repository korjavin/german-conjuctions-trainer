// Topics (#/topics): the learner's scope browser — roots grid, folder list, leaf detail, search, archive.
// Rows move the scope down, crumbs move it up, the play icon practises a row without changing the scope.
// Ported from docs/design/claude-design/ui_kits/app/ScreensHome.jsx TopicsScreen. (js/topics.js is the admin manager.)
import { state } from './state.js';
import { tree, scopeNode, path, short, setScope, startPractice } from './scope.js';
import { loadExerciseHistoryAPI } from './api.js';
import { currentRoute } from './router.js';
import { toast } from './ui.js';

const MAX_HITS = 30;
const RECENT = 5;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const svg = (name, size = 16) => (typeof window.gctIconSvg === 'function' ? window.gctIconSvg(name, size) : '');
const $ = (id) => document.getElementById(id);

let showArchive = false;
let recent = { id: null, rows: null }; // history rows of the leaf in scope; null = unknown/loading
let request = 0;

// Flat name filter over the non-archived tree (tree.roots excludes the archive), with each hit's trail.
export function searchNodes(q, t = tree, max = MAX_HITS) {
    const needle = String(q).trim().toLowerCase();
    if (!needle) return [];
    const out = [];
    const walk = (nodes, trail) => nodes.forEach((x) => {
        if (x.name.toLowerCase().includes(needle)) out.push({ node: x, trail });
        walk(x.children, [...trail, x]);
    });
    walk(t.roots, []);
    return out.slice(0, max);
}

// Archived nodes are read-only: no scope, no practice.
export const isArchived = (id, t = tree) => Boolean(path(id, t)[0]?.is_archive);

export const createdDate = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

// The leaf's latest practiced sentences, newest first.
export const recentRows = (rows, n = RECENT) => [...rows].sort((a, b) => String(b.last_viewed).localeCompare(String(a.last_viewed))).slice(0, n);

const mastery = (v, cls = '') => `<span class="gct-topics__mastery ${cls}" title="${Math.round(v * 100)}% mastered"><span style="width:${Math.round(v * 100)}%"></span></span>`;
const dueBadge = (n, text = '') => `<span class="gct-badge gct-badge--info gct-badge--quiet"><span class="gct-badge__dot"></span>${n}${text}</span>`;
const count = (x) => `${x.kind === 'folder' ? x.children.length + ' topics · ' : ''}${x.total} items`;

function rowHtml(x, trail) {
    const folder = x.kind === 'folder';
    return `<div class="gct-topics__row" data-open-id="${esc(x.id)}">`
        + `<span class="gct-topics__icon${folder ? ' is-folder' : ''}">${svg(folder ? 'folder' : 'leaf', 20)}${x.isNew ? '<span class="gct-topics__new" title="New"></span>' : ''}</span>`
        + `<span class="gct-topics__text"><button type="button" class="gct-topics__name">${esc(x.name)}</button>`
        + '<span class="gct-topics__meta">' + (trail?.length ? `<span>${trail.map((p) => esc(short(p.name))).join(' › ')}</span>` : '')
        + `<span>${count(x)}</span>${mastery(x.mastery, 'gct-topics__mob')}</span></span>`
        + '<span class="gct-topics__end">' + (x.due > 0 ? dueBadge(x.due) : '') + mastery(x.mastery, 'gct-topics__desk')
        + `<button type="button" class="gct-icon-btn gct-topics__play" data-practice-id="${esc(x.id)}" aria-label="Practice ${esc(x.name)}" title="Practice">${svg('play')}</button>`
        + (folder ? `<span class="gct-topics__chev">${svg('chevron-right', 18)}</span>` : '') + '</span></div>';
}

function rootHtml(r) {
    return `<button type="button" class="gct-card gct-topics__root" data-open-id="${esc(r.id)}">`
        + `<span class="gct-topics__root-head"><span class="gct-topics__tile">${svg('folder', 20)}</span>`
        + `<span class="gct-topics__grow"><span class="gct-topics__root-name">${esc(r.name)}</span><span class="gct-topics__root-sub">${r.children.length} sections · ${r.total} items</span></span>`
        + (r.isNew ? '<span class="gct-badge gct-badge--info"><span class="gct-badge__dot"></span>New lesson</span>' : '') + '</span>'
        + `<span class="gct-topics__known">${mastery(r.mastery)}<span>${Math.round(r.mastery * 100)}% known</span></span>`
        + `<span class="gct-topics__root-foot">${r.due ? `<span class="gct-badge gct-badge--info"><span class="gct-badge__dot"></span>${r.due} due now</span>` : '<span class="gct-badge gct-badge--neutral">Up to date</span>'}`
        + `<span class="gct-topics__chev">${svg('chevron-right', 18)}</span></span></button>`;
}

function archiveHtml() {
    const a = tree.archive;
    if (!a) return '';
    const kids = a.children;
    return `<button type="button" class="gct-topics__archive" data-archive aria-expanded="${showArchive}">${svg('archive', 18)}Archive · ${kids.length} retired topic${kids.length === 1 ? '' : 's'}</button>`
        + (showArchive && kids.length ? '<div class="gct-card gct-topics__list gct-topics__archived">'
            + kids.map((x) => `<div class="gct-topics__row" data-open-id="${esc(x.id)}"><span class="gct-topics__icon">${svg(x.kind === 'folder' ? 'folder' : 'leaf', 20)}</span>`
                + `<span class="gct-topics__text"><button type="button" class="gct-topics__name">${esc(x.name)}</button><span class="gct-topics__meta"><span>${count(x)}</span></span></span></div>`).join('')
            + '</div>' : '');
}

function leafHtml(n) {
    const rows = recent.id === n.id ? recent.rows : null;
    const list = rows === null ? '<div class="gct-topics__empty">Loading…</div>'
        : rows.length ? rows.map((r) => `<div class="gct-topics__sentence"><div class="gct-topics__de">${esc(r.german_sentence)}</div><div class="gct-topics__en">${esc(r.english_hint)}</div></div>`).join('')
            : '<div class="gct-topics__empty">Not practiced yet. <i>Aller Anfang ist schwer</i> — every beginning is hard.</div>';
    return '<div class="gct-topics__stats">'
        + `<div class="gct-card gct-topics__stat"><div class="gct-topics__caption">Due</div><div class="gct-topics__big is-due">${n.due}</div></div>`
        + `<div class="gct-card gct-topics__stat"><div class="gct-topics__caption">Known</div><div class="gct-topics__big">${Math.round(n.mastery * 100)}%</div>${mastery(n.mastery)}</div>`
        + `<div class="gct-card gct-topics__stat gct-topics__desk"><div class="gct-topics__caption">Items</div><div class="gct-topics__big">${n.total}</div></div></div>`
        + '<div class="gct-topics__recent-head"><div class="gct-topics__caption">Recent sentences</div><a href="#/history" class="gct-topics__link">All in History</a></div>'
        + `<div class="gct-card gct-topics__list">${list}</div>`;
}

export function renderTopicsBrowser() {
    const section = $('screen-topics');
    if (!section) return;
    const q = $('topics-browser-search').value;
    const hits = q.trim() ? searchNodes(q) : null;
    const n = hits ? null : scopeNode();
    section.classList.toggle('is-searching', Boolean(hits));
    $('topics-search-wrap').hidden = Boolean(n);
    $('topics-browser-title').textContent = n ? n.name : 'Topics';

    const crumbs = n ? [{ name: 'All topics', id: '' }, ...path(n.id).map((p) => ({ name: short(p.name), id: p.id }))] : [];
    $('topics-crumbs').innerHTML = crumbs.map((c, i) => '<span class="gct-topics__crumb">' + (i ? svg('chevron-right', 14) : '')
        + (i < crumbs.length - 1 ? `<button type="button" data-open-id="${esc(c.id)}">${esc(c.name)}</button>` : `<b>${esc(c.name)}</b>`) + '</span>').join('');

    let sub = '';
    if (!hits && !n) sub = 'Pick a topic — Today, Listen and History follow it';
    else if (n?.kind === 'leaf') sub = `${n.total} items · ${n.due} due${n.created_at ? ` · created ${createdDate(n.created_at)}` : ''}`;
    else if (n) sub = `${n.children.length} topics · ${n.total} items · ${n.due} due`;
    $('topics-browser-sub').textContent = sub;

    $('topics-actions').innerHTML = n ? `<a href="#/listen" class="gct-btn gct-btn--secondary">${svg('listen')}<span class="gct-topics__desk">Make podcast</span><span class="gct-topics__mob">Podcast</span></a>`
        + `<button type="button" class="gct-btn gct-btn--primary" data-practice-id="${esc(n.id)}">${svg('play')}Practice${n.kind === 'folder' ? ' all' : ''} · ${n.total}</button>` : '';

    let body;
    if (hits) {
        body = `<div class="gct-topics__count">${hits.length} matches · picking one makes it your topic everywhere</div>`
            + (hits.length ? `<div class="gct-card gct-topics__list">${hits.map((h) => rowHtml(h.node, h.trail)).join('')}</div>` : '');
    } else if (!n) {
        body = `<div class="gct-topics__grid">${tree.roots.map(rootHtml).join('')}</div>${archiveHtml()}`;
    } else if (n.kind === 'leaf') {
        body = leafHtml(n);
    } else {
        body = `<div class="gct-topics__info">${svg('info')}This is your current topic. Practice, Listen and History include everything inside it.</div>`
            + `<div class="gct-card gct-topics__list">${n.children.map((x) => rowHtml(x)).join('')}</div>`;
    }
    $('topics-body').innerHTML = body;
}

async function loadRecent() {
    const n = scopeNode();
    if (n?.kind !== 'leaf' || currentRoute() !== 'topics') return;
    const req = ++request;
    recent = { id: n.id, rows: state.isLoggedIn ? null : [] };
    renderTopicsBrowser();
    if (!state.isLoggedIn) return;
    try {
        const res = await loadExerciseHistoryAPI(n.id);
        if (req === request) recent = { id: n.id, rows: recentRows(res.history || []) };
    } catch (error) {
        console.error('Failed to load recent sentences:', error);
        if (req === request) recent = { id: n.id, rows: [] };
    }
    if (req === request) renderTopicsBrowser();
}

function open(id) {
    if (id && isArchived(id)) return toast({ text: 'Archived topics are read-only', icon: 'archive' });
    $('topics-browser-search').value = '';
    setScope(id);
}

export function initTopicsBrowser() {
    const section = $('screen-topics');
    if (!section) return;
    window.addEventListener('routechange', ({ detail: { route } }) => {
        if (route === 'topics') {
            renderTopicsBrowser();
            loadRecent();
        }
    });
    // setScope re-renders the current route, so scope changes arrive as routechange.
    for (const ev of ['topicschange', 'progresschange']) window.addEventListener(ev, renderTopicsBrowser);
    $('topics-browser-search').addEventListener('input', renderTopicsBrowser);
    section.addEventListener('click', (e) => {
        const play = e.target.closest('[data-practice-id]');
        if (play) {
            const id = play.dataset.practiceId;
            return isArchived(id) ? toast({ text: 'Archived topics are read-only', icon: 'archive' }) : startPractice(id);
        }
        if (e.target.closest('[data-archive]')) {
            showArchive = !showArchive;
            return renderTopicsBrowser();
        }
        const row = e.target.closest('[data-open-id]');
        if (row) open(row.dataset.openId);
    });
}
