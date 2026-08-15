import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkAuthStatus, AUTH_CACHE_KEY } from '../auth.js';
import { state } from '../state.js';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
    checkAuthStatusAPI: vi.fn(),
    checkIsAdminAPI: vi.fn(),
    loadUserStatsAPI: vi.fn(async () => ({})),
    loadExerciseStatsAPI: vi.fn(async () => ({}))
}));

describe('auth.js offline fallback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        state.isLoggedIn = false;
        state.userId = null;
        state.isAdmin = false;
    });

    it('caches the auth status after a successful check', async () => {
        api.checkAuthStatusAPI.mockResolvedValueOnce({ logged_in: true, user_id: 'u1' });
        api.checkIsAdminAPI.mockResolvedValueOnce({ is_admin: true });

        await checkAuthStatus();

        expect(JSON.parse(localStorage.getItem(AUTH_CACHE_KEY))).toEqual({
            logged_in: true,
            user_id: 'u1',
            is_admin: true
        });
    });

    it('restores the last known logged-in status when the server is unreachable', async () => {
        localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ logged_in: true, user_id: 'u1', is_admin: false }));
        api.checkAuthStatusAPI.mockRejectedValueOnce(new Error('Failed to fetch'));

        await checkAuthStatus();

        expect(state.isLoggedIn).toBe(true);
        expect(state.userId).toBe('u1');
        expect(state.isAdmin).toBe(false);
    });

    it('stays logged out when there is nothing cached', async () => {
        api.checkAuthStatusAPI.mockRejectedValueOnce(new Error('Failed to fetch'));

        await checkAuthStatus();

        expect(state.isLoggedIn).toBe(false);
        expect(state.isAdmin).toBe(false);
    });
});
