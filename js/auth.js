import { state } from './state.js';
import { dom } from './dom.js';
import { checkAuthStatusAPI, checkIsAdminAPI, loadUserStatsAPI, loadExerciseStatsAPI } from './api.js';

export const AUTH_CACHE_KEY = 'authStatusV1';

function cacheAuthStatus() {
    try {
        localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
            logged_in: state.isLoggedIn,
            user_id: state.userId,
            is_admin: state.isAdmin,
        }));
    } catch (error) {
        console.error('Failed to cache auth status:', error);
    }
}

function readCachedAuthStatus() {
    try {
        const raw = localStorage.getItem(AUTH_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        console.error('Failed to read cached auth status:', error);
        return null;
    }
}

export async function checkAuthStatus() {
    try {
        const data = await checkAuthStatusAPI();
        state.isLoggedIn = data.logged_in;
        state.userId = data.user_id;

        if (state.isLoggedIn) {
            const adminData = await checkIsAdminAPI();
            state.isAdmin = adminData.is_admin;
            loadUserStats();
        } else {
            state.isAdmin = false;
        }
        cacheAuthStatus();
        updateAuthUI();
    } catch (error) {
        console.error('Error checking auth status:', error);
        // Unreachable server (typically offline): trust the last known status
        // so the logged-in UI — including offline practice — stays available.
        const cached = readCachedAuthStatus();
        state.isLoggedIn = Boolean(cached?.logged_in);
        state.userId = cached?.user_id ?? null;
        state.isAdmin = Boolean(cached?.is_admin);
        updateAuthUI();
    }
}

export async function loadUserStats() {
    try {
        const stats = await loadUserStatsAPI();
        if (stats.last_topic_id) {
            state.currentTopicId = stats.last_topic_id;
            localStorage.setItem('selectedTopicId', stats.last_topic_id);
            const currentTopic = state.topics.find(t => t.id === state.currentTopicId);
            if (currentTopic) {
                dom.topicSearch.value = currentTopic.name;
            }
        }
    } catch (error) {
        console.error('Error loading user stats:', error);
    }
}

export function updateAuthUI() {
    if (state.isLoggedIn) {
        dom.loginBtn.classList.add('hidden');
        dom.logoutBtn.classList.remove('hidden');
        dom.historyBtn.classList.remove('hidden');
        dom.skipRemoveBtn.classList.remove('hidden');
        dom.offlineCacheBtn?.classList.remove('hidden');
    } else {
        dom.loginBtn.classList.remove('hidden');
        dom.logoutBtn.classList.add('hidden');
        dom.historyBtn.classList.add('hidden');
        dom.skipRemoveBtn.classList.add('hidden');
        dom.offlineCacheBtn?.classList.add('hidden');
    }

    if (state.isAdmin) {
        dom.settingsBtn.classList.remove('hidden');
    } else {
        dom.settingsBtn.classList.add('hidden');
    }
}
