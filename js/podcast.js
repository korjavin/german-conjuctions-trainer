// Podcast mode: builds a listen-only episode (MP3) for the selected topic
// subtree, to play in the browser or download for a phone's player.
import { state } from './state.js';
import { dom } from './dom.js';
import { generatePodcastAPI, getPodcastFeedAPI, regeneratePodcastFeedAPI } from './api.js';
import { getTopicPath } from './topics.js';
import { handleVoiceToggle } from './voice.js';

let episode = null; // last built episode: server response + topicId
let isGenerating = false;

const FAVORITES_ONLY_KEY = 'podcastFavoritesOnly';

function loadFavoritesOnly() {
    try {
        return localStorage.getItem(FAVORITES_ONLY_KEY) === 'true';
    } catch (_) {
        return false;
    }
}

function saveFavoritesOnly(value) {
    try {
        localStorage.setItem(FAVORITES_ONLY_KEY, String(value));
    } catch (_) { /* private mode: the choice just isn't remembered */ }
}

export function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds || 0));
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
}

export function describeEpisode(data) {
    const parts = [`${data.phrases.length} phrases`, formatDuration(data.duration_seconds)];
    if (data.recall_repeats > 0) {
        parts.push(`${data.recall_repeats} tricky ${data.recall_repeats === 1 ? 'phrase' : 'phrases'} repeated`);
    }
    return parts.join(' · ');
}

function currentTopicLabel() {
    if (!state.currentTopicId) return '';
    return getTopicPath(state.currentTopicId, state.topics) || '';
}

function setStatus(message) {
    dom.podcastStatus.classList.toggle('hidden', !message);
    dom.podcastStatusText.textContent = message || '';
}

function setError(message) {
    dom.podcastError.classList.toggle('hidden', !message);
    dom.podcastError.textContent = message || '';
}

function renderPhraseList(phrases) {
    const items = phrases.map((phrase) => {
        const li = document.createElement('li');
        const de = document.createElement('div');
        de.className = 'podcast-phrase-de';
        de.textContent = phrase.german;
        if (phrase.weak) {
            const badge = document.createElement('span');
            badge.className = 'podcast-phrase-weak';
            badge.textContent = '×2';
            badge.title = 'You often make mistakes here, so it is recalled twice';
            de.appendChild(badge);
        }
        const en = document.createElement('div');
        en.className = 'podcast-phrase-en';
        en.textContent = phrase.english;
        li.append(de, en);
        return li;
    });
    dom.podcastPhraseList.replaceChildren(...items);
}

function updateMediaSession(data) {
    if (!('mediaSession' in navigator) || typeof window.MediaMetadata !== 'function') return;
    navigator.mediaSession.metadata = new window.MediaMetadata({
        title: `Podcast: ${data.topic_name}`,
        artist: 'German Trainer',
        album: `${data.phrases.length} phrases`,
    });
}

function renderEpisode(data) {
    dom.podcastAudio.src = data.url;
    dom.podcastDownloadLink.href = data.download_url;
    dom.podcastMeta.textContent = describeEpisode(data);
    dom.podcastTranscriptSummary.textContent = `Phrases (${data.phrases.length})`;
    renderPhraseList(data.phrases);
    dom.podcastResult.classList.remove('hidden');
    dom.podcastGenerateBtn.textContent = 'Generate a new episode';
}

export function openPodcastDialog() {
    dom.podcastTopicName.textContent = currentTopicLabel() || 'No topic selected';
    // An episode built for another topic stays playable but is labelled as such.
    const stale = episode && episode.topicId !== state.currentTopicId;
    if (!episode) {
        dom.podcastResult.classList.add('hidden');
        dom.podcastGenerateBtn.textContent = 'Generate podcast';
    } else if (stale) {
        dom.podcastMeta.textContent = `Previous episode: ${episode.data.topic_name} · ${describeEpisode(episode.data)}`;
        dom.podcastGenerateBtn.textContent = 'Generate podcast for this topic';
    }
    // Favorites are per user, so guests don't get the option.
    dom.podcastFavoritesOption.classList.toggle('hidden', !state.isLoggedIn);
    dom.podcastFavoritesOnly.checked = state.isLoggedIn && loadFavoritesOnly();
    if (!isGenerating) setError('');
    dom.podcastModal.showModal();
}

export async function generatePodcast() {
    if (isGenerating) return;
    if (!state.currentTopicId) {
        setError('Please select a topic first.');
        return;
    }
    if (navigator.onLine === false) {
        setError('You are offline. Podcasts are built on the server — try again when connected.');
        return;
    }

    isGenerating = true;
    const topicId = state.currentTopicId;
    const favoritesOnly = state.isLoggedIn && dom.podcastFavoritesOnly.checked;
    dom.podcastGenerateBtn.disabled = true;
    setError('');
    const started = Date.now();
    const tick = () => {
        const elapsed = Math.round((Date.now() - started) / 1000);
        setStatus(`Building your episode… ${elapsed}s (new phrases can take a minute or two)`);
    };
    tick();
    const timer = setInterval(tick, 1000);

    try {
        const data = await generatePodcastAPI(topicId, favoritesOnly);
        episode = { topicId, data };
        renderEpisode(data);
        updateMediaSession(data);
    } catch (error) {
        console.error('Podcast generation failed:', error);
        setError(error.message || 'Failed to build the podcast.');
    } finally {
        clearInterval(timer);
        setStatus('');
        dom.podcastGenerateBtn.disabled = false;
        isGenerating = false;
    }
}

// --- Private RSS feed (Settings) ---

function setFeedError(message) {
    dom.podcastFeedError.classList.toggle('hidden', !message);
    dom.podcastFeedError.textContent = message || '';
}

// Bumped by every feed request so a slow load cannot overwrite the URL a
// later regenerate returned (the old one is already revoked).
let feedRequest = 0;

// Fills the Settings feed field; called when Settings opens for a logged-in user.
export async function loadPodcastFeed() {
    if (!state.isLoggedIn || !dom.podcastFeedUrl) return;
    const request = ++feedRequest;
    setFeedError('');
    try {
        const data = await getPodcastFeedAPI();
        if (request !== feedRequest) return;
        dom.podcastFeedUrl.value = data.feed_url || '';
    } catch (error) {
        if (request !== feedRequest) return;
        dom.podcastFeedUrl.value = '';
        setFeedError(error.message || 'Failed to load the podcast feed.');
    }
}

export async function copyPodcastFeed() {
    const value = dom.podcastFeedUrl.value;
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        dom.podcastFeedCopyBtn.textContent = 'Copied!';
        setTimeout(() => { dom.podcastFeedCopyBtn.textContent = 'Copy'; }, 1500);
    } catch (_) {
        // Clipboard API can fail (insecure context): let the user copy by hand.
        dom.podcastFeedUrl.focus();
        dom.podcastFeedUrl.select();
    }
}

export async function regeneratePodcastFeed() {
    if (!window.confirm('Create a new feed URL? The current URL stops working, and your podcast app must be re-subscribed with the new one.')) return;
    feedRequest++;
    dom.podcastFeedRegenerateBtn.disabled = true;
    setFeedError('');
    try {
        const data = await regeneratePodcastFeedAPI();
        feedRequest++; // loads started meanwhile may have read the old token
        dom.podcastFeedUrl.value = data.feed_url || '';
    } catch (error) {
        setFeedError(error.message || 'Failed to regenerate the podcast feed.');
    } finally {
        dom.podcastFeedRegenerateBtn.disabled = false;
    }
}

export function initPodcast() {
    dom.podcastFeedCopyBtn?.addEventListener('click', copyPodcastFeed);
    dom.podcastFeedRegenerateBtn?.addEventListener('click', regeneratePodcastFeed);
    if (!dom.podcastBtn) return;
    dom.podcastBtn.addEventListener('click', openPodcastDialog);
    dom.podcastCloseBtn.addEventListener('click', () => dom.podcastModal.close());
    dom.podcastGenerateBtn.addEventListener('click', generatePodcast);
    dom.podcastFavoritesOnly.addEventListener('change', () => saveFavoritesOnly(dom.podcastFavoritesOnly.checked));
    // The episode's own German would be heard as spoken answers.
    dom.podcastAudio.addEventListener('play', () => {
        if (state.voiceActive) handleVoiceToggle();
    });
    // Closing the dialog keeps the episode playing, like a background player.
}
