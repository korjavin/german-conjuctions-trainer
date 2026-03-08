import { state } from './state.js';
import { dom } from './dom.js';
import { checkAuthStatusAPI, checkIsAdminAPI, loadUserStatsAPI, loadExerciseStatsAPI } from './api.js';

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
        updateAuthUI();
    } catch (error) {
        console.error('Error checking auth status:', error);
        state.isAdmin = false;
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
    } else {
        dom.loginBtn.classList.remove('hidden');
        dom.logoutBtn.classList.add('hidden');
        dom.historyBtn.classList.add('hidden');
        dom.skipRemoveBtn.classList.add('hidden');
    }

    if (state.isAdmin) {
        dom.settingsBtn.classList.remove('hidden');
    } else {
        dom.settingsBtn.classList.add('hidden');
    }
}
