// Hash router for the v2 app shell: each route is a static <section data-screen="..."> in index.html.
import { state } from './state.js';

export const ROUTES = ['today', 'topics', 'listen', 'history', 'me', 'manage', 'practice', 'summary'];
const FOCUSED = new Set(['practice']); // takeover: nav hidden, practice bar shown (the summary keeps the nav, per the design)

let current = null;
let authReady = false;

// '#/history?x=1' -> { name: 'history', params: { x: '1' } }; unknown/empty -> today.
export function parseHash(hash) {
    const [name, query = ''] = String(hash || '').replace(/^#\/?/, '').split('?');
    return {
        name: ROUTES.includes(name) ? name : 'today',
        params: Object.fromEntries(new URLSearchParams(query)),
    };
}

// Until auth is known, isAdmin is just the default false — don't bounce an admin's #/manage refresh.
export function guard(name) {
    if (name === 'manage' && authReady && !state.isAdmin) return 'me';
    // A refreshed #/summary has no session to summarise.
    const hasSummary = Boolean(document.getElementById('statistics-container'));
    if (name === 'summary' && !hasSummary) return 'today';
    // Back from the summary must not reopen the finished card (Next would save the session twice).
    if (name === 'practice' && hasSummary && state.isSessionComplete) return 'summary';
    return name;
}

export function currentRoute() {
    return current;
}

export function route(name, params = {}) {
    const q = new URLSearchParams(params).toString();
    const hash = '#/' + name + (q ? '?' + q : '');
    // pushState + render keeps it synchronous (callers focus/draw into the new screen right away);
    // back/forward still fires hashchange.
    if (location.hash !== hash) history.pushState(null, '', hash);
    render();
}

export function render() {
    const { name: wanted, params } = parseHash(location.hash);
    const name = guard(wanted);
    if (name !== wanted || !location.hash.startsWith('#/' + name)) {
        history.replaceState(null, '', '#/' + name);
    }
    current = name;
    document.querySelectorAll('[data-screen]').forEach((s) => { s.hidden = s.dataset.screen !== name; });
    document.querySelectorAll('[data-nav]').forEach((a) => {
        const on = a.dataset.nav === name || (a.dataset.nav === 'me' && name === 'manage');
        if (on) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
    });
    document.body.classList.toggle('is-focused', FOCUSED.has(name));
    document.body.dataset.route = name;
    window.scrollTo?.(0, 0);
    window.dispatchEvent(new CustomEvent('routechange', { detail: { route: name, params } }));
}

// Called once auth status is known; re-renders so the #/manage guard applies.
export function markAuthReady() {
    authReady = true;
    render();
}

export function initRouter() {
    window.addEventListener('hashchange', render);
    render();
}
