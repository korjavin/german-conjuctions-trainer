// History (#/history): practiced sentences in the topic scope — upcoming reviews, filter pills,
// sort, rows with favorite/ignore. Ported from docs/design/claude-design/ui_kits/app/ScreensMore.jsx HistoryScreen.
import { state } from './state.js';
import { loadExerciseHistoryAPI, toggleHideExerciseAPI, toggleFavoriteAPI } from './api.js';
import { toast } from './ui.js';
import { path, short } from './scope.js';

const PAGE = 10;
const H = 36e5;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const svg = (name, size = 16) => (typeof window.gctIconSvg === 'function' ? window.gctIconSvg(name, size) : '');
const $ = (id) => document.getElementById(id);

// Single-select filters; Ignored rows only ever show under Ignored.
export const FILTERS = {
    due: (r) => !r.is_hidden && r.ready_to_repeat,
    training: (r) => !r.is_hidden && !r.ready_to_repeat,
    fav: (r) => !r.is_hidden && r.is_favorite,
    ignored: (r) => r.is_hidden,
};

// Each sort key: [default direction, comparator ascending]; a repeat click flips the direction.
const errRate = (r) => (r.total_attempts ? 1 - r.successful_attempts / r.total_attempts : 0);
const when = (r) => new Date(r.created_at || r.last_viewed).getTime();
const reviewAt = (r) => (r.ready_to_repeat ? 0 : new Date(r.last_viewed).getTime() + r.next_review_hours * H);
export const SORTS = {
    timing: { dir: 1, cmp: (a, b) => reviewAt(a) - reviewAt(b) },
    errors: { dir: -1, cmp: (a, b) => errRate(a) - errRate(b) },
    date: { dir: -1, cmp: (a, b) => when(a) - when(b) },
};

export function getFilteredHistoryData(rows = state.historyData, filter = state.historyFilter, sort = state.historySort) {
    const s = SORTS[sort.key];
    return rows.filter(FILTERS[filter]).sort((a, b) => s.cmp(a, b) * sort.dir);
}

export const filterCounts = (rows) => Object.fromEntries(Object.keys(FILTERS).map((k) => [k, rows.filter(FILTERS[k]).length]));

// Hour-aware bucket boundaries and labels for the review chart (Today reuses them).
export const REVIEW_BUCKETS = [
    { label: 'Now', maxHours: 1 },
    { label: '<4h', maxHours: 4 },
    { label: '4–12h', maxHours: 12 },
    { label: '12–24h', maxHours: 24 },
    { label: '1–2d', maxHours: 48 },
    { label: '2–4d', maxHours: 96 },
    { label: '4–7d', maxHours: 168 },
    { label: 'Later', maxHours: Infinity },
];

export function bucketReviewItems(items, now) {
    const buckets = new Array(REVIEW_BUCKETS.length).fill(0);
    items.forEach((item) => {
        if (item.is_hidden) return;
        const hoursFromNow = item.ready_to_repeat ? 0 : Math.max(0, (reviewAt(item) - now) / H);
        for (let i = item.ready_to_repeat ? 0 : 1; i < REVIEW_BUCKETS.length; i++) {
            if (hoursFromNow < REVIEW_BUCKETS[i].maxHours) {
                buckets[i]++;
                break;
            }
        }
    });
    return buckets;
}

// Topic path of a row relative to the scope: the scope prefix is dropped; the leaf name alone when the row IS the scope.
export function relativeTopic(item, scopeId = state.scopeId) {
    const p = path(item.topic_id);
    if (!p.length) return item.topic_name || '';
    const k = scopeId ? p.findIndex((n) => n.id === scopeId) : -1;
    const tail = p.slice(k + 1);
    return (tail.length ? tail : p.slice(-1)).map((n) => short(n.name)).join(' › ');
}

function ago(iso, now) {
    const h = Math.floor((now - new Date(iso).getTime()) / H);
    if (h < 1) return 'Just now';
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return d === 1 ? 'Yesterday' : `${d} days ago`;
}

export function statusBadge(item, now = Date.now()) {
    const badge = (tone, text) => `<span class="gct-badge gct-badge--${tone} gct-badge--quiet"><span class="gct-badge__dot"></span>${text}</span>`;
    if (item.is_hidden) return badge('neutral', 'Ignored');
    const h = Math.ceil((reviewAt(item) - now) / H);
    if (item.ready_to_repeat) return badge('info', 'Due now');
    if (h <= 0) return badge('neutral', 'Soon');
    return badge('neutral', h >= 24 ? `in ${Math.ceil(h / 24)} d` : `in ${h} h`);
}

export function rowHtml(item, i, now = Date.now()) {
    const pct = item.total_attempts ? Math.round((item.successful_attempts / item.total_attempts) * 100) : 0;
    const tone = pct >= 75 ? 'good' : pct >= 40 ? 'mid' : 'bad';
    return `<div class="gct-history__row" data-i="${i}">`
        + `<div class="gct-history__text"><div class="gct-history__de">${esc(item.german_sentence)}</div><div class="gct-history__en">${esc(item.english_hint)}</div></div>`
        + '<div class="gct-history__actions">'
        + `<button type="button" class="gct-icon-btn gct-history__fav" data-act="fav" aria-pressed="${Boolean(item.is_favorite)}" aria-label="Favorite" title="Favorite">${svg('star', 18)}</button>`
        + `<button type="button" class="gct-icon-btn" data-act="ignore" aria-label="${item.is_hidden ? 'Stop ignoring' : 'Ignore'}" title="${item.is_hidden ? 'Stop ignoring' : 'Ignore'}">${svg('eye-off', 18)}</button>`
        + '</div><div class="gct-history__foot">'
        + statusBadge(item, now)
        + `<span class="gct-history__where">${esc(relativeTopic(item))} · ${ago(item.last_viewed, now)}</span><span class="gct-history__grow"></span>`
        + `<span class="gct-history__nums" title="Correct · mistakes · hints"><span>✓ ${item.successful_attempts}</span><span>✗ ${item.failed_attempts}</span><span class="gct-history__hint">${svg('hint', 13)}${item.hints_used}</span></span>`
        + `<span class="gct-history__pct is-${tone}">${pct}%</span>`
        + '</div></div>';
}

export function histogramHtml(buckets) {
    const max = Math.max(1, ...buckets);
    return buckets.map((v, i) => `<div class="gct-today__col${i === 0 ? ' is-now' : ''}"><span>${v}</span>`
        + `<span class="gct-today__hbar" style="height:max(3px, calc(var(--histo-h, 56px) * ${(v / max).toFixed(3)}))"></span><span>${REVIEW_BUCKETS[i].label}</span></div>`).join('');
}

// Rows shown right now (filtered + sorted, first page*10); clicks index into it.
let shown = [];

export function renderHistory(now = Date.now()) {
    if (!$('history-content')) return;
    const rows = state.historyData;
    const active = rows.filter((r) => !r.is_hidden);
    const attempts = active.reduce((s, r) => s + r.total_attempts, 0);
    const ok = active.reduce((s, r) => s + r.successful_attempts, 0);
    $('history-sub').textContent = `${active.length} practiced · ${attempts ? Math.round((ok / attempts) * 100) : 0}% right first time`;
    $('history-review-chart-bars').innerHTML = histogramHtml(bucketReviewItems(rows, now));

    const counts = filterCounts(rows);
    document.querySelectorAll('#history-filters [data-filter]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.filter === state.historyFilter));
        b.querySelector('.gct-pill__count').textContent = counts[b.dataset.filter];
    });
    document.querySelectorAll('#history-sort [data-sort]').forEach((b) => {
        const on = b.dataset.sort === state.historySort.key;
        b.setAttribute('aria-pressed', String(on));
        b.querySelector('.gct-history__dir').textContent = on ? (state.historySort.dir > 0 ? '↑' : '↓') : '';
    });

    const all = getFilteredHistoryData();
    shown = all.slice(0, state.historyPage * PAGE);
    $('history-content').innerHTML = shown.length
        ? shown.map((r, i) => rowHtml(r, i, now)).join('')
        : '<div class="gct-history__empty">Nothing here yet.</div>';
    $('history-more-btn').hidden = all.length <= shown.length;
}

let historyRequest = 0;

export async function showExerciseHistory() {
    if (!state.isLoggedIn) return; // the section shows the login prompt
    const request = ++historyRequest;
    $('history-loading').hidden = false;
    $('history-body').hidden = true;
    try {
        const data = await loadExerciseHistoryAPI(state.scopeId || '');
        if (request !== historyRequest) return; // the scope changed meanwhile; the newer load wins
        state.historyData = data.history || [];
        state.historyPage = 1;
        $('history-loading').hidden = true;
        $('history-body').hidden = false;
        renderHistory();
    } catch (error) {
        if (request !== historyRequest) return;
        console.error('Error fetching exercise history:', error);
        $('history-loading').hidden = true;
        toast({ tone: 'danger', text: error.status === 401 ? 'Your session has expired. Please log in again.' : 'Could not load exercise history. Please try again later.' });
    }
}

async function toggleIgnore(item, undoable = true) {
    try {
        item.is_hidden = (await toggleHideExerciseAPI(item.exercise_id)).is_hidden;
    } catch (error) {
        console.error('Error toggling ignore:', error);
        return toast({ tone: 'danger', text: 'Could not update this sentence. Please try again.' });
    }
    renderHistory();
    if (undoable) {
        toast({
            text: item.is_hidden ? 'Hidden from future sessions' : 'Back in your reviews',
            action: { label: 'Undo', run: () => toggleIgnore(item, false) },
        });
    }
}

async function toggleFavorite(item) {
    try {
        item.is_favorite = (await toggleFavoriteAPI(item.exercise_id)).is_favorite;
        renderHistory();
    } catch (error) {
        console.error('Error toggling favorite:', error);
        toast({ tone: 'danger', text: 'Could not update this sentence. Please try again.' });
    }
}

export function initHistory() {
    window.addEventListener('routechange', ({ detail: { route } }) => {
        if (route === 'history') showExerciseHistory(); // also re-runs on scope change (scope.js re-renders the route)
    });
    window.addEventListener('topicschange', () => { if (state.historyData.length) renderHistory(); });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#screen-history')) return;
        const filter = e.target.closest('[data-filter]');
        const sort = e.target.closest('[data-sort]');
        const act = e.target.closest('[data-act]');
        if (filter) {
            state.historyFilter = filter.dataset.filter;
            state.historyPage = 1;
        } else if (sort) {
            const key = sort.dataset.sort;
            state.historySort = key === state.historySort.key ? { key, dir: -state.historySort.dir } : { key, dir: SORTS[key].dir };
            state.historyPage = 1;
        } else if (e.target.closest('#history-more-btn')) {
            state.historyPage++;
        } else if (act) {
            const item = shown[act.closest('[data-i]').dataset.i];
            return act.dataset.act === 'fav' ? toggleFavorite(item) : toggleIgnore(item);
        } else return;
        renderHistory();
    });
}
