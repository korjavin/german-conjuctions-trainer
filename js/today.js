// Today (#/today): what is due in the current topic scope, the latest lesson, the scope's sections,
// the latest podcast episode, this week's activity and upcoming reviews.
// Ported from docs/design/claude-design/ui_kits/app/ScreensHome.jsx TodayScreen.
import { state } from './state.js';
import { dom } from './dom.js';
import { tree, scopeNode, path, short, setScope, startPractice } from './scope.js';
import { loadExerciseHistoryAPI, fetchUserActivityAPI, listPodcastEpisodesAPI } from './api.js';
import { bucketReviewItems, REVIEW_BUCKETS } from './history.js';
import { describeEpisode } from './podcast.js';

const NEW_EPISODE_DAYS = 7; // ponytail: no "seen" flag for episodes, so "New" = made this week

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const svg = (name, size = 16) => (typeof window.gctIconSvg === 'function' ? window.gctIconSvg(name, size) : '');
const $ = (id) => document.getElementById(id);

// Scope-loaded data, per routechange to today: null = unknown (logged out, loading or failed).
let data = { history: null, days: null, episode: null, loaded: false };
let request = 0;

// "about N min" for N due sentences (~15 s each).
export const aboutMinutes = (due) => Math.max(1, Math.round(due * 0.25));

// Newest leaf by created_at in node's subtree (node null = all topics); null if none.
export function newestLeaf(node, roots = tree.roots) {
    let best = null;
    const walk = (n) => {
        if (n.kind === 'leaf') {
            if (!best || String(n.created_at || '') > String(best.created_at || '')) best = n;
        } else n.children.forEach(walk);
    };
    (node ? [node] : roots).forEach(walk);
    return best;
}

const mastery = (value, cls = '') => `<span class="gct-today__mastery ${cls}" title="${Math.round(value * 100)}% mastered"><span style="width:${Math.round(value * 100)}%"></span></span>`;

// Hero text above the buttons: due number + narrowing pills, or the login nudge.
export function heroHtml({ node, due, kids, loggedIn }) {
    const caption = `<div class="gct-today__caption">Due now${node ? ' · ' + esc(short(node.name)) : ''}</div>`;
    if (!loggedIn) {
        return caption + '<div class="gct-today__anon">Log in to track your reviews</div>'
            + '<p class="gct-today__muted">Practice any topic right away. Signed in, the trainer remembers what is due and when.</p>';
    }
    const pills = kids.filter((k) => k.due > 0).slice(0, 4);
    return caption
        + `<div class="gct-today__due"><span class="gct-today__num">${due}</span><span class="gct-today__due-text">${due ? `sentences ready · about ${aboutMinutes(due)} min` : 'nothing due here right now'}</span></div>`
        + (pills.length ? '<div class="gct-today__pills">' + pills.map((k) => `<button type="button" class="gct-pill" data-scope-id="${esc(k.id)}" title="Narrow to ${esc(k.name)}">`
            + `<span class="gct-today__ellip">${esc(short(k.name))}</span><span class="gct-pill__count">${k.due}</span></button>`).join('') + '</div>' : '');
}

function lessonHtml(leaf, node) {
    const crumbs = path(leaf.id).slice(0, -1).map((p) => `<span>${esc(short(p.name))}</span>`).join(svg('chevron-right', 14));
    return `<div class="gct-today__row-head"><div class="gct-today__caption">Latest lesson${node ? ' here' : ''}</div>`
        + (leaf.isNew ? '<span class="gct-badge gct-badge--info"><span class="gct-badge__dot"></span>New</span>' : '') + '</div>'
        + `<div class="gct-today__lesson-name">${esc(leaf.name)}</div>`
        + (crumbs ? `<nav class="gct-today__crumbs">${crumbs}</nav>` : '')
        + `<div class="gct-today__lesson-foot">${mastery(leaf.mastery)}<span class="gct-today__meta">${leaf.due} due · ${leaf.total} sentences</span>`
        + `<span class="gct-today__grow"></span><button type="button" class="gct-btn gct-btn--secondary" data-practice-id="${esc(leaf.id)}">${svg('play')}Practice lesson</button></div>`;
}

function sectionsHtml(node, kids) {
    return `<div class="gct-today__row-head"><div><div class="gct-today__caption">${node ? 'Inside this topic' : 'Your tracks'}</div>`
        + `<div class="gct-today__title">${node ? esc(node.name) : 'All topics'}</div></div><span class="gct-today__hint">tap to narrow</span></div>`
        + kids.map((k) => `<button type="button" class="gct-tree-row gct-today__section" data-scope-id="${esc(k.id)}">`
            + `<span class="gct-today__icon${k.kind === 'folder' ? ' is-folder' : ''}">${svg(k.kind === 'folder' ? 'folder' : 'leaf')}</span>`
            + `<span class="gct-today__ellip gct-today__name">${esc(k.name)}</span>`
            + mastery(k.mastery, 'gct-today__desk') + `<span class="gct-today__pct gct-today__desk">${Math.round(k.mastery * 100)}%</span>`
            + `<span class="gct-today__status">${k.due ? `<span class="gct-badge gct-badge--info gct-badge--quiet"><span class="gct-badge__dot"></span>${k.due} due</span>` : '<span class="gct-today__hint">up to date</span>'}</span>`
            + '</button>').join('');
}

function episodeHtml(ep, node) {
    if (!ep) {
        return `<span class="gct-today__listen-icon">${svg('listen', 20)}</span>`
            + `<div class="gct-today__grow"><div class="gct-today__ep-title">No podcast for this topic yet</div><div class="gct-today__muted">A listen-only episode from ${node ? esc(short(node.name)) : 'all topics'}</div></div>`
            + '<a href="#/listen" class="gct-btn gct-btn--secondary gct-btn--sm">Make one</a>';
    }
    const isNew = Date.now() - Date.parse(ep.created_at) < NEW_EPISODE_DAYS * 864e5;
    return `<a href="#/listen" class="gct-player__play gct-today__play" aria-label="Play episode">${svg('play', 20)}</a>`
        + `<div class="gct-today__grow"><div class="gct-today__caption">${isNew ? 'New episode' : 'Latest episode'}</div>`
        + `<div class="gct-today__ep-title gct-today__ellip">${esc(ep.topic_name || '')}</div><div class="gct-today__muted">${esc(describeEpisode(ep))}</div></div>`;
}

// days: [{date, count}] oldest first, the last one is today.
export function weekHtml(days, node) {
    const max = Math.max(1, ...days.map((d) => d.count));
    const active = days.filter((d) => d.count > 0).length;
    const total = days.reduce((s, d) => s + d.count, 0);
    const last = days.length - 1;
    const label = (d) => new Date(d.date + 'T12:00:00').toLocaleDateString('en', { weekday: 'narrow' });
    return `<div class="gct-today__caption">This week${node ? ' · ' + esc(short(node.name)) : ''}</div>`
        + '<div class="gct-today__week">' + days.map((d, i) => `<span class="gct-today__bar${d.count ? ' is-on' : ''}${i === last ? ' is-today' : ''}" style="height:${d.count ? Math.max(8, Math.round((d.count / max) * 64)) : 6}px" title="${d.count} on ${esc(d.date)}"></span>`).join('') + '</div>'
        + '<div class="gct-today__week gct-today__week-days">' + days.map((d, i) => `<span${i === last ? ' class="is-today"' : ''}>${label(d)}</span>`).join('') + '</div>'
        + `<div class="gct-today__week-sum"><b>${active} of ${days.length} days</b> · ${total} sentences</div>`;
}

export function upcomingHtml(history, now = Date.now()) {
    const buckets = bucketReviewItems(history, now);
    const max = Math.max(1, ...buckets);
    return '<div class="gct-today__row-head"><div class="gct-today__caption">Upcoming reviews</div><a href="#/history" class="gct-today__link">History</a></div>'
        + '<div class="gct-today__histo">' + buckets.map((v, i) => `<div class="gct-today__col${i === 0 ? ' is-now' : ''}"><span>${v}</span>`
            + `<span class="gct-today__hbar" style="height:${Math.max(3, Math.round((v / max) * 56))}px"></span><span>${REVIEW_BUCKETS[i].label}</span></div>`).join('') + '</div>';
}

function show(id, html) {
    const el = $(id);
    if (!el) return;
    el.hidden = html === null;
    if (html !== null) el.innerHTML = html;
}

export function renderToday() {
    if (!$('today-hero')) return;
    const node = scopeNode();
    const due = node ? node.due : tree.due;
    const kids = node ? node.children : tree.roots;
    const leaf = newestLeaf(node);
    const loggedIn = Boolean(state.isLoggedIn);

    $('today-date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    $('today-hero').innerHTML = heroHtml({ node, due, kids, loggedIn });
    if (dom.generateBtn) {
        dom.generateBtn.innerHTML = loggedIn && due > 0 ? `Review ${due}${svg('arrow-right', 18)}` : `${svg('play', 18)}Practice anyway`;
    }
    $('today-browse').textContent = node ? 'Browse inside' : 'Browse topics';
    show('today-lesson', leaf ? lessonHtml(leaf, node) : null);
    show('today-sections', kids.length ? sectionsHtml(node, kids) : null);
    show('today-episode', loggedIn && data.loaded ? episodeHtml(data.episode, node) : null);
    show('today-week', loggedIn && data.days?.length ? weekHtml(data.days, node) : null);
    show('today-upcoming', loggedIn && data.history ? upcomingHtml(data.history) : null);
}

async function loadToday() {
    const req = ++request;
    data = { history: null, days: null, episode: null, loaded: false };
    renderToday();
    if (!state.isLoggedIn) return;
    const id = state.scopeId || '';
    const [h, a, e] = await Promise.allSettled([loadExerciseHistoryAPI(id), fetchUserActivityAPI(id, 7), listPodcastEpisodesAPI(id)]);
    if (req !== request) return; // the scope or route changed meanwhile; the newer load wins
    data = {
        history: h.value?.history || null,
        days: a.value?.days || null,
        episode: e.value?.episodes?.[0] || null,
        loaded: e.status === 'fulfilled',
    };
    renderToday();
}

export function initToday() {
    window.addEventListener('routechange', ({ detail: { route } }) => {
        if (route === 'today') loadToday();
    });
    // Tree/progress/scope changes only move the numbers already on screen.
    for (const ev of ['scopechange', 'topicschange', 'progresschange']) window.addEventListener(ev, renderToday);
    $('screen-today')?.addEventListener('click', (e) => {
        const scoped = e.target.closest('[data-scope-id]');
        if (scoped) return setScope(scoped.dataset.scopeId);
        const practice = e.target.closest('[data-practice-id]');
        if (practice) startPractice(practice.dataset.practiceId);
    });
}
