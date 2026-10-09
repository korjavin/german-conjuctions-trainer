import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../state.js';
import { parseHash, guard, route, render, markAuthReady, currentRoute, ROUTES } from '../router.js';

describe('router.js', () => {
    beforeEach(() => {
        document.body.className = '';
        document.body.innerHTML = ROUTES.map((r) => `<section data-screen="${r}"></section>`).join('')
            + '<a data-nav="today"></a><a data-nav="me"></a>';
        state.isAdmin = false;
        history.replaceState(null, '', '#/');
    });

    it('defaults to today for empty or unknown hashes', () => {
        expect(parseHash('').name).toBe('today');
        expect(parseHash('#/').name).toBe('today');
        expect(parseHash('#/nope').name).toBe('today');
        expect(parseHash('#/history?x=1')).toEqual({ name: 'history', params: { x: '1' } });
    });

    it('lets #/manage through until auth is known, then sends non-admins to #/me', () => {
        expect(guard('manage')).toBe('manage'); // auth unknown: don't bounce an admin's refresh
        markAuthReady();
        expect(guard('manage')).toBe('me');
        state.isAdmin = true;
        expect(guard('manage')).toBe('manage');
    });

    it('redirects a non-admin #/manage to #/me in the URL', () => {
        markAuthReady();
        route('manage');
        expect(currentRoute()).toBe('me');
        expect(location.hash).toBe('#/me');
        expect(document.querySelector('[data-screen="me"]').hidden).toBe(false);
        expect(document.querySelector('[data-screen="manage"]').hidden).toBe(true);
    });

    it('shows only the matching section and marks the nav link', () => {
        route('history');
        const visible = [...document.querySelectorAll('[data-screen]')].filter((s) => !s.hidden).map((s) => s.dataset.screen);
        expect(visible).toEqual(['history']);
        route('today');
        expect(document.querySelector('[data-nav="today"]').getAttribute('aria-current')).toBe('page');
    });

    it('puts practice in takeover mode and leaves it on close', () => {
        route('practice');
        expect(document.body.classList.contains('is-focused')).toBe(true);
        route('today');
        expect(document.body.classList.contains('is-focused')).toBe(false);
    });

    it('sends a #/summary without a finished session to today', () => {
        route('summary');
        expect(currentRoute()).toBe('today');
        document.querySelector('[data-screen="summary"]').innerHTML = '<div id="statistics-container"></div>';
        route('summary');
        expect(currentRoute()).toBe('summary');
        expect(document.body.classList.contains('is-focused')).toBe(true);
    });

    it('keeps a finished session on its summary instead of reopening the card', () => {
        document.querySelector('[data-screen="summary"]').innerHTML = '<div id="statistics-container"></div>';
        state.isSessionComplete = true;
        route('practice');
        expect(currentRoute()).toBe('summary');
        document.getElementById('statistics-container').remove(); // what resetForNewSession does first
        route('practice');
        expect(currentRoute()).toBe('practice');
        state.isSessionComplete = false;
    });

    it('dispatches routechange with route and params', () => {
        let detail = null;
        const on = (e) => { detail = e.detail; };
        window.addEventListener('routechange', on);
        route('listen', { id: '7' });
        window.removeEventListener('routechange', on);
        expect(detail).toEqual({ route: 'listen', params: { id: '7' } });
        expect(location.hash).toBe('#/listen?id=7');
    });

    it('re-renders from the current hash', () => {
        history.replaceState(null, '', '#/topics');
        render();
        expect(currentRoute()).toBe('topics');
    });
});
